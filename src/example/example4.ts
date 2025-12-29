import { TinyShade } from "../TinyShade";

document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade.create("canvas");

    const COUNT = 1_000_000;
    const PHYSICS_SIZE = COUNT * 4; 
    const HEATMAP_SIZE = app.canvas.width * app.canvas.height;

    (await app.setUniforms(l => {
        l.addUniform({ name: "count", value: COUNT });
    })
        .addCompute("physics", /*wgsl*/`
        ##WORKGROUP_SIZE
        fn main(@builtin(global_invocation_id) id: vec3u) {
            let i = id.x;
            if (i >= u32(u.count)) { return; }
            
            let b = i * 4u;
            var p = vec4f(data[b], data[b+1], data[b+2], data[b+3]);

            p.z -= 0.004 + (fract(f32(i) * 0.13) * 0.006);

            if (p.z < 0.1 || u.time < 0.1) {
                let angle = fract(f32(i) * 0.001) * 6.28 + u.time * 0.05;
                let radius = 0.2 + fract(f32(i) * 0.5) * 2.5;
                p.x = cos(angle) * radius;
                p.y = sin(angle) * radius;
                p.z = 4.0 + fract(f32(i) * 123.45);
            }

            p.x += sin(p.z * 2.0 + u.time) * 0.0015;
            p.y += cos(p.z * 2.0 + u.time) * 0.0015;

            data[b] = p.x; data[b+1] = p.y; data[b+2] = p.z; data[b+3] = p.w;
        }
        `, PHYSICS_SIZE)

        .addAtomicCompute("heatmap", /*wgsl*/`
        ##WORKGROUP_SIZE
        fn main(@builtin(global_invocation_id) id: vec3u) {
            let i = id.x;
            if (i >= u32(u.count)) { return; }
            let b = i * 4u;
            let p = vec3f(physics_data[b], physics_data[b+1], physics_data[b+2]);

            let res = u.resolution.xy;
            let screen = vec2f(p.x / p.z, p.y / (p.z * (res.x/res.y))) * 0.5 + 0.5;
            let coords = vec2i(screen * res);
            
            if(coords.x >= 0 && coords.x < i32(res.x) && coords.y >= 0 && coords.y < i32(res.y)) {
                let idx = u32(coords.y) * u32(res.x) + u32(coords.x);
                atomicAdd(&data[idx], 1u); 
            }
        }
        `, HEATMAP_SIZE)

        .addPass("accum", /*wgsl*/`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let res = u.resolution.xy;
            let idx = u32(in.uv.y * res.y) * u32(res.x) + u32(in.uv.x * res.x);
            
            let val = f32(atomicLoad(&heatmap_data[idx]));
            
            let colIndigo = vec3f(0.07, 0.0, 0.25); // Gas
            let colAzure  = vec3f(0.0, 0.3, 1.0);  // Young Stars
            let colCyan   = vec3f(0.4, 1.0, 0.9);  // Hot Stars
            let colWhite  = vec3f(1.0, 1.0, 1.0);  // Core
            
            var dots = mix(colIndigo, colAzure, saturate(val * 0.1));
            dots = mix(dots, colCyan, saturate(val * 0.02 - 0.2));
            dots = mix(dots, colWhite, saturate(val * 0.01 - 0.8));
            
            dots *= val * 0.6; 
            
            let d = 1.2 / res;
            let history = (
                textureSample(prev_accum, samp, in.uv + vec2f(d.x, d.y)).rgb +
                textureSample(prev_accum, samp, in.uv + vec2f(-d.x, d.y)).rgb +
                textureSample(prev_accum, samp, in.uv + vec2f(d.x, -d.y)).rgb +
                textureSample(prev_accum, samp, in.uv + vec2f(-d.x, -d.y)).rgb
            ) * 0.25;
            
            return vec4f(max(dots, history * 0.97), 1.0);
        }
        `)

        .main(/*wgsl*/`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv;
            let centerDist = length(uv - 0.5);
            
            let shift = centerDist * 0.02;
            let r = textureSample(accum, samp, uv + vec2f(shift, 0.0)).r;
            let g = textureSample(accum, samp, uv).g;
            let b = textureSample(accum, samp, uv - vec2f(shift, 0.0)).b;
            
            var color = vec3f(r, g, b);

            color = pow(color, vec3f(0.85)); 
            
      
            color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
            
            let vignette = smoothstep(1.2, 0.25, centerDist);
            return vec4f(color * vignette, 1.0);
        }
        `))
        .run();
});