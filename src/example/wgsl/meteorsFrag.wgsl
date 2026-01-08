@fragment
fn main(in: VSOut) -> @location(0) vec4f {
    let r = u.resolution.xy;
    let p2 = (vec2f(in.uv.x, 1.0 - in.uv.y) * 2.0 - 1.0) * vec2f(r.x / r.y, 1.0);

    let T = u.time * 3.0;
    let P = path(T);
    let ZZ = normalize(dpath(T) + vec3f(-0.5, 0.1, 0.0));
    let XX = normalize(cross(ZZ, vec3f(0.0, 1.0, 0.0)));
    let YY = cross(XX, ZZ);
    let R = normalize(-p2.x * XX + p2.y * YY + fov * ZZ);

    var layer = vec3f(0.0);

    for (var i = 0u; i < u32(u.asteroids); i++) {
        let b = i * 4u;
        let m_pos = vec3f(physics_data[b], physics_data[b+1], physics_data[b+2]);
        let state = physics_data[b+3];

        if (state >= 1.0) { continue; }

        let dir = m_pos - P;
        let dist = length(dir);
        let align = max(dot(R, normalize(dir)), 0.0);
        let dist_norm = clamp(dist / 180.0, 0.0, 1.0);


        // Massive sharpness (150,000) makes the core tiny.
        // Even at a distance, we keep it high (20,000) so it's a "star".
        let sharpness = mix(150000.0, 20000.0, dist_norm);
        
        // Core is now a needle-point
        let core = pow(align, sharpness) * 80.0;
        
        // Very subtle atmospheric glow (reduced size)
        let halo = pow(align, mix(2000.0, 500.0, dist_norm)) * 1.5;

        // Flicker is faster to simulate atmospheric turbulence
        let flicker = 0.7 + 0.3 * sin(u.time * 35.0 + f32(i));
        
        let color = mix(vec3f(1.0, 0.9, 0.7), vec3f(1.0, 0.4, 0.1), dist_norm);

        layer += color * (core + halo) * flicker * (300.0 / (dist + 50.0));
    }

    // Gentle bloom/tonemap to prevent blocky pixels
    return vec4f(layer / (1.0 + layer), 1.0);
}