##WORKGROUP_SIZE
fn main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= 1000u) { return; } 
    
    let b = i * 4u;
    let pos = vec3f(volcano_data[b], volcano_data[b+1], volcano_data[b+2]);
    let life = volcano_data[b+3];

    if (life <= 0.0) { return; }


    let P = vec3f(0.0, 15.0, -30.0); 
    let ZZ = vec3f(0.0, 0.0, 1.0);  // Forward
    let XX = vec3f(1.0, 0.0, 0.0);  // Right
    let YY = vec3f(0.0, 1.0, 0.0);  // Up

    let rel = pos - P;           
    let depth = dot(rel, ZZ);    

    if (depth < 0.1) { return; }

    let res = u.resolution.xy;
    let aspect = res.x / res.y;
    
    // Project with a wide FOV 
    let x_proj = dot(rel, XX) / (depth * 1.5);
    let y_proj = dot(rel, YY) / (depth * 1.5);

    let uv = vec2f(
        (x_proj / aspect) * 0.5 + 0.5,
        1.0 - (y_proj * 0.5 + 0.5)
    );

    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        let coords = vec2u(u32(uv.x * res.x), u32(uv.y * res.y));
        let idx = coords.y * u32(res.x) + coords.x;
        
        if (idx < u32(res.x * res.y)) {
            // High intensity to make sure it shows up on a black screen?
            atomicAdd(&data[idx], 50u); 
        }
    }
}