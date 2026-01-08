// Constants
const PI: f32 = 3.141592654;
const TAU: f32 = 6.283185307;
const OFF: f32 = 0.7;
const ZZ_GRID: f32 = 22.0;
const tomb_probability: f32 = .1;
const fov: f32 = 2.0;

//const WORLD_SCALE : f32 = 2000.0; 
const WORLD_SCALE: f32 = 800.0;

const R_mat: mat2x2f = mat2x2f(1.2, 1.6, -1.6, 1.2);
const GG_pos: vec3f = vec3f(-700.0, 300.0, 1000.0);
const GG_radius: f32 = 400.0;
const RN: vec3f = normalize(vec3f(-0.2, 1.0, -1.1));
const LD: vec3f = normalize(vec3f(1.0, -0.5, 1.0));


fn worldXZtoUV(worldXZ: vec2f, camXZ: vec2f, scale: f32) -> vec2f {
    let rel = worldXZ - camXZ;
    var uv = rel / scale * 0.5 + 0.5; // map [-scale/2, scale/2] -> [0,1]
    uv = clamp(uv, vec2f(0.0), vec2f(0.999, 0.999));
    return uv;
}


// Path logic
fn path(z: f32) -> vec3f {
    return vec3f(vec2f(25.0, 3.3) + vec2f(6.0, 1.41) * cos(vec2f(0.056, 0.035) * z), z);
}

fn dpath(z: f32) -> vec3f {
    return vec3f(vec2f(-6.0 * 0.056, -1.41 * 0.035) * sin(vec2f(0.056, 0.035) * z), 1.0);
}

// Math helpers
fn hash(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(12.9898, 58.233))) * 43758.5453);
}


fn hsv2rgb(c: vec3f) -> vec3f {
    let k = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
    return c.z * mix(k.xxx, clamp(p - k.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}

fn tanh_approx(x: vec3f) -> vec3f {
    let x2 = x * x;
    return clamp(x * (27.0 + x2) / (27.0 + 9.0 * x2), vec3f(-1.0), vec3f(1.0));
}

fn fbm(x_in: f32) -> f32 {
    var x = x_in;
    var a: f32 = 1.0;
    var h: f32 = 0.0;
    for (var i = 0; i < 5; i++) {
        h += a * sin(x);
        x *= 2.03; x += 123.4; a *= 0.55;
    }
    return abs(h);
}

// THE TERRAIN SDF (3D Fractal)
fn dfbm(p_in: vec3f) -> f32 {
    var p = p_in;
    var d: f32 = p.y + 0.6;
    var a: f32 = 1.0;
    var D = vec2f(0.0);
    var P_map = 0.23 * p.xz;

    for (var j = 0; j < 7; j++) {
        let o = cos(P_map.xxyy + vec4f(11.0, 0.0, 11.0, 0.0));
        let p_rot = o.yxx * o.zwz;
        D += p_rot.xy;
        d -= a * (1.0 + p_rot.z) / (1.0 + 3.0 * dot(D, D));
        P_map = R_mat * P_map;
        a *= 0.55;
    }
    return d;
}

fn dpyramid(p_in: vec3f) -> vec3f {
    var p = p_in;
    let n = floor(p.xz / ZZ_GRID + 0.5);
    p.x -= n.x * ZZ_GRID;
    p.z -= n.y * ZZ_GRID;
    
    let h0 = hash(n);
    let h1 = fract(9677.0 * h0);
    
    // --- THE SCALE FIX ---
    // Original was 0.3 * 11.0. 
    // New is 0.9 * 11.0 (Approx 10 units high). 
    // This makes them 3x taller without breaking the raymarcher.
    let h = 0.9 * 22.0 * (h0 * h0 + 0.2); 
    
    let a = abs(p);
    let d = (a.x + a.y + a.z - h) * 0.57735027;
    
    if (h1 > tomb_probability) { return vec3f(1e4, 0.0, 0.0); }
    return vec3f(d, h0, h);
}

// fn dpyramid(p_in: vec3f) -> vec3f {
//     var p = p_in;
//     let n = floor(p.xz / ZZ_GRID + 0.5);
//     p.x -= n.x * ZZ_GRID;
//     p.z -= n.y * ZZ_GRID;
    
//     let h0 = hash(n);
//     let h1 = fract(9677.0 * h0);
//     let h = 0.3 * ZZ_GRID * h0 * h0 + 0.1;
    
//     // Check if the pyramid exists at all
//     if (h1 > tomb_probability) { return vec3f(1e3, 0.0, 0.0); }

//     var d: f32;
//     let a = abs(p);

//     // RANDOMLY PICK SHAPE
//     // h1 is our random seed. If > 0.5, make it a Ziggurat, else Smooth.
//     if (h1 > 0.4) {
//         // --- ZIGGURAT SHAPE ---
//         let num_steps = 5.0; 
//         let step_h = h / num_steps;
//         let snapped_y = floor(max(0.0, p.y) / step_h) * step_h;
        
//         let horizontal = max(a.x, a.z);
//         d = max(horizontal + snapped_y - h, p.y - h); 
//     } else {
//         // --- SMOOTH SHAPE (Original Diamond Style) ---
//         d = (a.x + a.y + a.z - h) * 0.57735027;
//     }

//     // Return d * 0.5 for stability, the hash h0, and the height h
//     return vec3f(d * 0.5, h0, h);
// }


fn get_BY() -> vec3f { return hsv2rgb(vec3f(0.05 + OFF, 0.7, 0.8)); }
fn get_BG() -> vec3f { return hsv2rgb(vec3f(0.95 + OFF, 0.6, 0.3)); }
fn get_BW() -> vec3f { return hsv2rgb(vec3f(0.55 + OFF, 0.1, 2.5)); }
fn get_BF() -> vec3f { return hsv2rgb(vec3f(0.82 + OFF, 0.6, 2.0)); }