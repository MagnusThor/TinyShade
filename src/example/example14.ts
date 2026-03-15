import { TinyShade } from "../TinyShade";

document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade.create("canvas");

    const METEOR_COUNT = 5;
    const TILE_SIZE = 120.0;

    (await app.setUniforms()

        // ============================================================
        // PAINT BUFFER DECAY (FASTER + STABLE)
        // ============================================================
        .addAtomicCompute("paint_buffer", /*wgsl*/`
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let idx = id.x;
                if (idx >= 1048576u) { return; }

                let val = atomicLoad(&data[idx]);
                if (val > 0u) {
                    atomicSub(&data[idx], min(val, 12u));
                }
            }
        `, 1024 * 1024, false)

        // ============================================================
        // METEOR PHYSICS + CARVING (SAFE + CAPPED)
        // ============================================================
        .addCompute("meteor_physics", /*wgsl*/`
            fn get_idx(p_xz: vec2f) -> u32 {
                let coord = ((p_xz % ${TILE_SIZE}) + ${TILE_SIZE}) % ${TILE_SIZE};
                let uv = vec2u(coord * (1024.0 / ${TILE_SIZE}));
                return (uv.y % 1024u) * 1024u + (uv.x % 1024u);
            }

            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let i = id.x;
                if (i >= ${METEOR_COUNT}u) { return; }

                var pos = vec3f(
                    data[i*4u],
                    data[i*4u + 1u],
                    data[i*4u + 2u]
                );
                var state = data[i*4u + 3u];

                let camZ = u.time * 6.0;

                // Respawn
                if (u.time < 0.1 || state <= 0.0 || pos.y < -10.0 || pos.z < camZ - 20.0) {
                    let seed = f32(i) * 7.13 + u.time;
                    pos = vec3f(
                        (fract(sin(seed)*40.0)-0.5)*60.0,
                        45.0,
                        camZ + 60.0 + fract(seed)*40.0
                    );
                    state = 1.0;
                }

                if (state > 0.0) {
                    pos += vec3f(0.05, -0.25, -0.15);

                    if (pos.y <= 0.0) {
                        pos.y = 0.01;
                        state = -1.0;

                        let radius = 20i;
                        for (var x = -radius; x <= radius; x++) {
                            for (var z = -radius; z <= radius; z++) {
                                let d2 = f32(x*x + z*z);
                                if (d2 < f32(radius*radius)) {
                                    let falloff = 1.0 - sqrt(d2)/f32(radius);
                                    let heat = u32(1800.0 * falloff * falloff);
                                    if (heat > 8u) {
                                        let offset = vec2f(f32(x), f32(z)) * (${TILE_SIZE}/1024.0);
                                        let idx = get_idx(pos.xz + offset);
                                        let prev = atomicLoad(&paint_buffer_data[idx]);
                                        atomicStore(&paint_buffer_data[idx], min(prev + heat, 6000u));
                                    }
                                }
                            }
                        }
                    }
                }

                data[i*4u] = pos.x;
                data[i*4u + 1u] = pos.y;
                data[i*4u + 2u] = pos.z;
                data[i*4u + 3u] = state;
            }
        `, METEOR_COUNT * 4)

        // ============================================================
        // RAY RESOLVE (HEIGHTFIELD — FIXED STEPPING)
        // ============================================================
        .addCompute("resolve", /*wgsl*/`
            fn get_idx(p_xz: vec2f) -> u32 {
                let coord = ((p_xz % ${TILE_SIZE}) + ${TILE_SIZE}) % ${TILE_SIZE};
                let uv = vec2u(coord * (1024.0 / ${TILE_SIZE}));
                return (uv.y % 1024u) * 1024u + (uv.x % 1024u);
            }

            fn get_height(p_xz: vec2f) -> f32 {
                let heat = f32(atomicLoad(&paint_buffer_data[get_idx(p_xz)])) / 1000.0;
                let h = clamp(heat * 0.25, 0.0, 1.0);

                let hole = h*h * 10.0;
                let rim = smoothstep(0.3, 0.7, h)
                        * smoothstep(1.0, 0.7, h) * 3.5;

                return rim - hole;
            }

            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = u.resolution.xy;
                let uv = (vec2f(f32(id.x), res.y - f32(id.y)) / res) * 2.0 - 1.0;

                let camZ = u.time * 6.0;
                let ro = vec3f(0.0, 25.0, camZ - 40.0);
                let rd = normalize(vec3f(uv.x * (res.x/res.y), uv.y - 0.7, 1.2));

                var col = vec3f(0.01, 0.015, 0.02);
                var t = 0.0;

                for (var i = 0; i < 140; i++) {
                    let p = ro + rd * t;
                    let h = get_height(p.xz);
                    let dist = p.y - h;

                    if (dist < 0.0) {
                        let eps = 0.15;
                        let hx = get_height(p.xz + vec2f(eps,0.0)) - get_height(p.xz - vec2f(eps,0.0));
                        let hz = get_height(p.xz + vec2f(0.0,eps)) - get_height(p.xz - vec2f(0.0,eps));
                        let n = normalize(vec3f(-hx, 2.0*eps, -hz));

                        let sun = normalize(vec3f(0.5,1.0,0.3));
                        let diff = max(dot(n,sun),0.0);

                        let check = (floor(p.x*0.5)+floor(p.z*0.5)) % 2.0;
                        col = mix(vec3f(0.04), vec3f(0.08), abs(check)) * (diff + 0.1);

                        let heat = f32(atomicLoad(&paint_buffer_data[get_idx(p.xz)])) / 1000.0;
                        if (heat > 0.1) {
                            col += mix(vec3f(1.0,0.2,0.0), vec3f(1.0,0.7,0.3), heat) * heat * 10.0;
                        }
                        break;
                    }

                    t += clamp(dist * 0.5, 0.05, 1.2);
                    if (t > 220.0) { break; }
                }

                // Meteor glow
                for (var m=0u; m<${METEOR_COUNT}u; m++) {
                    let mp = vec3f(
                        meteor_physics_data[m*4u],
                        meteor_physics_data[m*4u+1u],
                        meteor_physics_data[m*4u+2u]
                    );
                    let d = distance(ro + rd * distance(ro, mp), mp);
                    let g = max(0.0, 1.0 - d / 2.5);
                    col += vec3f(g*0.5, g*0.7, g) * 3.0;
                }

                textureStore(outTex, id.xy, vec4f(col,1.0));
            }
        `, 0, ["meteor_physics", "paint_buffer"])

        // ============================================================
        // FINAL TONEMAP
        // ============================================================
        .main(/*wgsl*/`
            @fragment
            fn main(in: VSOut) -> @location(0) vec4f {
                let col = textureSample(resolve, samp, in.uv).rgb;
                return vec4f(col / (col + 1.0), 1.0);
            }
        `)
    ).run();
});
