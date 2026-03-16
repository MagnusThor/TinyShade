import { TinyShade } from "../TinyShade";
import { WavAudioPlugin } from "./WavAudioPlugin";
import { UniformLayout } from "../UniformLayout";
import { UniformUI } from "../ui/UniformUI";

const start = async () => {
    const app = await TinyShade.create("canvas");

    const audio = new WavAudioPlugin();
    await audio.load("/assets/song.mp3");

   

    const arr_ro = [
        [0.0,  0.5,  -5.0],
        [-2.2, -2.6,  -5.0],
        [-.7, -2.2,  -4.0],
        [3.0, -5.2,  -3.0],
        [-0.4,  -0.4,  -5.2],
    ];

    let arr_ro_idx      = 0;
    let u_ro            = [...arr_ro[0]];
    let u_samples       = 4;
    let u_exposure      = 1.2;
    let u_showLattice   = 1.0;
    let u_showSphere    = 1.0;
    let u_showLights    = 1.0;
    let u_showFloor     = 1.0;
    let u_showFog       = 1.0;
    let u_showChroma    = 1.0;
    let u_showTwist     = 0.0;
    let u_showFilmic    = 1.0;
    let u_showVignette  = 1.0;
    let u_particleCount = 8_000;
    let u_showParticles = 1.0;
    let u_particleSpeed = 0.6;

    const uniforms = (l: UniformLayout) => {
        l.addUniform({ name: "ro",             value: () => u_ro            });
        l.addUniform({ name: "samples",        value: () => u_samples       });
        l.addUniform({ name: "exposure",       value: () => u_exposure      });
        l.addUniform({ name: "particleCount",  value: () => u_particleCount  });
        l.addUniform({ name: "particleSpeed",  value: () => u_particleSpeed });
        l.addUniform({ name: "showLattice",    value: () => u_showLattice   });
        l.addUniform({ name: "showSphere",     value: () => u_showSphere    });
        l.addUniform({ name: "showLights",     value: () => u_showLights    });
        l.addUniform({ name: "showFloor",      value: () => u_showFloor     });
        l.addUniform({ name: "showFog",        value: () => u_showFog       });
        l.addUniform({ name: "showChroma",     value: () => u_showChroma    });
        l.addUniform({ name: "showTwist",      value: () => u_showTwist     });
        l.addUniform({ name: "showFilmic",     value: () => u_showFilmic    });
        l.addUniform({ name: "showVignette",   value: () => u_showVignette  });
        l.addUniform({ name: "showParticles",  value: () => u_showParticles });
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
            exposure: {
                min: 0.1, max: 3.0, step: 0.05,
                onChange: v => u_exposure = v as number,
            },
            particleSpeed: {
                min: 0.1, max: 2.0, step: 0.05,
                onChange: v => u_particleSpeed = v as number,
            },
        },
        toggles: {
            showFloor:     { label: "floor",     default: true,  onChange: v => u_showFloor     = v ? 1.0 : 0.0 },
            showLattice:   { label: "lattice",   default: true,  onChange: v => u_showLattice   = v ? 1.0 : 0.0 },
            showSphere:    { label: "sphere",    default: true,  onChange: v => u_showSphere    = v ? 1.0 : 0.0 },
            showLights:    { label: "lights",    default: true,  onChange: v => u_showLights    = v ? 1.0 : 0.0 },
            showFog:       { label: "fog",       default: false,  onChange: v => u_showFog       = v ? 1.0 : 0.0 },
            showFilmic:    { label: "filmic",    default: false,  onChange: v => u_showFilmic    = v ? 1.0 : 0.0 },
            showChroma:    { label: "chroma",    default: false,  onChange: v => u_showChroma    = v ? 1.0 : 0.0 },
            showVignette:  { label: "vignette",  default: true,  onChange: v => u_showVignette  = v ? 1.0 : 0.0 },
            showTwist:     { label: "twist",     default: false, onChange: v => u_showTwist     = v ? 1.0 : 0.0 },
            showParticles: { label: "particles", default: true,  onChange: v => u_showParticles = v ? 1.0 : 0.0 },
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
            const PI:  f32 = 3.141592654;
            const TAU: f32 = 6.283185307;

            fn noise3(p: vec3f) -> f32 {
                let ip = floor(p);
                var fp = p - ip;
                let s  = vec3f(7.0, 157.0, 113.0);
                let h4 = vec4f(0.0, s.y, s.z, s.y + s.z) + dot(ip, s);
                fp = fp * fp * (3.0 - 2.0 * fp);
                let ha  = mix(fract(sin(h4) * 43758.5), fract(sin(h4 + s.x) * 43758.5), fp.x);
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
                var word  = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
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

            fn filmic(x: vec3f) -> vec3f {
                let a = x * (x + 0.0245786) - 0.000090537;
                let b = x * (0.983729 * x + 0.432951) + 0.238081;
                return a / b;
            }

            fn latticeSDF(p: vec3f) -> f32 {
                var pl = p;
                if (u.showTwist > 0.5) {
                    let twist = 0.15 * sin(u.time * 0.3 + p.y * 0.8);
                    let plxz  = pR(pl.xz, twist);
                    pl = vec3f(plxz.x, pl.y, plxz.y);
                }
                let ql = abs(pl - round(pl - 0.5) - 0.5);
                let g  = min(min(max(ql.x, ql.y), max(ql.x, ql.z)), max(ql.y, ql.z)) - 0.05;
                let c  = min(0.6 - abs(pl.x + pl.z), 0.45 - abs(pl.y));
                return max(g, c);
            }

            fn mapScene(p: vec3f, rot: f32) -> vec3f {
                var d = vec3f(1e9, 0.0, 0.0);

                if (u.showFloor > 0.5) {
                    let f_dist = smin(5.0 - p.z, 1.5 - p.y, 10.0);
                    let f_mat  = 0.1 + 0.3 * step(0.5, (4.0 * p.z) % 1.0);
                    if (f_dist < d.x) { d = vec3f(f_dist, f_mat, 0.0); }
                }

                if (u.showLattice > 0.5) {
                    let lat = latticeSDF(p);
                    if (lat < d.x) { d = vec3f(lat, 0.1, -0.5); }
                }

                if (u.showSphere > 0.5) {
                    var q   = p;
                    let qxy = pR(q.xy, sin(rot) + 0.2);
                    q = vec3f(qxy.x, qxy.y, q.z);
                    let s1 = length(q + vec3f(0.0, 0.0, 2.5)) - 0.5;
                    if (s1 < d.x) { d = vec3f(s1, 0.9, 0.5); }
                    let s2 = length(q + vec3f(0.0, 0.0, 2.5)) - 0.445 - 0.09 * sin(43.0 * q.y);
                    if (s2 < d.x) { d = vec3f(s2, 1.0, 0.1); }
                }

                if (u.showLights > 0.5) {
                    let distort   = 0.2 * noise3(10.0 * p);
                    const size    = 0.4;
                    let l1 = max(abs(p.z + 2.0) - size, abs(p.x + 2.0) - size) - distort - 0.15;
                    if (l1 < d.x) { d = vec3f(l1, 1.0,  0.4); }
                    let lightSize = 1.2 + 0.4 * sin(u.time * 2.0);
                    let l2 = max(abs(p.z - 1.2) - lightSize, abs(p.x + 1.2) - lightSize) - distort;
                    if (l2 < d.x) { d = vec3f(l2, 1.0, -0.4); }
                }

                return d;
            }

            fn getCameraAxes(ro: vec3f) -> mat3x3<f32> {
                let fwd   = normalize(vec3f(0.0) - ro);
                let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
                let up    = cross(right, fwd);
                return mat3x3<f32>(right, up, fwd);
            }

            // 3D flow field — three offset noise samples give a
            // curl-like vector that never converges to a point
            fn flowField(p: vec3f, t: f32) -> vec3f {
                let scale  = 0.4;
                let scroll = t * 0.08;
                let n1 = noise3(p * scale + vec3f(scroll, 0.0,    0.0   ));
                let n2 = noise3(p * scale + vec3f(0.0,    scroll, 3.7   ));
                let n3 = noise3(p * scale + vec3f(0.0,    7.3,    scroll));
                // Remap 0..1 → -1..1 and normalise
                return normalize(vec3f(n1, n2, n3) * 2.0 - 1.0);
            }
        `)

        // ── Pass 0: Path tracer — rgb=color, a=depth ─────────────────────
        .addCompute("computeTex0", /*wgsl*/`
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = u.resolution.xy;
                if (f32(id.x) >= res.x || f32(id.y) >= res.y) { return; }

                var seed      = pcg_hash(id.x + id.y * u32(res.x) + u32(u.time * 1000.0));
                let rot_time  = u.time * 0.2;
                let k         = vec2f(1.0, -1.0);
                let eps       = 0.001;
                let res_ratio = res.x / res.y;

                let ro = u.ro + vec3f(
                    0.05 * sin(u.time * 0.3),
                    0.03 * sin(u.time * 0.4 + 1.0),
                    0.02 * sin(u.time * 0.5 + 2.0)
                );

                let cam       = getCameraAxes(ro);
                let cam_right = cam[0];
                let cam_up    = cam[1];
                let cam_fwd   = cam[2];

                var total_radiance = vec3f(0.0);
                var first_t        = 20.0;
                let samples        = i32(u.samples);

                for (var s = 0; s < samples; s++) {
                    var jitter = vec2f(0.0);
                    if (s > 0) { jitter = vec2f(rand(&seed), rand(&seed)) - 0.5; }

                    let p  = (vec2f(f32(id.x), res.y - f32(id.y)) + jitter)
                           * 2.0 / res.y - vec2f(res_ratio, 1.0);

                    var rd = normalize(p.x * cam_right + p.y * cam_up + 1.5 * cam_fwd);
                    let ryz = pR(rd.yz, 0.2 * sin(rot_time) + 0.2);
                    rd = vec3f(rd.x, ryz.x, ryz.y);
                    let ryx = pR(rd.yx, rot_time * 0.2 * sin(0.3));
                    rd = vec3f(ryx.y, ryx.x, rd.z);

                    var t   = 0.0;
                    var m   = vec3f(1e9);
                    var hit = false;

                    for (var i = 0; i < 80; i++) {
                        m = mapScene(ro + rd * t, rot_time);
                        t += m.x * 0.5;
                        if (t > 20.0) { break; }
                        if (m.x < 0.001) { hit = true; break; }
                    }

                    if (s == 0) { first_t = t; }

                    if (!hit) {
                        if (u.showFog > 0.5) {
                            total_radiance += vec3f(0.02, 0.02, 0.06) * 0.4;
                        }
                        continue;
                    }

                    let hit_pos = ro + rd * t;
                    let nor = normalize(
                        k.xyy * mapScene(hit_pos + eps * k.xyy, rot_time).x +
                        k.yyx * mapScene(hit_pos + eps * k.yyx, rot_time).x +
                        k.yxy * mapScene(hit_pos + eps * k.yxy, rot_time).x +
                        k.xxx * mapScene(hit_pos + eps * k.xxx, rot_time).x
                    );

                    let col1 = vec3f(1.0 - m.z, 1.0, 1.0 + m.z);
                    let rd2  = normalize(mix(reflect(rd, nor), hashHs(&seed), m.y));
                    var t2   = 0.0;
                    var m2   = vec3f(1e9);
                    var hit2 = false;

                    for (var j = 0; j < 48; j++) {
                        m2 = mapScene(hit_pos + rd2 * t2, rot_time);
                        t2 += m2.x * 0.5;
                        if (t2 > 12.0) { break; }
                        if (m2.x < 0.001) { hit2 = true; break; }
                    }

                    let col2 = vec3f(1.0 - m2.z, 1.0, 1.0 + m2.z);
                    total_radiance += col2 * step(1.0, m2.y) + col1 * step(1.0, m.y);

                    if (hit2) {
                        let hit_pos2 = hit_pos + rd2 * t2;
                        let nor2 = normalize(
                            k.xyy * mapScene(hit_pos2 + eps * k.xyy, rot_time).x +
                            k.yyx * mapScene(hit_pos2 + eps * k.yyx, rot_time).x +
                            k.yxy * mapScene(hit_pos2 + eps * k.yxy, rot_time).x +
                            k.xxx * mapScene(hit_pos2 + eps * k.xxx, rot_time).x
                        );
                        let rd3  = normalize(mix(reflect(rd2, nor2), hashHs(&seed), m2.y));
                        let m3   = mapScene(hit_pos2 + rd3 * 1.5, rot_time);
                        let col3 = vec3f(1.0 - m3.z, 1.0, 1.0 + m3.z);
                        total_radiance += col3 * step(1.0, m3.y) * 0.4;
                    }

                    if (u.showFog > 0.5) {
                        let fog = 1.0 - exp(-t * 0.08);
                        total_radiance = mix(total_radiance, vec3f(0.02, 0.02, 0.06), fog);
                    }
                }

                textureStore(outTex, id.xy, vec4f(total_radiance / f32(samples), first_t / 20.0));
            }
        `, 0)

        // ── Pass 1: Particles — flow field movement ───────────────────────
        .addCompute("computeTex1", /*wgsl*/`
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = u.resolution.xy;

                if (f32(id.x) < res.x && f32(id.y) < res.y) {
                    textureStore(outTex, id.xy, vec4f(0.0));
                }

                let i = id.x;
                if (i >= u32(u.particleCount)) { return; }
                if (u.showParticles < 0.5)     { return; }

                // ── Stable camera (no drift) for movement ────────────────
                let ro        = u.ro;
                let cam       = getCameraAxes(ro);
                let cam_right = cam[0];
                let cam_up    = cam[1];
                let cam_fwd   = cam[2];

                // ── Read state ───────────────────────────────────────────
                let b   = i * 4u;
                var px  = data[b];
                var py  = data[b + 1u];
                var pz  = data[b + 2u];
                var pw  = data[b + 3u]; // per-particle speed weight

                // ── Respawn ──────────────────────────────────────────────
                // Die when particle wanders too far from scene or behind cam
                let pworld    = vec3f(px, py, pz);
                let prel      = pworld - ro;
                let along_fwd = dot(prel, cam_fwd);
                let too_far   = length(pworld) > 7.0;
                let past_cam  = along_fwd < -1.5;
                let do_init   = u.time < 0.1;

                if (too_far || past_cam || do_init) {
                    // Scatter randomly inside the scene bounding volume
                    // so they immediately start flowing through the lattice
                    let angle  = fract(f32(i) * 0.001) * TAU + u.time * 0.15;
                    let radius = 0.3 + fract(f32(i) * 0.431) * 3.0;
                    let height = (fract(f32(i) * 0.717) - 0.5) * 4.0;

                    // Spread around scene center (origin) not around ro
                    px = cos(angle) * radius;
                    py = height;
                    pz = sin(angle) * radius * 0.6 - 1.5; // slightly biased toward sphere
                    pw = 0.3 + fract(f32(i) * 7.7) * 0.7;
                }

                // ── Flow field movement ──────────────────────────────────
                let pos   = vec3f(px, py, pz);
                let field = flowField(pos, u.time);

                // Base flow speed, per-particle weight gives variation
                let speed = 0.006 * pw * u.particleSpeed;
                px += field.x * speed;
                py += field.y * speed;
                pz += field.z * speed;

                // Very gentle pull toward scene center so particles don't
                // all drift to infinity — keeps them in the interesting zone
                let to_center = -pos * 0.0003;
                px += to_center.x;
                py += to_center.y;
                pz += to_center.z;

                // Write back
                data[b]      = px;
                data[b + 1u] = py;
                data[b + 2u] = pz;
                data[b + 3u] = pw;

                // ── Project — use drifted ro to match raytracer ──────────
                let ro_drift = u.ro + vec3f(
                    0.05 * sin(u.time * 0.3),
                    0.03 * sin(u.time * 0.4 + 1.0),
                    0.02 * sin(u.time * 0.5 + 2.0)
                );
                let cam_d       = getCameraAxes(ro_drift);
                let cam_right_d = cam_d[0];
                let cam_up_d    = cam_d[1];
                let cam_fwd_d   = cam_d[2];

                let prel_d = vec3f(px, py, pz) - ro_drift;
                let pcam   = vec3f(
                    dot(prel_d, cam_right_d),
                    dot(prel_d, cam_up_d),
                    dot(prel_d, cam_fwd_d)
                );

                if (pcam.z <= 0.01) { return; }

                let sx = (pcam.x / (pcam.z * 1.5)) *  0.5 + 0.5;
                let sy = (pcam.y / (pcam.z * 1.5)) * -0.5 + 0.5;

                let cx = i32(sx * res.x);
                let cy = i32(sy * res.y);

                if (cx < 1 || cx >= i32(res.x) - 1 ||
                    cy < 1 || cy >= i32(res.y) - 1) { return; }

                // ── Depth test ───────────────────────────────────────────
                let depth_px      = vec2i(cx, i32(res.y) - cy);
                let scene_depth_n = textureLoad(computeTex0, depth_px, 0).a;
                let scene_t       = scene_depth_n * 20.0;
                let particle_t    = pcam.z;

                if (particle_t > scene_t) { return; }

                let depth_fade = saturate((scene_t - particle_t) / 0.3);

                // ── Color ────────────────────────────────────────────────
                // Sample flow field strength as a hue shift — particles
                // moving fast glow warmer, slow ones cool blue
                let field_here  = flowField(vec3f(px, py, pz), u.time);
                let flow_speed  = length(field_here);

                // Distance from sphere core drives base color
                let dist_sphere = length(vec3f(px, py, pz) - vec3f(0.0, 0.0, -2.5));
                let t_col       = saturate(dist_sphere / 4.0);

                let c_near = vec3f(1.0,  0.85, 0.4);  // warm gold near sphere
                let c_mid  = vec3f(0.15, 0.9,  0.8);  // teal in lattice
                let c_far  = vec3f(0.1,  0.25, 1.0);  // deep blue far out

                var pcol: vec3f;
                if (t_col < 0.5) {
                    pcol = mix(c_near, c_mid, t_col * 2.0);
                } else {
                    pcol = mix(c_mid, c_far, (t_col - 0.5) * 2.0);
                }

                // Brightness: closer to sphere = brighter
                let brightness = (1.0 - t_col * 0.7) * 2.5;
                pcol = pcol * brightness * depth_fade;

                textureStore(outTex, vec2i(cx, cy), vec4f(pcol, 1.0));
            }
        `, u_particleCount * 4 * 4)

        // ── Pass 2: TAA on raytracer ──────────────────────────────────────
        .addPass("pass_rt", /*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let current = textureSample(computeTex0, samp, in.uv).rgb;
                let history = textureSample(prev_pass_rt, samp, in.uv).rgb;
                return vec4f(mix(current, history, 0.75), 1.0);
            }
        `)

        // ── Pass 3: Particle trails ───────────────────────────────────────
        .addPass("pass_particles", /*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let dots      = textureSample(computeTex1, samp, in.uv).rgb;
                let oldTrails = textureSample(prev_pass_particles, samp, in.uv).rgb;
                // 0.6 fade — trails linger just long enough to show flow paths
                return vec4f(dots + oldTrails * 0.6, 1.0);
            }
        `)

        // ── Main: Composite ───────────────────────────────────────────────
        .main(/*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let flipped_uv = vec2f(in.uv.x, 1.0 - in.uv.y);

                var col: vec3f;
                if (u.showChroma > 0.5) {
                    let offset = 0.0025 + 0.001 * sin(u.time * 0.7);
                    let r = textureSample(pass_rt, samp, vec2f(flipped_uv.x + offset, flipped_uv.y)).r;
                    let g = textureSample(pass_rt, samp, flipped_uv).g;
                    let b = textureSample(pass_rt, samp, vec2f(flipped_uv.x - offset, flipped_uv.y)).b;
                    col = vec3f(r, g, b);
                } else {
                    col = textureSample(pass_rt, samp, flipped_uv).rgb;
                }

                col *= u.exposure;

                if (u.showFilmic > 0.5) {
                    col = filmic(col);
                } else {
                    col = pow(max(col, vec3f(0.0)), vec3f(0.4545));
                }

                if (u.showParticles > 0.5) {
                    let particles = textureSample(pass_particles, samp, flipped_uv).rgb;
                    col = 1.0 - (1.0 - col) * (1.0 - particles * 0.6);
                }

                if (u.showVignette > 0.5) {
                    let uv_c     = flipped_uv - 0.5;
                    let vignette = 1.0 - dot(uv_c, uv_c) * 2.2;
                    col *= clamp(vignette, 0.0, 1.0);
                }

                return vec4f(col, 1.0);
            }
        `)
    ).run();
};

start();