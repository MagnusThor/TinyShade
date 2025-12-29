import { RollingAverage, WebGPUTiming } from "../plugins/WebGPUTiming";
import { TinyShade } from "../TinyShade";

document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade.create("canvas");

    const COUNT = 5_000; 
    const STORAGE_SIZE = COUNT * 4; 

    // --- Stats UI ---
    const stats = document.createElement("div");
    stats.style.cssText = "position:absolute;top:10px;left:10px;color:#0f0;font-family:monospace;background:rgba(0,0,0,0.8);padding:10px;border-radius:5px;pointer-events:none;z-index:100;line-height:1.4;font-size:12px;border:1px solid #333;";
    document.body.appendChild(stats);

    const avg = new RollingAverage(60);
    const timing = new WebGPUTiming(app.device, (results) => {
        let displayStr = "";
        let totalFrameTime = 0;

        results.forEach(res => {
            displayStr += `${res.name.padEnd(12)} : ${res.ms.toFixed(3)} ms\n`;
            totalFrameTime += res.ms;
        });

        avg.add(totalFrameTime);
        displayStr += `---------------------------\n`;
        displayStr += `${"Total GPU".padEnd(12)} : ${avg.get().toFixed(3)} ms`;
        
        stats.innerText = displayStr;
    });

    (await app.setUniforms(l => {
        l.addUniform({ name: "count", value: COUNT });
    })
        /**
         * PASS 0 (Compute): Update 3D Particles
         */
        .addCompute("computeTex0",/*wgsl*/`
        ##WORKGROUP_SIZE
        fn main(@builtin(global_invocation_id) id: vec3u) {
            let res = vec2f(u.resolution.xy);
            if (f32(id.x) < res.x && f32(id.y) < res.y) {
                textureStore(outTex, id.xy, vec4f(0.0));
            }

            let i = id.x;
            if (i >= u32(u.count)) { return; }
            
            let b = i * 4u;
            var p = vec4f(data[b], data[b+1], data[b+2], data[b+3]);

            p.z -= 0.0005 + (fract(f32(i) * 0.13) * 0.0007);

            if (p.z < 0.1 || u.time < 0.1) {
                let angle = fract(f32(i) * 0.001) * 6.28 + u.time * 0.2;
                let radius = 0.5 + fract(f32(i) * 0.5) * 2.0;
                p.x = cos(angle) * radius;
                p.y = sin(angle) * radius;
                p.z = 4.0 + fract(f32(i) * 123.45);
                p.w = 0.1 + fract(f32(i) * 7.7) * 0.5;
            }

            p.x += sin(p.z + u.time) * 0.001;
            p.y += cos(p.z + u.time) * 0.001;

            data[b] = p.x; data[b+1] = p.y; data[b+2] = p.z; data[b+3] = p.w;

            let aspect = res.x / res.y;
            let screenX = (p.x / p.z);
            let screenY = (p.y / (p.z * aspect));

            let coords = vec2i(
                i32((screenX * 0.5 + 0.5) * res.x), 
                i32((screenY * 0.5 + 0.5) * res.y)
            );
            
            if(coords.x <= 1 || coords.x >= i32(res.x)-1 || coords.y <= 1 || coords.y >= i32(res.y)-1) { return; }

            let depthFactor = saturate(1.0 - (p.z / 4.0));
            let color = mix(vec3f(0.0, 0.1, 0.5), vec3f(0.2, 0.9, 1.0), depthFactor);
            
            textureStore(outTex, coords, vec4f(color * (depthFactor * 3.0), 1.0));
        }
    `, STORAGE_SIZE)

        /**
         * PASS 1 (Fragment): The Trail Feedback Loop
         */
        .addPass("trails",/*wgsl*/`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let dots = textureSample(computeTex0, samp, in.uv).rgb;
            let oldTrails = textureSample(prev_trails, samp, in.uv).rgb;
            let fade = oldTrails * 0.4;
            return vec4f(dots + fade, 1.0);
        }
    `)

        /**
         * PASS 2 (Fragment): Dark Background
         */
        .addPass("background",/*wgsl*/`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv * 2.0 - 1.0;
            let d = length(uv);
            let glow = 0.005 / pow(d, 1.5);
            return vec4f(glow * vec3f(0.1, 0.2, 0.5), 1.0);
        }
    `)

        /**
         * MAIN PASS: Composition
         */
        .main(/*wgsl*/`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv;
            let centerDist = length(uv - 0.5);
            
            let shift = centerDist * 0.012;
            let r = textureSample(trails, samp, uv + vec2f(shift, 0.0)).r;
            let g = textureSample(trails, samp, uv).g;
            let b = textureSample(trails, samp, uv - vec2f(shift, 0.0)).b;
            
            let combined = textureSample(background, samp, uv).rgb + vec3f(r, g, b);

            let x = max(vec3f(0.0), combined - 0.004);
            let mapped = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);

            return vec4f(mapped * smoothstep(1.0, 0.2, centerDist), 1.0);
        }
    `))
    .run(timing);
});