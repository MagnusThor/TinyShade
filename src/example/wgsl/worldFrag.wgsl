fn sampleCrater(st: vec2f, r: vec2f) -> f32 {
    let i = vec2u(st);
    let f = fract(st);

    let w = u32(r.x);
    let h = u32(r.y);

    let idx = i.y * w + i.x;

    let s00 = f32(atomicLoad(&crater_map_data[idx]));
    let s10 = f32(atomicLoad(&crater_map_data[i.y * w + (i.x + 1u) % w]));
    let s01 = f32(atomicLoad(&crater_map_data[((i.y + 1u) % h) * w + i.x]));
    let s11 = f32(atomicLoad(&crater_map_data[((i.y + 1u) % h) * w + (i.x + 1u) % w]));

    return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}


@fragment
fn main(in: VSOut) -> @location(0) vec4f {
    let r = u.resolution.xy;
    let p2 = (vec2f(in.uv.x, 1.0 - in.uv.y) * 2.0 - 1.0) * vec2f(r.x / r.y, 1.0);
    let sky_bg = textureSample(sky, samp, in.uv).rgb;

    // --- CAMERA SYSTEM ---
    let T = u.time * 3.0;
    let P = path(T);
    let ZZ = normalize(dpath(T) + vec3f(-0.5, 0.1, 0.0));
    let XX = normalize(cross(ZZ, vec3f(0.0, 1.0, 0.0)));
    let YY = cross(XX, ZZ);
    let R = normalize(-p2.x * XX + p2.y * YY + fov * ZZ);

    var O = vec3f(0.0);
    var z_dist: f32 = 0.0;
    let Y_vec = (1.0 + R.x) * get_BY();
    let S_col = (1.0 + R.y) * get_BW() * Y_vec;

    for (var i = 0; i < 85; i++) {
        let p_m = P + z_dist * R;
        
        if (p_m.y > 15.0 && R.y > 0.0) {
            z_dist += p_m.y * 0.5; 
            continue; 
        }

        // --- BILINEAR CRATER LOOKUP (Smoothes Squares) ---
        var crater_norm: f32 = 0.0;
        var rim: f32 = 0.0;
        
        if (p_m.y < 12.0) {
            let uv_raw = (p_m.xz / WORLD_SCALE) % 1.0;
            let uv_c = uv_raw + select(vec2f(0.0), vec2f(1.0), uv_raw < vec2f(0.0));
            let st = uv_c * r;
            let i_st = vec2u(st);
            let f = fract(st);


            let smooth_val = sampleCrater(st, r);


            crater_norm = clamp(smooth_val / 60000.0, 0.0, 1.0);
            rim = sin(crater_norm * 3.1415) * 1.8;
        }

        var p_sample = p_m;
        p_sample.y = abs(p_sample.y);

        let d_terrain = dfbm(p_sample);
        let pyr = dpyramid(p_sample);
        
        // --- CARVING LOGIC ---
        // Subtracting pulls geometry in (Hole). Adding pushes it out (Rim).
        let hole_shape = pow(crater_norm, 0.8) * 6.5;
        //let displacement = hole_shape - (rim * 0.4); 
        let displacement =
            hole_shape * 1.0   // dig hole
                - rim * 1.2;         // push rim upward

        let limit = smoothstep(10.0, -0.5, p_m.y);

        var d = min(d_terrain, pyr.x) - (displacement * limit);

        if (p_m.y > 0.0) {
            let base_col = get_BG();
            let pulse = 0.9 + 0.1 * sin(u.time * 5.0);
            let lava = vec3f(2.5, 0.45, 0.05) * pow(crater_norm, 2.5) * 10.0 * pulse;
            let surface = mix(base_col, vec3f(0.01, 0.005, 0.008), pow(crater_norm, 1.2));

            O += (surface + lava) + min(d, 9.0) * Y_vec;
        } else {
            O += S_col;
        }

        O += smoothstep(pyr.z * 0.78, pyr.z * 0.8, abs(p_m.y)) /
             max(pyr.x + pow(pyr.x, 4.0) * 9.0, 0.01) * get_BF();

        z_dist += d * 0.5;
        if (d < 1e-3 || z_dist > 180.0) { break; }
    }

    O *= 9e-3;
    if (R.y > 0.0) { O *= sky_bg; }

   
    let pillar_tex = textureSample(volcanoFrag, samp, in.uv).rgb;
    O += pillar_tex * 2.8;

    return vec4f(max(O, vec3f(0.0)), 1.0);
}