##WORKGROUP_SIZE
fn main(@builtin(global_invocation_id) id : vec3u) {
    let size = vec2u(u.resolution.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }

    let idx = id.y * size.x + id.x;
    let raw = atomicLoad(&crater_map_data[idx]);

    // DEBUG: any hit becomes full white
    var val : f32 = 0.0;
    if (raw > 0u) { val = 1.0; }

    textureStore(outTex, vec2i(id.xy), vec4f(val, val, val, 1.0));
}
