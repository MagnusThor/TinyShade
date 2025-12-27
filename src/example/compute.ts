import { TinyShade } from "../TinyShade";

document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade.create("canvas");

    (await app.setUniforms()
        /**
         * COMPUTE PASS: Fractal Orbit Trap
         */
        .addCompute(0, `
         const AA: i32 = 3;
        const sqrt2_inv: f32 = 0.70710678118;
        //##WORKGROUP_SIZE
        @compute @workgroup_size(8, 8, 1)
        fn main(@builtin(global_invocation_id) id: vec3u) {
           const AA: i32 = 3;
            const sqrt2_inv: f32 = 0.70710678118;

            let R = u.resolution;
            // Guard against out-of-bounds if resolution isn't multiple of 8
            if (f32(id.x) >= R.x || f32(id.y) >= R.y) { return; }

            let fragCoord = vec2f(f32(id.x), f32(id.y));
            var col = vec3f(0.0);

            // Precompute constant values
            let zoo = 1.0 / (350.0 - 250.0 * sin(fma(0.25, u.time, -0.3))); 
            let t2c_base = vec2f(-0.5, 2.0) + 0.5 * vec2f(
                cos(fma(0.13, u.time, -1.3)), 
                sin(fma(0.13, u.time, -1.3))
            );

            // Anti-Aliasing Loop
            for (var m: i32 = 0; m < AA; m++) {
                for (var n: i32 = 0; n < AA; n++) {
                    let p = (2.0 * (fragCoord + vec2f(f32(m), f32(n)) / f32(AA)) - R.xy) / R.y;

                    let cc = vec2f(-0.533516, 0.526141) + p * zoo;  
                    var z = vec2f(0.0);  
                    var dz = vec2f(0.0);
                    var trap1: f32 = 0.0;  
                    var trap2: f32 = 1e20;
                    var co2: f32 = 0.0;  

                    for (var i: i32 = 0; i < 150; i++) {
                        dz = vec2f(fma(2.0 * z.x, dz.x, -2.0 * z.y * dz.y), 
                                   fma(2.0 * z.x, dz.y, 2.0 * z.y * dz.x)) + vec2f(1.0, 0.0);
                        z = cc + vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);

                        let shouldBreak = dot(z, z) > 1024.0;
                        if (shouldBreak) { break; } 

                        let z_offset = z - vec2f(0.0, 1.0);
                        let d1 = abs(dot(z_offset, vec2f(sqrt2_inv)));
                        let ff = 1.0 - smoothstep(0.6, 1.4, d1);
                        co2 = fma(ff, d1, co2); 
                        trap1 = fma(ff, d1, trap1); 
                        trap2 = min(trap2, dot(z - t2c_base, z - t2c_base)); 
                    }

                    let d = sqrt(dot(z, z) / dot(dz, dz)) * log(dot(z, z));
                    let c1 = pow(clamp(2.0 * d / zoo, 0.0, 1.0), 0.5);
                    let c2 = pow(clamp(1.5 * trap1 / co2, 0.0, 1.0), 2.0);
                    let c3 = pow(clamp(0.4 * trap2, 0.0, 1.0), 0.25);

                    let factor1 = 3.0 + 4.0 * c2; 
                    let factor2 = 4.1 + 2.0 * c3;

                    col += 2.0 * sqrt(c1 * (0.5 + 0.5 * sin(factor1 + vec3f(0.0, 0.5, 1.0))) * (0.5 + 0.5 * sin(factor2 + vec3f(1.0, 0.5, 0.0))));
                }
            }

            col /= f32(AA * AA);
            textureStore(outTex, id.xy, vec4f(col, 1.0)); 
        }
    `)
        /**
         * MAIN: Final Post-Process
         */
        .main(`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv;
            let fractal = textureSample(computeTex, samp, uv).rgb;
            
            // Add a subtle vignette and contrast
            let vignette = smoothstep(1.5, 0.3, length(uv - 0.5));
            let color = pow(fractal * vignette, vec3f(1.1));
            
            return vec4f(color, 1.0);
        }
    `))
    .run();
});