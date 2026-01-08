const STATE_FALLING : f32 = 0.0;
const STATE_IMPACT  : f32 = 1.0;
const STATE_SLEEP   : f32 = 2.0;

##WORKGROUP_SIZE
fn main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
  
    // if (i >= u32(physics_data.length() / 4u)) {
    //     return;
    // }


    let b = i * 4u;

    // Read meteor state
    let state = physics_data[b + 3u];
    if (state < STATE_IMPACT || state >= STATE_SLEEP) { return; }

    // Meteor world XZ
    let p_xz = vec2f(physics_data[b + 0u], physics_data[b + 2u]);

    // Camera position
    let T = u.time * 3.0;
    let camXZ = vec2f(path(T).x, path(T).z);

    // UV mapping
    var uv = worldXZtoUV(p_xz, camXZ, WORLD_SCALE);
    uv = clamp(uv, vec2f(0.0), vec2f(0.999, 0.999));

    let res = vec2f(u.resolution.xy);
    let center = uv * res;

    let radius: f32 = 6.0;
    let search: i32 = 8;

    for (var x = -search; x <= search; x++) {
        for (var y = -search; y <= search; y++) {
            let offset = vec2f(f32(x), f32(y));
            let d = length(offset);
            if (d > radius) { continue; }

            let coords = vec2i(center + offset);

            if (coords.x < 0 || coords.y < 0 || coords.x >= i32(res.x) || coords.y >= i32(res.y)) {
                continue;
            }


            

            let idx = u32(coords.y) * u32(res.x) + u32(coords.x);
            let falloff = pow(1.0 - d / radius, 2.0);

            // Atomic max: bigger craters overwrite smaller
            atomicMax(&data[idx], u32(falloff * 60000.0));
        }
    }
}