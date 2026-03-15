// src/demos/example16.ts

import { TinyShade } from "../TinyShade";
import { WavAudioPlugin } from "./WavAudioPlugin";
import { UniformLayout } from "../UniformLayout";
import { UniformUI } from "../ui/UniformUI";

const start = async () => {
    const app = await TinyShade.create("canvas");

    const audio = new WavAudioPlugin();
    await audio.load("/assets/song.wav");

    const arr_ro = [
        [0.0,  0.5,  -5.0],
        [-2.6, -2.2,  -5.0],
        [-1.5, 0.6,  -1.3],
        [-1.8, 2.2,  -4.0],
        [1.2,  2.8,  -4.5],
    ];

    let arr_ro_idx    = 0;
    let u_ro          = [...arr_ro[0]];
    let u_samples     = 4;
    let u_showLattice = 1.0;
    let u_showSphere  = 1.0;
    let u_showLights  = 1.0;
    let u_showFloor   = 1.0;

    const uniforms = (l: UniformLayout) => {
        l.addUniform({ name: "ro",          value: () => u_ro          });
        l.addUniform({ name: "samples",     value: () => u_samples     });
        l.addUniform({ name: "showLattice", value: () => u_showLattice });
        l.addUniform({ name: "showSphere",  value: () => u_showSphere  });
        l.addUniform({ name: "showLights",  value: () => u_showLights  });
        l.addUniform({ name: "showFloor",   value: () => u_showFloor   });
    };

    const ui = UniformUI.attach(uniforms, "main", {
        ranges: {
            ro: {
                min: -6, max: 6, step: 0.1,
                onChange: v => u_ro = v as number[],
            },
            samples: {
                min: 1, max: 16, step: 1,
                onChange: v => u_samples = v as number,
            },
        },
        toggles: {
            showLattice: { label: "lattice", default: true,  onChange: v => u_showLattice = v ? 1.0 : 0.0 },
            showSphere:  { label: "sphere",  default: true,  onChange: v => u_showSphere  = v ? 1.0 : 0.0 },
            showLights:  { label: "lights",  default: true,  onChange: v => u_showLights  = v ? 1.0 : 0.0 },
            showFloor:   { label: "floor",   default: true,  onChange: v => u_showFloor   = v ? 1.0 : 0.0 },
        }
    });

    window.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const dir  = e.key === "ArrowRight" ? 1 : -1;
        arr_ro_idx = (arr_ro_idx + dir + arr_ro.length) % arr_ro.length;
        u_ro       = [...arr_ro[arr_ro_idx]];
        ui.setValues("ro", u_ro);
    });

    (await app
        .setUniforms(uniforms)
        .addAudio(audio)
        .addCommon(/*wgsl*/`
            const PI: f32 = 3.141592654;
            const TAU: f32 = 6.283185307;

            fn noise3(p: vec3f) -> f32 {
                let ip = floor(p);
                var fp = p - ip;
                let s = vec3f(7.0, 157.0, 113.0);
                let h4 = vec4f(0.0, s.y, s.z, s.y + s.z) + dot(ip, s);
                fp = fp * fp * (3.0 - 2.0 * fp);
                let ha = mix(fract(sin(h4) * 43758.5), fract(sin(h4 + s.x) * 43758.5), fp.x);
                let hxy = mix(vec2f(ha.x, ha.z), vec2f(ha.y, ha.w), fp.y);
                return mix(hxy.x, hxy.y, fp.z);
            }

            fn smin(a: f32, b: f32, k: f32) -> f32 {
                let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
                return mix(b, a, h) - k * h * (1.0 - h);
            }

            fn pR(p: vec2f, a: f32) -> vec2f {
                return cos(a) * p + sin(a) * vec2f(p.y, -p.x);
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

            fn hashHs(seed: ptr<function, u32>) -> vec3f {
                let a = (rand(seed) * 2.0) - 1.0;
                let b = TAU * rand(seed);
                let c = sqrt(max(0.0, 1.0 - a * a));
                return vec3f(c * cos(b), a, c * sin(b));
            }

            fn mapScene(p: vec3f, rot: f32) -> vec3f {
                var d = vec3f(1e9, 0.0, 0.0);
                let distort = 0.2 * noise3(10.0 * p);

                // Floor
                if (u.showFloor > 0.5) {
                    let f_dist = smin(5.0 - p.z, 1.5 - p.y, 10.0);
                    let f_mat  = 0.1 + 0.3 * step(0.5, (4.0 * p.z) % 1.0);
                    if (f_dist < d.x) { d = vec3f(f_dist, f_mat, 0.0); }
                }

                var q = p;
                let qxy = pR(q.xy, sin(rot) + 0.2);
                q = vec3f(qxy.x, qxy.y, q.z);

                // Sphere
                if (u.showSphere > 0.5) {
                    let s1 = length(q + vec3f(0.0, 0.0, 2.5)) - 0.5;
                    if (s1 < d.x) { d = vec3f(s1, 0.9, 0.5); }

                    let s2 = length(q + vec3f(0.0, 0.0, 2.5)) - 0.445 - 0.09 * sin(43.0 * q.y);
                    if (s2 < d.x) { d = vec3f(s2, 1.0, 0.1); }
                }

                // Lattice
                if (u.showLattice > 0.5) {
                    let ql  = abs(p - round(p - 0.5) - 0.5);
                    let g   = min(min(max(ql.x, ql.y), max(ql.x, ql.z)), max(ql.y, ql.z)) - 0.05;
                    let c   = min(0.6 - abs(p.x + p.z), 0.45 - abs(p.y));
                    let lat = max(g, c);
                    if (lat < d.x) { d = vec3f(lat, 0.1, -0.5); }
                }

                // Lights
                if (u.showLights > 0.5) {
                    const size = 0.4;
                    let l1 = max(abs(p.z + 2.0) - size, abs(p.x + 2.0) - size) - distort - 0.15;
                    if (l1 < d.x) { d = vec3f(l1, 1.0, 0.4); }

                    let lightPos  = 1.2;
                    let lightSize = 1.2 + 0.4 * sin(u.time * 2.0);
                    let l2 = max(abs(p.z - lightPos) - lightSize, abs(p.x + lightPos) - lightSize) - distort;
                    if (l2 < d.x) { d = vec3f(l2, 1.0, -0.4); }
                }

                return d;
            }
        `)
        .addCompute("computeTex0", /*wgsl*/`
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = u.resolution.xy;
                if (f32(id.x) >= res.x || f32(id.y) >= res.y) { return; }

                var seed = pcg_hash(id.x + id.y * u32(res.x) + u32(u.time * 1000.0));
                let rot_time = u.time * 0.2;

                let drift = vec3f(
                    0.05 * sin(u.time * 0.3),
                    0.03 * sin(u.time * 0.4 + 1.0),
                    0.02 * sin(u.time * 0.5 + 2.0)
                );

                let ro = u.ro + drift;
                let la = vec3f(0.0, 0.0, 0.0);

                let cam_fwd   = normalize(la - ro);
                let cam_right = normalize(cross(cam_fwd, vec3f(0,1,0)));
                let cam_up    = cross(cam_right, cam_fwd);

                var total_radiance = vec3f(0.0);
                let samples = i32(u.samples);

                for (var s = 0; s < samples; s++) {
                    let jitter = vec2f(rand(&seed), rand(&seed)) - 0.5;
                    let p = (vec2f(f32(id.x), res.y - f32(id.y)) + jitter) * 2.0 / res.y - vec2f(res.x/res.y, 1.0);

                    var rd = normalize(p.x * cam_right + p.y * cam_up + 1.5 * cam_fwd);

                    let ryz = pR(rd.yz, 0.2 * sin(rot_time) + 0.2);
                    rd = vec3f(rd.x, ryz.x, ryz.y);
                    let ryx = pR(rd.yx, rot_time * 0.2 * sin(0.3));
                    rd = vec3f(ryx.y, ryx.x, rd.z);

                    var t: f32 = 0.0;

                    for (var i = 0; i < 80; i++) {
                        let m = mapScene(ro + rd * t, rot_time);
                        t += m.x * 0.5;
                        if (t > 20.0) { break; }

                        if (m.x < 0.001) {
                            let hit_pos = ro + rd * t;
                            let e = vec2f(0.0, 0.01);
                            let nor = normalize(m.x - vec3f(
                                mapScene(hit_pos - e.yxx, rot_time).x,
                                mapScene(hit_pos - e.xyx, rot_time).x,
                                mapScene(hit_pos - e.xxy, rot_time).x
                            ));

                            let rd2 = normalize(mix(reflect(rd, nor), hashHs(&seed), m.y));
                            let m2  = mapScene(hit_pos + rd2 * 1.5, rot_time);

                            let col1 = vec3f(1.0 - m.z,  1.0, 1.0 + m.z);
                            let col2 = vec3f(1.0 - m2.z, 1.0, 1.0 + m2.z);

                            total_radiance += (col2 * step(1.0, m2.y) + col1 * step(1.0, m.y));
                            break;
                        }
                    }
                }

                textureStore(outTex, id.xy, vec4f(total_radiance / f32(samples), 1.0));
            }
        `, 0)
        .addPass("pass1", /*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let current = textureSample(computeTex0, samp, in.uv).rgb;
                let history = textureSample(prev_pass1, samp, in.uv).rgb;
                return vec4f(mix(current, history, 0.75), 1.0);
            }
        `)
        .main(/*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let flipped_uv = vec2f(in.uv.x, 1.0 - in.uv.y);
                let col = textureSample(pass1, samp, flipped_uv).rgb;
                let exposure = 1.2;
                return vec4f(pow(col * exposure, vec3f(0.4545)), 1.0);
            }
        `)
    ).run();
};

start();