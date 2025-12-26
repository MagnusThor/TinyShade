import { TinyShade } from "../TinyShade";

document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade.create("canvas");

    // 1 Million Particles
    const COUNT = 1_000_000; 
    const STORAGE_SIZE = COUNT * 4; 

    app.setUniforms(l => {
        l.addUniform("count", COUNT)
         .addUniform("random", () => Math.random());
    })
    /**
     * COMPUTE PASS: 3D Volumetric Movement
     */
    .addCompute(STORAGE_SIZE,  `
        ##WORKGROUP_SIZE
        fn main(@builtin(global_invocation_id) id: vec3u) {
            let i = id.x;
            if (i >= u32(u.count)) { return; }
            
            let b = i * 4u;
            // State: p.x, p.y, p.z (depth), p.w (speed/life)
            var p = vec4f(data[b], data[b+1], data[b+2], data[b+3]);

            // 1. DEPTH MOVEMENT (Z-axis)
            // Particles move toward the camera (Z decreases)
            p.z -= 0.0005 + (fract(f32(i) * 0.13) * 0.001);


            // 2. RESET LOGIC (Infinite Tunnel)
            // If the particle passes the camera (z < 0.1) or gets too far, reset to the back
            if (p.z < 0.1 || u.time < 0.1) {
                let angle = fract(f32(i) * 0.001) * 6.28 + u.time * 0.2;
                let radius = 0.5 + fract(f32(i) * 0.5) * 2.0;
                p.x = cos(angle) * radius;
                p.y = sin(angle) * radius;
                p.z = 4.0 + fract(f32(i) * 123.45); // Start far away
                p.w = 0.1 + fract(f32(i) * 7.7) * 0.5; // Individual speed
            }

            // Turbulence based on depth
            p.x += sin(p.z + u.time) * 0.002;
            p.y += cos(p.z + u.time) * 0.002;

            data[b] = p.x; data[b+1] = p.y; data[b+2] = p.z; data[b+3] = p.w;

            // 3. PERSPECTIVE PROJECTION
            // The classic 3D to 2D math: screenX = x / z
            let res = vec2f(u.resolution.xy);
            let aspect = res.x / res.y;
            
            let fov = 1.0; 
            let screenX = (p.x / p.z) * fov;
            let screenY = (p.y / (p.z * aspect)) * fov;

            let coords = vec2i(
                i32((screenX * 0.5 + 0.5) * res.x), 
                i32((screenY * 0.5 + 0.5) * res.y)
            );
            
            if(coords.x <= 1 || coords.x >= i32(res.x)-1 || coords.y <= 1 || coords.y >= i32(res.y)-1) { return; }

            // 4. DEPTH FOG / SHADING
            // Further particles are darker and bluer. Closer are brighter and cyan.
            let depthFactor = saturate(1.0 - (p.z / 4.0));
            let color = mix(vec3f(0.0, 0.1, 0.5), vec3f(0.2, 0.9, 1.0), depthFactor);
            
            // Particles get larger/brighter as they get closer
            textureStore(outTex, coords, vec4f(color * (depthFactor * 3.0), 1.0));
            
            if (depthFactor > 0.7) { // Only draw glow for close particles
                 let dim = vec4f(color * 0.5, 1.0);
                 textureStore(outTex, coords + vec2i(1, 0), dim);
                 textureStore(outTex, coords - vec2i(1, 0), dim);
            }
        }
    `)
    .addPass(`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv * 2.0 - 1.0;
            // Dark "Warp Drive" Background
            let d = length(uv);
            let glow = 0.005 / pow(d, 1.5);
            let fin = glow * vec3f(0.1, 0.2, 0.5);
            return vec4f(fin, 1.0);
        }
    `)
    .main(`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv;
            let centerDist = length(uv - 0.5);
            
            // Chromatic aberration increases with depth/speed feel
            let shift = centerDist * 0.015;
            let r = textureSample(computeTex, samp, uv + vec2f(shift, 0.0)).r;
            let g = textureSample(computeTex, samp, uv).g;
            let b = textureSample(computeTex, samp, uv - vec2f(shift, 0.0)).b;
            
            let bg = textureSample(pass0, samp, uv).rgb;
            let combined = bg + vec3f(r, g, b);

            // Filmic Curve
            let x = max(vec3f(0.0), combined - 0.004);
            let mapped = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);

            return vec4f(mapped * smoothstep(1.0, 0.2, centerDist), 1.0);
        }
    `)
    .run();
});