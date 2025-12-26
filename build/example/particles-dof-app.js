"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TinyShade_1 = require("../TinyShade");
document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade_1.TinyShade.create("canvas");
    const COUNT = 1_000_000;
    const STORAGE_SIZE = COUNT * 4;
    app.setUniforms(l => {
        l.addUniform("count", COUNT)
            .addUniform("random", () => Math.random());
    })
        /**
         * COMPUTE PASS: Preserved precisely.
         * We hijack the Alpha channel to store Z-depth for the DOF effect.
         */
        .addCompute(STORAGE_SIZE, `
        ##WORKGROUP_SIZE
        fn main(@builtin(global_invocation_id) id: vec3u) {
            let i = id.x;
            if (i >= u32(u.count)) { return; }
            
            let b = i * 4u;
            var p = vec4f(data[b], data[b+1], data[b+2], data[b+3]);

          
            p.z -= 0.0005 + (fract(f32(i) * 0.13) * 0.001);

            if (p.z < 0.1 || u.time < 0.1) {
                let angle = fract(f32(i) * 0.001) * 6.28 + u.time * 0.2;
                let radius = 0.5 + fract(f32(i) * 0.5) * 2.0;
                p.x = cos(angle) * radius;
                p.y = sin(angle) * radius;
                p.z = 4.0 + fract(f32(i) * 123.45); 
                p.w = 0.1 + fract(f32(i) * 7.7) * 0.5;
            }

            p.x += sin(p.z + u.time) * 0.002;
            p.y += cos(p.z + u.time) * 0.002;

            data[b] = p.x; data[b+1] = p.y; data[b+2] = p.z; data[b+3] = p.w;

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

            let depthFactor = saturate(1.0 - (p.z / 4.0));
            let color = mix(vec3f(0.0, 0.1, 0.5), vec3f(0.2, 0.9, 1.0), depthFactor);
            
            // NOTE: Store color in RGB and Z-DEPTH in Alpha
            textureStore(outTex, coords, vec4f(color * (depthFactor * 3.0), p.z));
            
            if (depthFactor > 0.7) {
                 let dim = vec4f(color * 0.5, p.z); // Keep Z even in glow
                 textureStore(outTex, coords + vec2i(1, 0), dim);
                 textureStore(outTex, coords - vec2i(1, 0), dim);
            }
        }
    `)
        /**
         * PASS 0: Temporal Accumulation & DOF
         * This uses prevPass0 to blend frames over time.
         */
        .addPass(`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv;
            
            // 1. Get raw particle data and history
            let current = textureSampleLevel(computeTex, samp, uv, 0.0);
            let history = textureSampleLevel(prevPass0, samp, uv, 0.0).rgb;

            // 2. Depth of Field (Focus is at 1.5 distance)
            let coc = abs(current.a - 1.5) * 0.012;
            let jitter = vec2f(cos(u.time * 20.0), sin(u.time * 20.0)) * coc;
            let blurred = textureSampleLevel(computeTex, samp, uv + jitter, 0.0).rgb;
            
            // Selectively blur based on Circle of Confusion
            let bloom = select(current.rgb, (current.rgb + blurred) * 1.5, coc > 0.002);

            // 3. Galactic Background (Preserved)
            let d = length(uv * 2.0 - 1.0);
            let bgGlow = (0.005 / pow(d, 1.5)) * vec3f(0.1, 0.2, 0.5);

            // 4. Temporal Accumulation (Trails/Persistence)
            // 0.92 = high persistence for creamy star-trails
            let fin = mix(bloom + bgGlow, history, 0.92);

            return vec4f(fin, 1.0);
        }
    `)
        /**
         * MAIN: Post-Process Compositing
         * We swap textureSample(computeTex...) for textureSample(pass0...)
         * to see the accumulated results.
         */
        .main(`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv;
            let centerDist = length(uv - 0.5);
            
            // Chromatic aberration using our new smooth Pass0 result
            let shift = centerDist * 0.015;
            let r = textureSample(pass0, samp, uv + vec2f(shift, 0.0)).r;
            let g = textureSample(pass0, samp, uv).g;
            let b = textureSample(pass0, samp, uv - vec2f(shift, 0.0)).b;
            
            let combined = vec3f(r, g, b);

            // Filmic Curve
            let x = max(vec3f(0.0), combined - 0.004);
            let mapped = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);

            return vec4f(mapped * smoothstep(1.0, 0.2, centerDist), 1.0);
        }
    `)
        .run();
});
