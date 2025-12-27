import { TinyShade } from "../TinyShade";
import { RollingAverage, WebGPUTiming } from "../WebGPUTiming";

document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade.create("canvas");
    const gpuTimer = new WebGPUTiming((app as any).device);
    const avg = new RollingAverage(60);

    app.setUniforms()
    .main(`
        // Mandelbox Parameters
        const SCALE = 2.8;
        const MIN_RAD_SQ = 0.25;
        const FIXED_RAD_SQ = 1.0;

        fn boxFold(v: vec3f) -> vec3f {
            return clamp(v, vec3f(-1.0), vec3f(1.0)) * 2.0 - v;
        }

        fn sphereFold(v: vec3f) -> vec3f {
            let r2 = dot(v, v);
            if (r2 < MIN_RAD_SQ) {
                return v * (FIXED_RAD_SQ / MIN_RAD_SQ);
            } else if (r2 < FIXED_RAD_SQ) {
                return v * (FIXED_RAD_SQ / r2);
            }
            return v;
        }

        fn map(p: vec3f) -> f32 {
            var offset = p;
            var v = p;
            var dr = 1.0;
            
            // 12 Iterations makes it heavy for the GPU Timer
            for (var i = 0; i < 12; i++) {
                v = boxFold(v);
                v = sphereFold(v);
                v = SCALE * v + offset;
                dr = dr * abs(SCALE) + 1.0;
            }
            return length(v) / abs(dr);
        }

        // Ambient Occlusion
        fn getAO(p: vec3f, n: vec3f) -> f32 {
            var occ = 0.0;
            var sca = 1.0;
            for(var i = 0; i < 5; i++) {
                let h = 0.01 + 0.12 * f32(i) / 4.0;
                let d = map(p + n * h);
                occ += (h - d) * sca;
                sca *= 0.95;
            }
            return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
        }

        fn getNormal(p: vec3f) -> vec3f {
            let e = vec2f(0.001, 0.0);
            return normalize(vec3f(
                map(p + e.xyy) - map(p - e.xyy),
                map(p + e.yxy) - map(p - e.yxy),
                map(p + e.yyx) - map(p - e.yyx)
            ));
        }

        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let res = u.resolution.xy;
            let uv = (in.pos.xy - 0.5 * res) / res.y;
            
            // Camera setup
            let time = u.time * 0.02;
            let ro = vec3f(5.0 * cos(time), 2.0 * sin(time * 0.5), 5.0 * sin(time));
            let ta = vec3f(0.0, 0.0, -0.0);
            let ww = normalize(ta - ro);
            let uu = normalize(cross(ww, vec3f(0.0, 1.0, 0.0)));
            let vv = normalize(cross(uu, ww));
            let rd = normalize(uv.x * uu + uv.y * vv + 1.5 * ww);

            // Raymarching
            var t = 0.01;
            var hit = false;
            for(var i = 0; i < 256; i++) {
                let d = map(ro + rd * t);
                if(d < 0.001) { hit = true; break; }
                t += d;
                if(t > 20.0) { break; }
            }

            var col = vec3f(0.05, 0.06, 0.1); // Background color

            if(hit) {
                let p = ro + rd * t;
                let n = getNormal(p);
                let ao = getAO(p, n);
                
                // Simple lighting
                let lightDir = normalize(vec3f(1.0, 2.0, -1.0));
                let diff = max(dot(n, lightDir), 0.0);
                let shadow = clamp(map(p + n * 0.1) * 10.0, 0.5, 1.0); // Simple shadow
                
                let baseCol = mix(vec3f(0.1, 0.3, 0.6), vec3f(1.0, 0.8, 0.4), n.y * 0.5 + 0.5);
                col = baseCol * (diff * shadow + 0.1) * ao;
                
                // Fog
                col = mix(col, vec3f(0.05, 0.06, 0.1), 1.0 - exp(-0.02 * t * t));
            }

            return vec4f(pow(col, vec3f(0.4545)), 1.0); // Gamma correction
        }
    `)
    .run();
});