// worldFrag.wgsl helpers
fn distToRay(ro: vec3f, rd: vec3f, p: vec3f) -> f32 {
    let v = p - ro;
    let projection = dot(v, rd);
    if (projection < 0.0) { return length(v); }
    return length(v - rd * projection);
}

@fragment
fn main(in: VSOut) -> @location(0) vec4f {
    let r = u.resolution.xy;
    let p2 = (vec2f(in.uv.x, 1.0 - in.uv.y) * 2.0 - 1.0) * vec2f(r.x / r.y, 1.0);
    let sky_bg = textureSample(sky, samp, in.uv).rgb;

    // --- CAMERA SYSTEM ---
    let T = u.time * 3.0;
    let ro = path(T); // Ray Origin
    let ZZ = normalize(dpath(T) + vec3f(-0.5, 0.1, 0.0));
    let XX = normalize(cross(ZZ, vec3f(0.0, 1.0, 0.0)));
    let YY = cross(XX, ZZ);
    let rd = normalize(-p2.x * XX + p2.y * YY + fov * ZZ); // Ray Direction

    var O = vec3f(0.0);
    var z_dist: f32 = 0.0;

    // --- 1. ANALYTICAL METEOR GLOW (Calculated outside the loop) ---
    // This ensures they are ALWAYS visible, even in the distance
    var meteor_glow_total = vec3f(0.0);
    for (var m = 0u; m < 2u; m++) {
        let m_pos = vec3f(meteor_physics_data[m*4u], meteor_physics_data[m*4u+1u], meteor_physics_data[m*4u+2u]);
        let m_active = meteor_physics_data[m*4u+3u];

        if (m_active > 0.0) {
            let d = distToRay(ro, rd, m_pos);
            
            // Atmospheric Bloom
            let glow = 0.5 / (1.0 + pow(d, 1.5) * 0.1); 
            meteor_glow_total += glow * vec3f(0.4, 0.7, 1.0) * 1.5;
            
            // Bright Core
            let core = pow(max(0.0, 1.0 - d / 2.0), 8.0);
            meteor_glow_total += core * vec3f(10.0);
        }
    }

    // --- 2. RAYMARCHING (Terrain & Objects) ---
    for (var i = 0; i < 85; i++) {
        let p_m = ro + z_dist * rd;
        
        // Ground optimizations
        if (p_m.y > 50.0 && rd.y > 0.0) { z_dist += p_m.y * 0.5; continue; }

        var p_sample = p_m;
        p_sample.y = abs(p_sample.y);
        let d_terrain = dfbm(p_sample);
        let pyr = dpyramid(p_sample);
        var d = min(d_terrain, pyr.x);

        // Standard lighting
        O += (1.0 + rd.y) * get_BW() * (1.0 + rd.x) * get_BY();

        // IMPACT RENDERING
        if (d < 1.0) {
            let i_uv = vec2u(u32(abs(p_m.x * 10.0)) % 1024u, u32(abs(p_m.z * 10.0)) % 1024u);
            let i_val = f32(atomicLoad(&paint_buffer_data[i_uv.y * 1024u + i_uv.x])) / 600.0;
            if (i_val > 0.01) {
                O += vec3f(0.1, 0.4, 1.0) * i_val * 40.0;
            }
        }

        z_dist += d * 0.6;
        if (d < 1e-3 || z_dist > 180.0) { break; }
    }

    O *= 9e-3;
    O += meteor_glow_total; // Add the meteors on top of the scene

    if (rd.y > 0.0) { O *= sky_bg; }
    return vec4f(max(O, vec3f(0.0)), 1.0);
}