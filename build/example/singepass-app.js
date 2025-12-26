"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TinyShade_1 = require("../TinyShade");
document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade_1.TinyShade.create("canvas");
    app.setUniforms().addPass(`
        // Helper functions injected into the pass
        fn hash22(p: vec2f) -> vec2f {
            var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.xx + p3.yz) * p3.zy);
        }

        fn rotate2D(r: f32) -> mat2x2f {
            let c = cos(r); let s = sin(r);
            return mat2x2f(c, s, -s, c);
        }

        @fragment 
        fn main(in: VSOut) -> @location(0) vec4f {
            let res = u.resolution.xy;
            let uv = (in.pos.xy - 0.5 * res) / res.y;

            var p = uv;
            var n = vec2f(0.0);
            var warp_accum = 0.0;
            let m = rotate2D(5.0);
            
            // 1. Warping Layer
            for (var j: f32 = 0.0; j < 6.0; j += 1.0) {
                p = m * p;
                n = m * n;
                let q = p * 1.5 + u.time * 0.5 + n;
                warp_accum += dot(cos(q), vec2f(0.2));
                n -= sin(q);
            }

            // 2. Cellular / Voronoi Logic
            let cell_uv = uv * 8.0 + n; 
            let i_p = floor(cell_uv);
            let f_p = fract(cell_uv);
            
            var min_dist: f32 = 1.0;
            for (var y: f32 = -1.0; y <= 1.0; y += 1.0) {
                for (var x: f32 = -1.0; x <= 1.0; x += 1.0) {
                    let neighbor = vec2f(x, y);
                    var point = hash22(i_p + neighbor);
                    point = 0.5 + 0.5 * sin(u.time + 6.28 * point);
                    let dist = length(neighbor + point - f_p);
                    min_dist = min(min_dist, dist);
                }
            }

            // 3. Coloring
            let blood_red = vec3f(0.4, 0.02, 0.05);
            let cell_color = vec3f(1.0, 0.7, 0.6);
            
            let membrane = smoothstep(0.4, 0.1, min_dist);
            let glow = (1.0 - min_dist) * warp_accum;
            
            var final_rgb = mix(blood_red, cell_color, membrane);
            final_rgb += glow * vec3f(0.8, 0.2, 0.1);
            
            // Subtle Vignette in-pass
            final_rgb *= 1.2 - dot(uv, uv);

            return vec4f(final_rgb, 1.0);
        }
    `)
        .main(`
        @fragment 
        fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv;
            
            let fin = textureSample(pass0, samp, uv).rgb;
          
            return vec4f(fin, 1.0);
        }
    `)
        .run();
});
