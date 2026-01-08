##WORKGROUP_SIZE
fn main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= 1000u) { return; } 
    
    let b = i * 4u;
    let pos = vec3f(volcano_data[b], volcano_data[b+1], volcano_data[b+2]);
    let life = volcano_data[b+3];

    if (life <= 0.0) { return; }

    // --- CAMERA SYSTEM ---
    let T = u.time * 3.0;
    let P = path(T);
    let ZZ = normalize(dpath(T) + vec3f(-0.5, 0.1, 0.0));
    let XX = normalize(cross(ZZ, vec3f(0.0, 1.0, 0.0)));
    let YY = cross(XX, ZZ);

    let rel = pos - P;           
    let depth = dot(rel, ZZ);    


    // If it's closer than 2.0 units or behind the camera, KILL IT.
    if (depth <= 2.0) { return; }

    let res = u.resolution.xy;
    let aspect = res.x / res.y;
    let inv_d = fov / depth;
    
    // Project to Camera Space
    let p_x = dot(rel, XX) * inv_d;
    let p_y = dot(rel, YY) * inv_d;

  
    // In normalized device coordinates, the screen is roughly -aspect to +aspect.
    // If the math results in a point way outside this, it's a "ghost" projection.
    if (abs(p_x) > aspect * 1.5 || abs(p_y) > 1.5) { return; }

    // Map to UV [0, 1]
    let uv = vec2f((-p_x / aspect + 1.0) * 0.5, 1.0 - (p_y + 1.0) * 0.5);

   
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        let coords = vec2u(u32(uv.x * res.x), u32(uv.y * res.y));
        
        // Final safety check to prevent writing to index 0 or out of bounds
        if (coords.x < u32(res.x) && coords.y < u32(res.y)) {
            let idx = coords.y * u32(res.x) + coords.x;
            
         
            atomicAdd(&data[idx], 10u); 
        }
    }
}