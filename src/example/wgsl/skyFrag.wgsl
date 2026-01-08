fn stars(R_in: vec3f) -> vec3f {
    var R = R_in; var Z = 6.28318 / 200.0; var col = vec3f(0.0); var a = 1.0;
    for (var i = 0; i < 3; i++) {
        R = R.zxy; 
        let s = vec2f(acos(clamp(R.z/length(R), -1.0, 1.0)), atan2(R.y, R.x));
        let n = floor(s/Z + 0.5); var c = s - Z*n;
        let h0 = hash(n + 123.4 * f32(i+1));
        c.y *= sin(s.x);
        let intensity = step(h0, 0.1 * sin(s.x)) * fract(8887.0 * h0) * 0.000007;
        col += a * hsv2rgb(vec3f(-0.4 * fract(8887.0 * h0), sqrt(fract(9677.0 * h0)), intensity / dot(c, c)));
        Z *= 0.5; a *= 0.5;
    }
    return col;
}

@fragment
fn main(in: VSOut) -> @location(0) vec4f {
    let r = u.resolution.xy;
    let p2 = (vec2f(in.uv.x, 1.0 - in.uv.y) * 2.0 - 1.0) * vec2f(r.x / r.y, 1.0);
    let T = 3.0 * u.time;
    let P = path(T);
    let ZZ_cam = normalize(dpath(T) + vec3f(-0.5, 0.1, 0.0));
    let XX = normalize(cross(ZZ_cam, vec3f(0.0, 1.0, 0.0)));
    let YY = cross(XX, ZZ_cam); 
    let R = normalize(-p2.x * XX + p2.y * YY + fov * ZZ_cam);

    var Y = vec3f(0.0);
    if (R.y > -0.2) {
        let sph_center = GG_pos + P;
        let b_s = dot(P - sph_center, R);
        let c_s = dot(P - sph_center, P - sph_center) - GG_radius * GG_radius;
        let h_s = b_s * b_s - c_s;
        var z_sph = -1.0; if (h_s >= 0.0) { z_sph = -b_s - sqrt(h_s); }
        
        let F_sky = smoothstep(-0.05, 0.05, R.y);
        Y = clamp(hsv2rgb(vec3f(OFF - 0.4 * R.y, 0.5 + 1.0 * R.y, 3.0 / (1.0 + 800.0 * pow(max(0.0, R.y), 3.0)))), vec3f(0.0), vec3f(1.0));
        let L_val = dot(vec3f(0.2126, 0.7152, 0.0722), Y);
        
        if (z_sph > 0.0) {
            let p_sph = P + R * z_sph;
            let norm_s = normalize(p_sph - sph_center);
            Y += max(dot(LD, norm_s), 0.0) * F_sky * smoothstep(1.0, 0.89, 1.0 + dot(R, norm_s)) * fbm(0.02 * dot(p_sph - sph_center, RN));
        }
        
        let plane_dist = -(dot(P, RN) + (-dot(RN, sph_center))) / dot(R, RN);
        if (plane_dist > 0.0 && (z_sph < 0.0 || plane_dist < z_sph)) {
            let p_ring = P + R * plane_dist;
            let d_ring = distance(sph_center, p_ring);
            
            let ring_to_light = LD;
            let ring_to_center = normalize(p_ring - sph_center);
            let shadow = smoothstep(-0.2, 0.1, dot(ring_to_center, ring_to_light));

            let ring_mask = smoothstep(GG_radius * 1.41, GG_radius * 1.46, d_ring) * smoothstep(GG_radius * 2.0, GG_radius * 1.95, d_ring);
            let ring_tex = fbm(0.035 * d_ring) * abs(dot(LD, RN));
            
            Y += F_sky * ring_mask * ring_tex * shadow;
        }
        if (z_sph < 0.0) { Y += pow(max(0.0, 1.0 - L_val), 4.0) * stars(R); }
    }
    return vec4f(Y, 1.0);
}