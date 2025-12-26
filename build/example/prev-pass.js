"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TinyShade_1 = require("../TinyShade");
document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade_1.TinyShade.create("canvas");
    app.setUniforms().addPass(`
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
            
            for (var j: f32 = 0.0; j < 6.0; j += 1.0) {
                p = m * p;
                n = m * n;
                let q = p * 1.5 + u.time * 0.5 + n;
                warp_accum += dot(cos(q), vec2f(0.2));
                n -= sin(q);
            }

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

            // --- THE CORE BLOOM ADDITION ---
            // Sample the history to create persistence
            let history = textureSampleLevel(prevPass0, samp, in.uv, 0.0).rgb;

            let blood_red = vec3f(0.3, 0.01, 0.03);
            let cell_color = vec3f(1.0, 0.7, 0.6);
            
            let membrane = smoothstep(0.4, 0.1, min_dist);
            let glow_val = (1.0 - min_dist) * warp_accum;
            
            var current_rgb = mix(blood_red, cell_color, membrane);
            current_rgb += glow_val * vec3f(1.0, 0.3, 0.1);

            // Temporal Mix: Keeps 85% of history to create "Light Accumulation"
            // This turns flickering bright spots into a smooth glow
            let final_rgb = mix(current_rgb, history, 0.85);

            return vec4f(final_rgb, 1.0);
        }
    `)
        .main(`
        @fragment 
        fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv;
            
            // 1. Sample the sharp result from pass0
            let scene = textureSample(pass0, samp, uv).rgb;

            // 2. Sample multiple times from pass0 with offsets to create a real Bloom
            // This creates a "cheap" Gaussian blur effect
            let b_radius = 0.005;
            var bloom = textureSample(pass0, samp, uv + vec2f(b_radius, b_radius)).rgb;
            bloom += textureSample(pass0, samp, uv + vec2f(-b_radius, b_radius)).rgb;
            bloom += textureSample(pass0, samp, uv + vec2f(b_radius, -b_radius)).rgb;
            bloom += textureSample(pass0, samp, uv + vec2f(-b_radius, -b_radius)).rgb;
            bloom *= 0.25;

            // 3. Screen/Additive blend for the glow
            // We isolate the highlights only: max(bloom - threshold, 0.0)
            let glow = max(bloom - 0.2, vec3f(0.0)) * 2.5;
            
            // 4. Final Color + Bloom + Vignette
            let vignette = smoothstep(1.2, 0.3, length(uv - 0.5));
            return vec4f((scene + glow) * vignette, 1.0);
        }
    `)
        .run();
});
