##WORKGROUP_SIZE
fn main(@builtin(global_invocation_id) id: vec3u) {
    let res = vec2f(u.resolution.xy);
    if (f32(id.x) < res.x && f32(id.y) < res.y) {
        textureStore(outTex, id.xy, vec4f(0.0));
    }

    let i = id.x;
    if (i >= u32(u.count)) { return; }
    
    let b = i * 4u;
    var p = vec4f(data[b], data[b+1], data[b+2], data[b+3]);

    p.z -= 0.0005 + (fract(f32(i) * 0.13) * 0.0007);

    if (p.z < 0.1 || u.time < 0.1) {
        let angle = fract(f32(i) * 0.001) * 6.28 + u.time * 0.2;
        let radius = 0.5 + fract(f32(i) * 0.5) * 2.0;
        p.x = cos(angle) * radius;
        p.y = sin(angle) * radius;
        p.z = 4.0 + fract(f32(i) * 123.45);
        p.w = 0.1 + fract(f32(i) * 7.7) * 0.5;
    }

    p.x += sin(p.z + u.time) * 0.001;
    p.y += cos(p.z + u.time) * 0.001;

    data[b] = p.x; data[b+1] = p.y; data[b+2] = p.z; data[b+3] = p.w;

    let aspect = res.x / res.y;
    let screenX = (p.x / p.z);
    let screenY = (p.y / (p.z * aspect));

    let coords = vec2i(
        i32((screenX * 0.5 + 0.5) * res.x), 
        i32((screenY * 0.5 + 0.5) * res.y)
    );
    
    if(coords.x <= 1 || coords.x >= i32(res.x)-1 || coords.y <= 1 || coords.y >= i32(res.y)-1) { return; }

    let depthFactor = saturate(1.0 - (p.z / 4.0));
    let color = mix(vec3f(0.0, 0.1, 0.5), vec3f(0.2, 0.9, 1.0), depthFactor);
    
    textureStore(outTex, coords, vec4f(color * (depthFactor * 3.0), 1.0));
}