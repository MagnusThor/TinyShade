const STATE_FALLING : f32 = 0.0;
const STATE_IMPACT  : f32 = 1.0;
const STATE_SLEEP   : f32 = 2.0;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= u32(u.asteroids)) { return; }
    let b = i * 4u;
    var p = vec4f(data[b], data[b+1], data[b+2], data[b+3]);

    let T = u.time * 3.0; 
    let F = normalize(dpath(T)); 
    let Right = normalize(vec3f(-F.z, 0.0, F.x));

    // Unique seed for this specific meteor instance
    let meteor_seed = hash(vec2f(f32(i), 123.456));

    if (p.w <= STATE_FALLING) {
        // --- 1. RANDOMIZED SPEED ---
        // Range: 0.3 (30%) to 1.0 (100%)
        let speed_mult = mix(0.3, 1.0, meteor_seed);
        
        // Base speeds (The max speed we decided on previously)
        let base_h_speed = 0.8;
        let base_v_drop = 0.6;

        let h = hash(vec2f(f32(i), 7.89));
        let target_pos = path(T + 25.0) + Right * (h - 0.5) * 60.0;
        let to_target = normalize(target_pos - p.xyz);

        // Apply movement using the unique speed multiplier
        p.x += to_target.x * base_h_speed * speed_mult;
        p.z += to_target.z * base_h_speed * speed_mult;
        p.y -= base_v_drop * speed_mult;

        if (p.y <= 0.0) {
            p.y = 0.0;
            p.w = STATE_IMPACT; 
        }
    } 
    else if (p.w >= STATE_IMPACT && p.w < STATE_SLEEP) {
        p.y = -10.0; 
        p.w += 0.2; 
        if (p.w >= 1.5) {
            // Randomize sleep time so they don't all respawn together
            p.w = STATE_SLEEP + 10.0 + (meteor_seed * 100.0); 
        }
    } 
    else {
        p.w -= 0.016; 
        if (p.w <= STATE_SLEEP) {
            let h = hash(vec2f(f32(i), T + f32(i)));
            
            // Re-centering logic (Camera offset -0.5)
            let look_ahead = 110.0; 
            let spawn_ref = path(T + look_ahead) + vec3f(-0.5 * look_ahead, 0.0, 0.0);
            
            p.x = spawn_ref.x + Right.x * ((h - 0.5) * 180.0);
            p.z = spawn_ref.z + Right.z * ((h - 0.5) * 180.0);
            p.y = 100.0; 
            p.w = STATE_FALLING;
        }
    }

    data[b] = p.x; data[b+1] = p.y; data[b+2] = p.z; data[b+3] = p.w;
}