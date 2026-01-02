import { TinyShade } from "../TinyShade";

document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade.create("canvas");

    const dpr = window.devicePixelRatio || 1;
    app.canvas.width = window.innerWidth * dpr;
    app.canvas.height = window.innerHeight * dpr;

    const COUNT = 1_000_000;
    const HEATMAP_SIZE = app.canvas.width * app.canvas.height;

    const sdfLogic = /*wgsl*/`
        fn map(p: vec3f, t: f32) -> f32 {
            let s = sin(t * 0.4) * 0.5 + 0.5;
            let sphere = length(p) - 1.2;
            var q = abs(p);
            var d = max(q.x, max(q.y, q.z)) - 1.0;
            for (var i = 0u; i < 2u; i++) {
                let a = fract(q * 2.5) - 0.5;
                q = abs(a);
                d = max(d, (0.5 - max(q.x, max(q.y, q.z))) / 2.5);
            }
            return mix(d, sphere, s);
        }
    `;

    (await app.setUniforms(l => {
        l.addUniform({ name: "count", value: COUNT });
    })
        .addCompute("physics", /*wgsl*/`
        ${sdfLogic}
        ##WORKGROUP_SIZE
        fn main(@builtin(global_invocation_id) id: vec3u) {
            let i = id.x; if (i >= u32(u.count)) { return; }
            let b = i * 4u;
            var p = vec3f(data[b], data[b+1], data[b+2]);
            
            if (u.time < 0.1 || length(p) > 5.0) {
                let seed = f32(i);
                data[b] = (fract(sin(seed) * 43758.5) - 0.5) * 4.0;
                data[b+1] = (fract(sin(seed + 1.1) * 43758.5) - 0.5) * 4.0;
                data[b+2] = (fract(sin(seed + 2.2) * 43758.5) - 0.5) * 4.0;
                return;
            }

            let d = map(p, u.time);
            let e = 0.01;
            let grad = normalize(vec3f(
                map(p + vec3f(e, 0, 0), u.time) - map(p - vec3f(e, 0, 0), u.time),
                map(p + vec3f(0, e, 0), u.time) - map(p - vec3f(0, e, 0), u.time),
                map(p + vec3f(0, 0, e), u.time) - map(p - vec3f(0, 0, e), u.time)
            ));

            let moveSpeed = 0.001; 
            let swirlSpeed = 0.002; 

            p -= grad * d * moveSpeed; 
            p += cross(grad, vec3f(0.0, 1.0, 0.0)) * swirlSpeed; 

            data[b] = p.x; data[b+1] = p.y; data[b+2] = p.z;
            data[b+3] = saturate(1.0 - abs(d) * 5.0); 
        }
        `, COUNT * 4)

        .addAtomicCompute("heatmap", /*wgsl*/`
        ##WORKGROUP_SIZE
        fn main(@builtin(global_invocation_id) id: vec3u) {
            let i = id.x; if (i >= u32(u.count)) { return; }
            let p = vec3f(physics_data[i*4u], physics_data[i*4u+1], physics_data[i*4u+2]);
            let life = physics_data[i*4u+3];

            let t = u.time * 0.2;
            let rot = vec3f(p.x * cos(t) - p.z * sin(t), p.y, p.x * sin(t) + p.z * cos(t));
            
            let z_dist = rot.z + 5.0;
            let screen = rot.xy / z_dist;
            let res = u.resolution.xy;
            let center = vec2i((screen * 2.0 + 0.5) * res);
            
            for(var x = -1; x <= 1; x++) {
                for(var y = -1; y <= 1; y++) {
                    let coords = center + vec2i(x, y);
                    if(coords.x >= 0 && coords.x < i32(res.x) && coords.y >= 0 && coords.y < i32(res.y)) {
                        let weight = select(5u, 10u, x == 0 && y == 0);
                        let energy = u32(life * f32(weight) / (z_dist * 0.4));
                        atomicAdd(&data[u32(coords.y) * u32(res.x) + u32(coords.x)], energy); 
                    }
                }
            }
        }
        `, HEATMAP_SIZE)

        .addPass("streaks", /*wgsl*/`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let res = u.resolution.xy;
            let idx = u32(in.uv.y * res.y) * u32(res.x) + u32(in.uv.x * res.x);
            let current = f32(atomicLoad(&heatmap_data[idx])) * 0.05;

            let dir = in.uv - 0.5;
            let prev = textureSample(prev_streaks, samp, in.uv - dir * 0.005).rgb;
            
            let col = mix(vec3f(current), prev, 0.6);
            return vec4f(col, 1.0);
        }
        `)

        .main(/*wgsl*/`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let s = textureSample(streaks, samp, in.uv).r;
            
            // 1. TOPOGRAPHIC CONTOUR LINES
            // We use sin() on the density to create recurring sharp bands
            let lineFrequency = 40.0;
            let lines = sin(s * lineFrequency - u.time * 2.0);
            let mask = smoothstep(0.8, 0.95, lines); // Sharpen the sin wave into lines
            
            // 2. FAKE DEPTH SURFACE
            let threshold = 0.1;
            let surface = smoothstep(threshold, threshold + 0.05, s);
            
            // 3. COLOR PALETTE
            let bgColor = vec3f(0.01, 0.02, 0.05);
            let scanColor = vec3f(0.2, 0.8, 1.0); // Cyber Cyan
            let coreColor = vec3f(0.8, 0.2, 1.0); // Neon Purple
            
            // Layering the effects
            var finalCol = mix(bgColor, coreColor * s, surface * 0.3);
            finalCol += mask * scanColor * s * 2.0; // Glowing scan lines
            
            // Add a "rim light" where the density starts
            let rim = smoothstep(0.05, 0.0, abs(s - threshold));
            finalCol += rim * scanColor;

            // Final vignette for focus
            finalCol *= smoothstep(0.8, 0.3, length(in.uv - 0.5));
            
            return vec4f(finalCol, 1.0);
        }
        `))
        .run();
});