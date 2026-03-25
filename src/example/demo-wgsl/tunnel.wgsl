@fragment fn main(in: VSOut) -> @location(0) vec4<f32> {      
   

   if (u.sceneId != 3.0) {
        return vec4f(0.0); // make an exit if not sceneId is 9
    }

    let R: vec2<f32> = u.resolution.xy;
    let uv: vec2<f32> = (in.pos.xy * 2.0 - R) / R.y;
    let T: f32 = u.time;

    let t: f32 = T * 2.0;
    let ro: vec3<f32> = path(t);
    let ta: vec3<f32> = path(t + 1.0);
    
    let front: vec3<f32> = normalize(ta - ro);
    let up: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);
    let right: vec3<f32> = normalize(cross(front, up));
    let cam_up: vec3<f32> = normalize(cross(right, front));
    let rd: vec3<f32> = mat3x3<f32>(right, cam_up, front) * normalize(vec3<f32>(uv, 1.0));

    let zMax: f32 = 50.0;
    var z: f32 = 0.1;
    var col: vec3<f32> = vec3<f32>(0.0);

    for (var i: f32 = 0.0; i < 100.0; i += 1.0) {
        var p: vec3<f32> = ro + rd * z;      
        var q: vec3<f32> = p;
        q.z += t * 3.0;
        let s: f32 = 4.0;
        let id: vec3<f32> = round(q / s);
        q -= id * s;
        
        var d: f32 = 1e20;
        let pos: vec3<f32> = hash33(id) * (s / 2.0) - (s / 4.0);
        let d1_star: f32 = length(q - pos) - 0.06 + hash13(id + T * 1e-3) * 0.2;
        d = min(d, d1_star);
        d = max(0.0, d);

        // Cave
        var d1_cave: f32 = length(p.xy - path(p.z).xy) - 3.0;
        d1_cave = abs(d1_cave) + 0.01;
        d1_cave += fbm(p * 2.0 + t * 2.0);
        d = min(d, d1_cave);
        
        // Texture/Noise detail
        d = d * (1.0 - hash12(in.pos.xy * 100.0 + T) * 0.2);

        let k: f32 = sin(p.z + p.x * 0.5 + p.y * 0.3) * 0.5 + 0.5;
        col += k * (1.1 + sin(vec3<f32>(3.0, 2.0, 1.0) + p.x + p.z + hash13(id))) / (d + 0.001);

        if (d < EPSILON || z > zMax) { break; }
        z += d;
    }

    col = tanh(col / 100.0);
    return vec4<f32>(col, 1.0);

  
}