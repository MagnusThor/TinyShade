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
    let cam = getCameraAxes(ro);

    // ── Analytic light directions ─────────────────────────────────────────
    // Matching the SDF light positions (no shadow cast, specular only).
    let L_BLUE = normalize(vec3f( 2.0, 1.0,  2.0));
    let L_GOLD = normalize(vec3f(-1.2, 0.8, -1.2));

    // ── Phase 0: stable centre-pixel primary ray ──────────────────────────
    // Fire one un-jittered ray (s=0) first.  We use its hit point and normal
    // exclusively for the analytic metallic term so the highlight is computed
    // from a rock-solid normal — not from the jittered-ray normal that changes
    // every frame and is the root cause of grain on the metallic palette.
    let p0  = vec2f(f32(id.x), res.y - f32(id.y)) * 2.0 / res.y - vec2f(res_ratio, 1.0);
    var rd0 = normalize(p0.x * cam[0] + p0.y * cam[1] + 1.5 * cam[2]);
    let ryz0 = pR(rd0.yz, 0.2 * sin(rot_time) + 0.2);
    rd0 = vec3f(rd0.x, ryz0.x, ryz0.y);
    let ryx0 = pR(rd0.yx, rot_time * 0.2 * sin(0.3));
    rd0 = vec3f(ryx0.y, ryx0.x, rd0.z);

    var t0 = 0.0; var m0 = vec3f(1e9); var hit0 = false;
    for (var i = 0; i < 80; i++) {
        m0 = mapScene(ro + rd0 * t0, rot_time);
        if (m0.z != 0.0) { t0 += 0.25 * abs(m0.x) + 0.0004; }
        else              { t0 += 0.25 * m0.x; }
        if (t0 > 20.0) { break; }
        if (m0.x < 0.001) { hit0 = true; break; }
    }

    // Stable normal for the analytic pass — computed once, used below.
    var stable_nor  = vec3f(0.0, 1.0, 0.0);
    var stable_hit  = false;
    var stable_mat  = m0;
    var stable_t    = t0;
    if (hit0) {
        let hp0 = ro + rd0 * t0;
        stable_nor = normalize(
            k.xyy * mapScene(hp0 + eps * k.xyy, rot_time).x +
            k.yyx * mapScene(hp0 + eps * k.yyx, rot_time).x +
            k.yxy * mapScene(hp0 + eps * k.yxy, rot_time).x +
            k.xxx * mapScene(hp0 + eps * k.xxx, rot_time).x
        );
        stable_hit = true;
    }

    // ── Analytic metallic highlight (noise-free, computed once) ──────────
    // By computing metallic_col outside the sample loop we guarantee:
    //   • The same value every sample → no jitter noise whatsoever.
    //   • Audio reactivity still works (audioPulse is uniform, not random).
    // This is valid because metallic_reflection() contains no stochastic
    // terms — it is pure math on stable_nor and the two light directions.
    var metallic_col = vec3f(0.0);
    if (stable_hit && stable_mat.y < 0.85 && stable_mat.y >= 0.0 && stable_mat.y < 1.0) {
        let vd0 = -rd0;
        let audioPulse = u.audioLow * 0.4 + u.audioMid * 0.2;

        let blue_metal = metallic_reflection(
            stable_nor, vd0, L_BLUE,
            vec3f(3.0, 3.5, 4.2),
            0.15, 28.0, 0.9, 2
        );
        let gold_metal = metallic_reflection(
            stable_nor, vd0, L_GOLD,
            vec3f(2.8, 3.2, 4.5),
            0.12, 22.0, 0.7, 2
        );
        metallic_col = (blue_metal * 0.6 + gold_metal * 0.5) * (1.0 + audioPulse);

        // Hard clamp: the sin-palette can produce values well above 1.0.
        // Without this, a single-pixel hot spike from the palette survives
        // TAA history because it writes a huge value into the accumulation
        // buffer that decays slowly.  Clamp to a reasonable highlight ceiling
        // (2.5 in linear space → maps to ~0.85 after filmic in main.wgsl).
        metallic_col = min(metallic_col, vec3f(2.5));
    }

    // ── Stochastic sample loop ────────────────────────────────────────────
    var total_radiance = vec3f(0.0);
    var first_t        = stable_t;
    let samples        = i32(u.samples);

    for (var s = 0; s < samples; s++) {
        var jitter = vec2f(0.0);
        if (s > 0) { jitter = vec2f(rand(&seed), rand(&seed)) - 0.5; }

        let p   = (vec2f(f32(id.x), res.y - f32(id.y)) + jitter) * 2.0 / res.y - vec2f(res_ratio, 1.0);
        var rd  = normalize(p.x * cam[0] + p.y * cam[1] + 1.5 * cam[2]);
        let ryz = pR(rd.yz, 0.2 * sin(rot_time) + 0.2);
        rd = vec3f(rd.x, ryz.x, ryz.y);
        let ryx = pR(rd.yx, rot_time * 0.2 * sin(0.3));
        rd = vec3f(ryx.y, ryx.x, rd.z);

        var t   = 0.0;
        var m   = vec3f(1e9);
        var hit = false;

        for (var i = 0; i < 80; i++) {
            m = mapScene(ro + rd * t, rot_time);
            if (m.z != 0.0) { t += 0.25 * abs(m.x) + 0.0004; }
            else             { t += 0.25 * m.x; }
            if (t > 20.0) { break; }
            if (m.x < 0.001) { hit = true; break; }
        }

        if (s == 0) { first_t = t; }

        if (hit) {
            let hp  = ro + rd * t;
            let nor = normalize(
                k.xyy * mapScene(hp + eps * k.xyy, rot_time).x +
                k.yyx * mapScene(hp + eps * k.yyx, rot_time).x +
                k.yxy * mapScene(hp + eps * k.yxy, rot_time).x +
                k.xxx * mapScene(hp + eps * k.xxx, rot_time).x
            );
            let vd = -rd;

            var emission  = vec3f(0.0);
            var albedo    = vec3f(0.01);
            var roughness = 0.1;

            if (m.y >= 1.0) {
                // ── Emitters ─────────────────────────────────────────────────
                if (m.z > 0.3)       { emission = vec3f(0.5, 0.85, 1.0) * 8.0; }
                else if (m.z < -0.3) { emission = vec3f(1.4, 0.75, 0.10) * 7.0; }
                else                 { emission = vec3f(0.4, 0.80, 1.0) * 6.0; }

            } else if (m.y > 0.85) {
                // ── Dark Glass Sphere ─────────────────────────────────────────
                albedo    = vec3f(0.01, 0.01, 0.02);
                roughness = 0.01;

            } else {
                // ── Metal Lattice ─────────────────────────────────────────────
                // Albedo and roughness only — metallic_col is handled outside
                // the loop via the stable normal.  Do NOT add metallic_col here
                // again or it will be averaged down by the sample count AND
                // still carry jitter noise from this loop's normal.
                albedo    = vec3f(0.18, 0.20, 0.22);
                roughness = 0.25;
            }

            // ── Second Bounce ─────────────────────────────────────────────────
            // Variance reduction: the random fraction of the bounce direction
            // uses roughness² (already applied), PLUS a proximity clamp.
            // If the hit point is close to either emitter SDF the solid angle
            // subtended by that light is large — we can afford to make the
            // bounce almost purely specular without losing the indirect colour,
            // because the TAA history will average out the small remaining
            // angular spread.  This directly cuts the "random ray hits the
            // giant gold slab" spike probability at close range.
            let dist_blue = length(hp - vec3f(2.0, 0.0, 2.0));
            let dist_gold = length(hp - vec3f(-1.2, 0.0, -1.2));
            let near_light = 1.0 - smoothstep(0.5, 2.5, min(dist_blue, dist_gold));
            // Near emitters: roughness collapses toward 0.02 (near-mirror).
            // Far from emitters: full roughness²=0.0625.
            let eff_roughness = mix(roughness * roughness, 0.02, near_light);
            let rd2 = normalize(mix(reflect(rd, nor), hashHs(&seed), eff_roughness));
            var t2  = 0.02;
            var m2  = vec3f(1e9);
            for (var j = 0; j < 40; j++) {
                m2 = mapScene(hp + rd2 * t2, rot_time);
                if (m2.z != 0.0) { t2 += 0.25 * abs(m2.x); }
                else              { t2 += 0.25 * m2.x; }
                if (t2 > 10.0 || m2.x < 0.005) { break; }
            }

            var reflect_col = vec3f(0.0);
            if (m2.y >= 1.0) {
                if (m2.z > 0.3)       { reflect_col = vec3f(0.5, 0.85, 1.0) * 8.0; }
                else if (m2.z < -0.3) { reflect_col = vec3f(1.4, 0.75, 0.10) * 7.0; }
                else                  { reflect_col = vec3f(0.4, 0.80, 1.0) * 6.0; }
            }

            // ── Clamp stochastic emitter spike ────────────────────────────────
            // When a random bounce ray hits a bright emitter (8× target) the
            // result is a single-pixel hot spike that burns into the TAA history
            // and decays slowly as grain.  Clamp the stochastic indirect to a
            // ceiling that still allows bright reflections but prevents spikes.
            // (The deterministic emission from direct hits is NOT clamped —
            //  those pixels are supposed to be bright.)
            reflect_col = min(reflect_col, vec3f(3.0));

            let bounced_albedo = select(vec3f(0.0), albedo * vec3f(0.08, 0.10, 0.14), m2.y < 1.0);
            let ambient        = albedo * vec3f(0.04, 0.05, 0.09);

            total_radiance +=
                (emission
                + reflect_col * 1.2
                + bounced_albedo
                + ambient
                ) * exp(-0.08 * t);

        } else {
            let fog_near = vec3f(0.04, 0.05, 0.10) * exp(-t * 0.25);
            let fog_warm = vec3f(0.08, 0.04, 0.01) * exp(-t * 0.45);
            total_radiance += C_FOG_SKY * 0.5 + fog_near + fog_warm;
        }
    }

    // ── Combine stochastic radiance + analytic metallic ───────────────────
    // metallic_col is added AFTER the sample average so it isn't divided
    // by the sample count — it represents a deterministic extra contribution,
    // not a stochastic one.  Scale it down slightly (0.85) so the addition
    // doesn't overpower at low sample counts where total_radiance is already
    // at full strength per-sample.
    let fin = total_radiance / f32(samples) + metallic_col * 0.85;

    textureStore(outTex, id.xy, vec4f(fin, first_t / 20.0));
}
