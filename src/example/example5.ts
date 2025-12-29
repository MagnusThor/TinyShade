import { TinyShade } from "../TinyShade";
import { RollingAverage, WebGPUTiming } from "../plugins/WebGPUTiming";

document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade.create("canvas");

    const stats = document.createElement("div");
    stats.style.cssText = "position:absolute;top:10px;left:10px;color:#0f0;font-family:monospace;background:rgba(0,0,0,0.8);padding:10px;border-radius:5px;pointer-events:none;z-index:100;line-height:1.4;";
    document.body.appendChild(stats);

    // Shared Mandelbox logic for both Compute (Collision) and Main (Rendering)
    const mandelboxSDF = /*wgsl*/ `
        const SCALE: f32 = 2.8;
        const MIN_RAD_SQ: f32 = 0.25;
        const FIXED_RAD_SQ: f32 = 1.0;

        fn boxFold(v: vec3f) -> vec3f { return clamp(v, vec3f(-1.0), vec3f(1.0)) * 2.0 - v; }
        fn sphereFold(v: vec3f) -> vec3f {
            let r2 = dot(v, v);
            if (r2 < MIN_RAD_SQ) { return v * (FIXED_RAD_SQ / MIN_RAD_SQ); }
            else if (r2 < FIXED_RAD_SQ) { return v * (FIXED_RAD_SQ / r2); }
            return v;
        }

        fn map(p: vec3f) -> f32 {
            var offset = p; var v = p; var dr = 1.0;
            for (var i = 0; i < 12; i++) {
                v = boxFold(v); v = sphereFold(v);
                v = SCALE * v + offset;
                dr = dr * abs(SCALE) + 1.0;
            }
            return length(v) / abs(dr);
        }
    `;

    const COUNT = 1000000; // Bumped to 1M for stress test
    const STORAGE_SIZE = COUNT * 4; 

    const avg = new RollingAverage(60);
    const timing = new WebGPUTiming(app.device, (results) => {
        const compTime = results.find(r => r.name === "comp0")?.ms || 0;
        const mainTime = results.find(r => r.name === "main")?.ms || 0;
        const total = compTime + mainTime;

        if (total > 0) {
            avg.add(total);
            const currentAvg = avg.get();
            stats.innerText = `OBSIDIAN FRACTAL\nGPU: ${currentAvg.toFixed(3)} ms\nParticles: 1M (SDF Collision)\nLoad: ${((currentAvg / 16.6) * 100).toFixed(1)}%`;
        }
    });

    (await app.setUniforms(l => {
        l.addUniform({ name: "count", value: COUNT });
    })
        /**
         * COMPUTE PASS 0: Particle Field with SDF Collision
         */
        .addCompute("computeTex0", /*wgsl*/`
        ${mandelboxSDF}

        ##WORKGROUP_SIZE
        fn main(@builtin(global_invocation_id) id: vec3u) {
            let res = vec2f(u.resolution.xy);
            
            // Manual Clear: Since outTex is a storage texture, we clear the pixel we own
            if (f32(id.x) < res.x && f32(id.y) < res.y) {
                textureStore(outTex, id.xy, vec4f(0.0));
            }

            let i = id.x;
            if (i >= u32(u.count)) { return; }
            
            let b = i * 4u;
            var p = vec4f(data[b], data[b+1], data[b+2], data[b+3]);

            p.z -= 0.004; // High speed movement

            // COLLISION DETECTION: Check distance to fractal
            let d = map(p.xyz);

            // Reset if hit fractal surface, go past camera, or initial frame
            if (d < 0.012 || p.z < 0.05 || u.time < 0.1) {
                let ang = fract(f32(i) * 0.013) * 6.28 + u.time * 0.1;
                let rad = 0.5 + fract(f32(i) * 0.7) * 4.0;
                p.x = cos(ang) * rad;
                p.y = sin(ang) * rad;
                p.z = 4.5 + fract(f32(i) * 0.5);
            }
            data[b] = p.x; data[b+1] = p.y; data[b+2] = p.z; data[b+3] = p.w;

            // Project to screen
            let screenX = (p.x / p.z);
            let screenY = (p.y / (p.z * (res.x/res.y)));
            let coords = vec2i(
                i32((screenX * 0.5 + 0.5) * res.x), 
                i32((screenY * 0.5 + 0.5) * res.y)
            );

            if(coords.x > 0 && coords.x < i32(res.x) && coords.y > 0 && coords.y < i32(res.y)) {
                let lum = saturate(1.0 - (p.z / 4.5));
                // Hot cyan to white-blue based on depth
                let col = mix(vec3f(0.1, 0.4, 1.0), vec3f(0.7, 0.9, 1.0), lum);
                textureStore(outTex, coords, vec4f(col * lum * 2.0, 1.0));
            }
        }
    `, STORAGE_SIZE)

        /**
         * MAIN PASS: Mandelbox Fractal + Particle Composite
         */
        .main( /*wgsl*/`
        ${mandelboxSDF}

        fn getNormal(p: vec3f) -> vec3f {
            let e = vec2f(0.001, 0.0);
            return normalize(vec3f(map(p+e.xyy)-map(p-e.xyy), map(p+e.yxy)-map(p-e.yxy), map(p+e.yyx)-map(p-e.yyx)));
        }

        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let res = u.resolution.xy;
            let uv = (in.pos.xy - 0.5 * res) / res.y;
            
            let time = u.time * 0.06;
            let ro = vec3f(4.2 * cos(time), 1.2 * sin(time * 0.5), 4.2 * sin(time));
            let ta = vec3f(0.0, 0.0, 0.0);
            let ww = normalize(ta - ro);
            let uu = normalize(cross(ww, vec3f(0.0, 1.0, 0.0)));
            let vv = normalize(cross(uu, ww));
            let rd = normalize(uv.x * uu + uv.y * vv + 2.2 * ww);

            var t = 0.01; var hit = false;
            for(var i = 0; i < 110; i++) {
                let d = map(ro + rd * t);
                if(d < 0.0007) { hit = true; break; }
                t += d;
                if(t > 14.0) { break; }
            }

            // Dark Obsidian Base
            var col = vec3f(0.002, 0.004, 0.008); 

            if(hit) {
                let p = ro + rd * t;
                let n = getNormal(p);
                
                // Dark metallic diffuse
                let diff = max(dot(n, normalize(vec3f(1.0, 2.0, 3.0))), 0.0);
                // Sharp electric rim lighting
                let rim = pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
                
                col = vec3f(0.01, 0.015, 0.025) * diff;
                col += vec3f(0.1, 0.4, 0.8) * rim;
                
                // Distance fog to keep it moody
                col *= exp(-0.25 * t);
            }

            // Composite Particles (from ComputePass 0)
            let particles = textureSample(computeTex0, samp, in.uv).rgb;
            
            // Additive blend with exposure boost
            let fin= col + particles;

            // Tonemapping to crush blacks and boost highlights
            return vec4f(pow(fin, vec3f(0.65)), 1.0);
        }
    `))
    .run(timing);
});