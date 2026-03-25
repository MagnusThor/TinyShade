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