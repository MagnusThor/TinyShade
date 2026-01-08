##WORKGROUP_SIZE
fn main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= u32(u.asteroids)) { return; }

    let b = i * 4u;
    let p_w = physics_data[b + 3u];

    // Check for impact state: Be more generous with the window
    if (p_w < 1.0 || p_w > 1.9) { return; }

    // Use the XZ position from the moment of impact
    let p_xz = vec2f(physics_data[b + 0u], physics_data[b + 2u]);
    let res = vec2f(u.resolution.xy);
    

    // Use floor to handle negative coordinates correctly
    let uv = (p_xz / WORLD_SCALE) - floor(p_xz / WORLD_SCALE); 
    let center = uv * res;

    let rad : f32 = 6.0; // Slightly larger radius
    let search = 8; 

    for (var x = -search; x <= search; x++) {
        for (var y = -search; y <= search; y++) {
            let offset = vec2f(f32(x), f32(y));
            let d = length(offset);
            if (d > rad) { continue; }

            // Ensure we wrap around the resolution correctly
            let coords = (vec2i(center + offset) + vec2i(res)) % vec2i(res);
            let idx = u32(coords.y) * u32(res.x) + u32(coords.x);

            // Use a steeper falloff for a sharper crater rim
            let falloff = pow(1.0 - d / rad, 2.0);
            
            // atomicMax ensures that multiple meteors in the same spot 
            // don't flicker, but the biggest crater wins.
            atomicMax(&data[idx], u32(falloff * 60000.0));
        }
    }
}