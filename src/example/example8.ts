import { TinyShade } from "../TinyShade";
import { TinyShadeBake } from "../TinyShadeBake";
import { minifyJS } from "../helpers/minifyJS";
import { TinyShadeRunner } from "../TinyShaderRunner";
/*
This path tracer is a WebGPU-optimized adaptation of the brilliant work by Mårten Rånge, specifically inspired by his "Festive Path Tracer." It translates his sophisticated GLSL Monte Carlo logic into a high-performance, branchless WebGPU compute architecture.
Original GLSL Shader found at https://www.shadertoy.com/view/tfyczc
*/
const start = async () => {
    const app = await TinyShade.create("canvas");



    document.querySelector("canvas")?.addEventListener("click", async () => {


        const minifiedRunnerCode = await minifyJS(TinyShadeRunner.toString());
        
        console.info(`Runner size ${minifiedRunnerCode.code!.length} bytes (${(minifiedRunnerCode.code!.length / 1024).toFixed(2)} KB)`)

        await TinyShadeBake.downloadSelfContained(app, "release_demo.html",minifiedRunnerCode.code);


    });

    (await app
        .setUniforms()
        .addCommon(/*wgsl*/`
            const PI: f32 = 3.141592654;
            const TAU: f32 = 6.283185307;

            fn ray_unitsphere(ro: vec3f, rd: vec3f) -> f32 {
                let b = dot(ro, rd);
                let c = dot(ro, ro) - 1.0;
                let h = b*b - c;
                if(h < 0.0) { return -1.0; }
                return -b - sqrt(h);
            }

            fn hash21(p: vec2f) -> f32 {
                return fract(sin(dot(p, vec2f(12.9898, 58.233))) * 43758.5453);
            }

            fn orth_base(n: vec3f) -> mat3x3f {
                let up = select(vec3f(0,1,0), vec3f(0,0,1), abs(n.y) > 0.999);
                let x = normalize(cross(up, n));
                let y = cross(n, x);
                return mat3x3f(x, y, n);
            }

            fn uniform_lambert(n: vec3f, seed: ptr<function, u32>) -> vec3f {
                let r1 = rand(seed);
                let r2 = rand(seed);
                let p = TAU * r1;
                let cost = sqrt(r2);
                let sint = sqrt(1.0 - r2);
                return orth_base(n) * vec3f(cos(p)*sint, sin(p)*sint, cost);
            }

            fn pcg_hash(input: u32) -> u32 {
                var state = input * 747796405u + 2891336453u;
                var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
                return (word >> 22u) ^ word;
            }

            fn rand(seed: ptr<function, u32>) -> f32 {
                *seed = pcg_hash(*seed);
                return f32(*seed) / f32(0xffffffffu);
            }
        `)
        .addCompute("computeTex0",/*wgsl*/`
            ##WORKGROUP_SIZE
            //@compute workgroup_size(8, 8, 1)
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = u.resolution.xy;
                if (f32(id.x) >= res.x || f32(id.y) >= res.y) { return; }

                var seed = pcg_hash(id.x + id.y * u32(res.x) + u32(u.time * 1000.0));
                
                // Camera Settings
                let ro = vec3f(4.0, 4.0, -6.0);
                let la = vec3f(0.0, 0.5, -2.0);
                let cam_fwd = normalize(la - ro);
                let cam_right = normalize(cross(cam_fwd, vec3f(0,1,0)));
                let cam_up = cross(cam_right, cam_fwd);

                // Sphere animation
                var bounce = fract(u.time);
                bounce -= 0.5;
                bounce *= 2.0 * bounce;
                var sphere_center = la;
                sphere_center.y -= bounce;
                sphere_center.x += sin(u.time * 0.5);
                sphere_center.z += sin(u.time * 0.3535);

                var total_radiance = vec3f(0.0);
                
                // --- THE BIG LOOP ---
                // We trace 128 paths per frame for high detail
                let samples_per_frame = 128;
                for (var s = 0; s < samples_per_frame; s++) {
                    
                    let jitter = vec2f(rand(&seed), rand(&seed)) - 0.5;
                    let p = (vec2f(f32(id.x), res.y - f32(id.y)) + jitter) * 2.0 / res.y - vec2f(res.x/res.y, 1.0);
                    let rd = normalize(-p.x * cam_right + p.y * cam_up + 2.0 * cam_fwd);

                    var radiance = vec3f(0.0);
                    var throughput = vec3f(1.0);
                    var curr_ro = ro;
                    var curr_rd = rd;

                    // Trace path (Max 4 bounces for performance inside the 128 loop)
                    for (var i = 0; i < 4; i++) {
                        let t_floor = (-1.0 - curr_ro.y) / curr_rd.y;
                        let t_wall = (1.0 - curr_ro.z) / curr_rd.z;
                        let t_sphere = ray_unitsphere(curr_ro - sphere_center, curr_rd);

                        var t = 1e3;
                        var normal = vec3f(0.0);
                        var hit_obj = 0;

                        if (t_floor > 0.001) { t = t_floor; normal = vec3f(0,1,0); hit_obj = 1; }
                        if (t_wall > 0.001 && t_wall < t) { t = t_wall; normal = vec3f(0,0,-1); hit_obj = 2; }
                        if (t_sphere > 0.001 && t_sphere < t) { 
                            t = t_sphere; 
                            normal = normalize(curr_ro + curr_rd * t_sphere - sphere_center); 
                            hit_obj = 3; 
                        }

                        if (hit_obj == 0 || t == 1e3) { break; }

                        let pos = curr_ro + curr_rd * t;
                        let wall_pos = pos.xy - vec2f(u.time, 0.5);
                        let cell_idx = floor(wall_pos + 0.5);
                        let cell_h = hash21(cell_idx * 123.4);

                        // Light Hits
                        if (hit_obj == 2 && cell_h > 0.9) {
                            let cell_uv = wall_pos - cell_idx;
                            radiance += throughput * (1.1 - length(cell_uv) + sin(vec3f(2,1,0) + TAU * fract(8667.0 * cell_h)));
                            break;
                        }
                        if (hit_obj == 1 && abs(pos.z + 2.0) < 0.1 && sin(wall_pos.x) > 0.0) {
                            radiance += throughput * vec3f(1.0, 0.5, 0.0);
                            break;
                        }

                        // Reflection Math
                        let fresnel = pow(1.0 + dot(curr_rd, normal), 5.0);
                        let is_mirror_wall = (hit_obj == 2 && fract(cell_h * 7677.0) > 0.5);
                        
                        if (rand(&seed) < fresnel || is_mirror_wall || hit_obj == 3) {
                            curr_rd = reflect(curr_rd, normal);
                            throughput *= 0.9;
                        } else {
                            curr_rd = uniform_lambert(normal, &seed);
                            throughput *= 0.4;
                        }
                        curr_ro = pos + normal * 0.001;
                    }
                    total_radiance += radiance;
                }

                textureStore(outTex, id.xy, vec4f(total_radiance / f32(samples_per_frame), 1.0));
            }
        `,0)
        .addPass("pass1",/*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let current = textureSample(computeTex0, samp, in.uv).rgb;
                let history = textureSample(prev_pass1, samp, in.uv).rgb;
                return vec4f(mix(current, history, 0.5), 1.0);
            }
        `)
        .main(/*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let col = textureSample(pass1, samp, in.uv).rgb;
                return vec4f(sqrt(col), 1.0);
            }
        `)
    ).run();
};

start();