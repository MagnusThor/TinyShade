
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= 4u) { return; } // Support for METEOR_COUNT = 4

    // data[0..2] = pos, data[3] = velocity/speed info
    var pos = vec3f(data[idx * 4u], data[idx * 4u + 1u], data[idx * 4u + 2u]);
    var speed = data[idx * 4u + 3u];

    let camZ = u.time * 3.0;
    let camPos = path(camZ);

    if (u.time < 0.5 || pos.y < -5.0 || pos.z < camZ - 20.0) {
        let seed = f32(idx) * 127.42 + u.time;
        
        pos = vec3f(
            camPos.x + (fract(sin(seed) * 437.0) - 0.5) * 120.0, // Wide X spread
            80.0,                                               // High altitude
            camZ + 180.0 + fract(cos(seed)) * 50.0              // Far ahead
        );
        
        // Speed: Slow but consistent for the long travel
        speed = 0.4 + fract(sin(seed * 2.0)) * 0.3;
    } else {
        // DIAGONAL TRAJECTORY
        // Instead of just falling down, they streak toward the camera's general area
        let streak_dir = normalize(vec3f(-0.2, -1.0, -1.2)); // Diagonal downward toward cam
        pos += streak_dir * speed;
    }

    // IMPACT (Close to ground)
    if (pos.y <= 0.0 && pos.y > -2.0) {
        // Only register if it's within a reasonable distance of the path
        let uv = vec2u(u32(abs(pos.x * 10.0)) % 1024u, u32(abs(pos.z * 10.0)) % 1024u);
        
        let r = 8i; 
        for(var x = -r; x <= r; x++) {
            for(var y = -r; y <= r; y++) {
                let d_sq = f32(x*x + y*y);
                if(d_sq < f32(r*r)) {
                    let cx = u32(i32(uv.x) + x) % 1024u;
                    let cy = u32(i32(uv.y) + y) % 1024u;
                    let heat = u32(120.0 * (1.0 - sqrt(d_sq)/f32(r)));
                    atomicAdd(&paint_buffer_data[cy * 1024u + cx], heat);
                }
            }
        }
        pos.y = -10.0;
    }

    data[idx * 4u] = pos.x;
    data[idx * 4u + 1u] = pos.y;
    data[idx * 4u + 2u] = pos.z;
    data[idx * 4u + 3u] = speed;
}