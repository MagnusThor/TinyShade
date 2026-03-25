const PI:  f32 = 3.141592654;
const TAU: f32 = 6.283185307;
const EPSILON: f32 = 1e-6;

// ── Palette ──────────────────────────────────────────────────────
// Particle colour ramp  (cool → warm, by distance from scene centre)
const C_PARTICLE_COOL: vec3f = vec3f(0.10, 0.60, 1.00);  // blue
const C_PARTICLE_WARM: vec3f = vec3f(1.00, 0.70, 0.20);  // gold

// Fog colours — dark / near-black background
const C_FOG_SKY  = vec3f(0.02, 0.03, 0.06);
const C_FOG_COLD = vec3f(0.05, 0.06, 0.10);
const C_FOG_WARM = vec3f(0.10, 0.07, 0.04);

// Black hole accretion disc
const C_BH_INNER: vec3f = vec3f(0.10, 0.55, 1.00);   // inner disc  (blue-white)
const C_BH_OUTER: vec3f = vec3f(1.00, 0.65, 0.15);   // outer disc  (gold/amber)
const C_BH_GLOW:  vec3f = vec3f(0.90, 0.85, 0.50);   // corona glow (pale yellow)
const C_BH_RIM:   vec3f = vec3f(1.00, 0.60, 0.20);   // warp rim    (orange)

// Lattice steel/silver
const LATTICE_HUE: f32 = 0.08;

// Distant sun 
const C_SUN_HALO: vec3f = vec3f(0.15, 0.25, 0.60);   
const SUN_POS:    vec2f = vec2f(0.62, 0.54);          
const SUN_BRIGHT: f32   = 0.55;                       
const SUN_SCALE:  f32   = 0.10;                       

// ── Geometry sizes ────────────────────────────────────────────────
const LATTICE_TUBE:   f32 = 0.04;   // lattice wire thickness
const SPHERE_R1:      f32 = 0.480;  // outer glass sphere radius
const SPHERE_R2:      f32 = 0.425;  // inner neon rings base radius
const LIGHT_BOX_BASE: f32 = 0.40;   // Blue light half-size
const LIGHT_BOX_2:    f32 = 0.85;   // Gold light base size

// ── Metallic shading — energy floor ──────────────────────────────
const METALLIC_MIN_ATTENUATION: f32 = 0.05;

// ── Math Helpers ──────────────────────────────────────────────────
fn noise3(p: vec3f) -> f32 {
    let ip = floor(p); var fp = p - ip;
    let s  = vec3f(7.0, 157.0, 113.0);
    let h4 = vec4f(0.0, s.y, s.z, s.y + s.z) + dot(ip, s);
    fp = fp * fp * (3.0 - 2.0 * fp);
    let ha  = mix(fract(sin(h4) * 43758.5), fract(sin(h4 + s.x) * 43758.5), fp.x);
    let hxy = mix(vec2f(ha.x, ha.z), vec2f(ha.y, ha.w), fp.y);
    return mix(hxy.x, hxy.y, fp.z);
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

fn pR(p: vec2f, a: f32) -> vec2f {
    return cos(a) * p + sin(a) * vec2f(p.y, -p.x);
}

fn pcg_hash(input: u32) -> u32 {
    var state = input * 747796405u + 2891336453u;
    var word  = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn rand(seed: ptr<function, u32>) -> f32 {
    *seed = pcg_hash(*seed);
    return f32(*seed) / f32(0xffffffffu);
}

fn hashHs(seed: ptr<function, u32>) -> vec3f {
    let a = (rand(seed) * 2.0) - 1.0;
    let b = TAU * rand(seed);
    let c = sqrt(max(0.0, 1.0 - a * a));
    return vec3f(c * cos(b), a, c * sin(b));
}

fn filmic(x: vec3f) -> vec3f {
    let a = x * (x + 0.0245786) - 0.000090537;
    let b = x * (0.983729 * x + 0.432951) + 0.238081;
    return a / b;
}

// ── Metallic Shading Helpers ──────────────────────────────────────
// Stylised Fresnel rim — squared falloff (not physical Schlick,
// but gives a clean controllable rim width for the lattice tubes).
fn metallic_fresnel(normal: vec3f, viewDir: vec3f) -> f32 {
    let f = 1.0 + dot(normal, viewDir);
    return f * f;
}

// Blinn-Phong-style specular for the tube highlight strip.
fn metallic_specular(normal: vec3f, lightDir: vec3f, power: f32) -> f32 {
    return pow(max(dot(normal, lightDir), 0.0), power);
}

// Iq-style palette: sin-based colour cycling driven by the fresnel value.
// baseColor  — phase offsets per channel (RGB), controls the dominant hue.
// colorOffset — scalar brightness lift so dark fresnel zones aren't jet-black.
fn metallic_palette(fresnel: f32, baseColor: vec3f, colorOffset: f32) -> vec3f {
    return vec3f(colorOffset) + sin(vec3f(-fresnel) + baseColor);
}

// Single-bounce metallic shading — used inline in the lattice branch.
// Returns a linear-space radiance contribution (not tonemapped).
fn metallic_shade(
    normal:      vec3f,
    viewDir:     vec3f,
    lightDir:    vec3f,
    baseColor:   vec3f,
    colorOffset: f32,
    specPower:   f32
) -> vec3f {
    let fresnel = metallic_fresnel(normal, viewDir);
    let spec    = metallic_specular(normal, lightDir, specPower);
    let palette = metallic_palette(fresnel, baseColor, colorOffset);
    return spec * palette;
}

// Multi-bounce accumulation — no scene tracing, pure shading math.
// Reflects the view ray fictitiously to simulate the look of a
// polished surface catching reflections from multiple directions.
fn metallic_reflection(
    normal:      vec3f,
    viewDir:     vec3f,
    lightDir:    vec3f,
    baseColor:   vec3f,
    colorOffset: f32,
    specPower:   f32,
    intensity:   f32,
    maxBounces:  i32
) -> vec3f {
    var color = vec3f(0.0);
    var A     = intensity;
    var dir   = viewDir;
    var n     = normal;

    for (var i = 0; i < maxBounces; i++) {
        let fresnel = metallic_fresnel(n, dir);
        let spec    = metallic_specular(n, lightDir, specPower);
        let palette = metallic_palette(fresnel, baseColor, colorOffset);
        color += A * spec * palette;
        dir    = reflect(dir, n);
        A     *= mix(0.3, 0.7, fresnel);
        if (A < METALLIC_MIN_ATTENUATION) { break; }
    }
    return color;
}

// ── SDF Library ───────────────────────────────────────────────────

fn latticeSDF(p: vec3f) -> f32 {
    var pl = p;
    if (u.showTwist > 0.05) {
        let twist = u.showTwist * 0.25 * sin(u.time * 0.3 + p.y * 0.8);
        let plxz  = pR(pl.xz, twist);
        pl = vec3f(plxz.x, pl.y, plxz.y);
    }
    let ql = abs(pl - round(pl - 0.5) - 0.5);
    let g  = min(min(max(ql.x, ql.y), max(ql.x, ql.z)), max(ql.y, ql.z)) - LATTICE_TUBE;
    let c  = min(0.6 - abs(pl.x + pl.z), 0.45 - abs(pl.y));
    return max(g, c);
}

fn warmLightSDF(p: vec3f, distort: f32) -> f32 {
    let lightSize = LIGHT_BOX_2 + u.audioMid * 1.1 + 0.3 * sin(u.time * 1.5);
    let d2d = max(abs(p.z + 1.2) - lightSize, abs(p.x + 1.2) - lightSize);
    let slab = max(d2d, abs(p.y) - 1.5); 
    // Increased distort multiplier (was 1.0×) so the gold slab bleeds
    // further into the scene and casts more indirect warmth on the lattice.
    return slab - distort * 1.8;
}

fn mapScene(p: vec3f, rot: f32) -> vec3f {
    var d = vec3f(1e9, 0.0, 0.0);
    
    // 1. Floor
    if (u.showFloor > 0.05) {
        let f_dist = smin(5.0 - p.z, 1.5 - p.y, 10.0);
        let f_mat  = 0.1 + 0.3 * step(0.5, (4.0 * p.z) % 1.0);
        if (f_dist < d.x) { d = vec3f(f_dist, f_mat, 0.0); }
    }
    
    // 2. Metal Lattice
    if (u.showLattice > 0.05) {
        let lat = latticeSDF(p);
        // m.y = 0.1 (non-emitter), m.z = 0.0 (metallic shading applied in
        // computeTex0 via the metallic helpers — not via color_mod).
        if (lat < d.x) { d = vec3f(lat, 0.1, 0.0); }
    }
    
    // 3. Central Sphere System
    if (u.showSphere > 0.05) {
        var q   = p;
        let qxy = pR(q.xy, sin(rot) + 0.2);
        q = vec3f(qxy.x, qxy.y, q.z);
        
        // Outer Dark Glass Shell
        let s1 = length(q + vec3f(0.0, 0.0, 2.5)) - SPHERE_R1;
        if (s1 < d.x) { d = vec3f(s1, 0.9, 0.5); } 
        
        // Inner Neon Rings (emitter, blue/white)
        let s2 = length(q + vec3f(0.0, 0.0, 2.5)) - SPHERE_R2 - 0.09 * sin(43.0 * q.y);
        if (s2 < d.x) { d = vec3f(s2, 1.0, 0.2); } 
    }
    
    // 4. Lights (SDF Objects)
    if (u.showLights > 0.05) {
        let distort = 0.2 * noise3(10.0 * p);
        
        // BLUE Lightbox
        let l1_size = LIGHT_BOX_BASE + u.audioLow * 0.45;
        let l1 = max(max(abs(p.z - 2.0) - l1_size, abs(p.x - 2.0) - l1_size), abs(p.y) - 1.2) - distort;
        // m.z = 0.45 → color_mod.rgb = (0.55, 1.0, 1.45) — but clamped in shade
        // branch to explicit cyan-white target (see computeTex0).
        if (l1 < d.x) { d = vec3f(l1, 1.0, 0.45); }
        
        // GOLD Warm Light (large volumetric slab)
        let l2 = warmLightSDF(p, distort);
        // m.z = -0.45 → explicit amber target in computeTex0 emitter branch.
        if (l2 < d.x) { d = vec3f(l2, 1.0, -0.45); }
    }
    
    return d;
}

// ── Rendering & Logic ─────────────────────────────────────────────

fn getCameraAxes(ro: vec3f) -> mat3x3<f32> {
    let fwd   = normalize(vec3f(0.0) - ro);
    let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
    let up    = cross(right, fwd);
    return mat3x3<f32>(right, up, fwd);
}

fn fftBin(bin: f32) -> f32 {
    return textureSample(fft, samp, vec2f((bin + 0.5) / 128.0, 0.5)).r;
}

fn curlNoise(p: vec3f, t: f32) -> vec3f {
    let e  = 0.1; let sc = 0.55; let scroll = t * 0.06;
    let nx_dy = noise3((p + vec3f(0.0,e,0.0)) * sc + vec3f(scroll,0.0,0.0));
    let nx_dz = noise3((p + vec3f(0.0,0.0,e)) * sc + vec3f(scroll,0.0,0.0));
    let ny_dx = noise3((p + vec3f(e,0.0,0.0)) * sc + vec3f(0.0,scroll,3.7));
    let ny_dz = noise3((p + vec3f(0.0,0.0,e)) * sc + vec3f(0.0,scroll,3.7));
    let nz_dx = noise3((p + vec3f(e,0.0,0.0)) * sc + vec3f(7.3,0.0,scroll));
    let nz_dy = noise3((p + vec3f(0.0,e,0.0)) * sc + vec3f(7.3,0.0,scroll));
    return normalize(vec3f(nz_dy - ny_dz, nx_dz - nz_dx, ny_dx - nx_dy));
}

fn vortexForce(pos: vec3f, axis: vec3f, center: vec3f, strength: f32) -> vec3f {
    let d    = pos - center; let axN = normalize(axis);
    let par  = dot(d, axN) * axN; let perp = d - par;
    let tang = cross(axN, perp); let r = length(perp);
    return -normalize(perp) * strength * 0.4 / (r + 0.3)
            + normalize(tang)  * strength * 0.6 / (r + 0.3);
}

fn attractorForce(pos: vec3f, dest: vec3f, strength: f32) -> vec3f {
    let d = dest - pos; let r = length(d);
    return normalize(d) * strength / (r * r + 0.25);
}

// ── Accretion ring ───────────────────────────────────────────────
fn bhBlob(U: vec2f, angle: f32) -> f32 {
    let c = 0.52 * vec2f(cos(angle), sin(angle));
    return exp(-10.0 * pow(length(U - c), 2.0));
}

fn blackHole(uv: vec2f, t: f32, pulse: f32) -> vec3f {
    let U    = (uv * 2.0 - 1.0) * vec2f(16.0/9.0, 1.0);
    let spin = t * 0.18;
    let ring = bhBlob(U, 0.65 + spin) + bhBlob(U, 1.60 + spin) + bhBlob(U, 2.80 + spin);
    let r       = length(U);
    let horizon = 1.0 - smoothstep(0.0, 0.12, r);
    let tc   = saturate(r / 0.8);
    let col  = mix(C_BH_INNER, C_BH_OUTER, tc);
    let glow = exp(-8.0 * pow(r - 0.18, 2.0)) * (1.2 + pulse * 0.8);
    var out  = col * (0.7 + ring * (0.8 + pulse * 0.5)) + C_BH_GLOW * glow;
    out *= (1.0 - horizon);
    out *= 0.5 - 0.5 * cos(min(6.0 * r, 6.283));
    return out;
}

// ── Distant sun / persistent background light source ─────────────
fn distantSun(uv: vec2f, t: f32, pulse: f32) -> vec3f {
    let asp    = vec2f(16.0 / 9.0, 1.0);
    let d      = (uv - SUN_POS) * asp;
    let r      = length(d);
    let breath = 1.0 + 0.06 * sin(t * 0.17) + 0.03 * sin(t * 0.37);
    let U    = d / (SUN_SCALE * breath);
    let spin = t * 0.06;
    let ring = bhBlob(U, 0.65 + spin)
                + bhBlob(U, 1.60 + spin)
                + bhBlob(U, 2.80 + spin);
    let rU   = length(U);
    let tc   = saturate(rU / 0.8);
    let disc = mix(C_BH_INNER, C_BH_OUTER, tc);
    let core = exp(-rU * rU * 3.5) * 3.0;
    let glow = exp(-8.0 * pow(rU - 0.18, 2.0)) * (1.0 + pulse * 0.5);
    let halo_r = r / (SUN_SCALE * 4.5);
    let halo   = pow(max(0.0, 1.0 - halo_r), 2.2) * 0.9;
    let disc_env = 0.5 - 0.5 * cos(clamp(rU * 1.5, 0.0, PI));
    var out = disc * ring * disc_env
            + C_BH_GLOW  * (core + glow)
            + C_SUN_HALO * halo;
    return clamp(out * SUN_BRIGHT, vec3f(0.0), vec3f(1.0));
}

// ── Lens flare — aperture streaks + rings around the sun ─────────
fn lensFlare(uv: vec2f, t: f32, audioLow: f32, strength: f32) -> vec3f {
    if (strength < 0.005) { return vec3f(0.0); }
    let asp    = vec2f(16.0 / 9.0, 1.0);
    let d      = (uv - SUN_POS) * asp;
    let r      = length(d);
    let theta  = atan2(d.y, d.x);
    let rot    = t * 0.062;
    var spokes = 0.0;
    for (var k = 0u; k < 6u; k++) {
        let angle_k  = f32(k) * PI / 3.0 + rot;
        let dTheta   = theta - angle_k;
        let dTw      = dTheta - TAU * round(dTheta / TAU);
        let angular  = exp(-dTw * dTw * 280.0);
        let lenMod   = 0.7 + 0.3 * sin(t * (0.11 + f32(k) * 0.073) + f32(k) * 1.3);
        let audioLen = 1.0 + audioLow * 0.5;
        let falloff  = exp(-r * 9.0 / (lenMod * audioLen));
        spokes      += angular * falloff;
    }
    spokes = clamp(spokes * 1.4, 0.0, 1.0);
    let ring1  = exp(-140.0 * pow(r - 0.050, 2.0)) * 0.55;
    let ring2  = exp(-200.0 * pow(r - 0.095, 2.0)) * 0.30;
    let ring3  = exp(-300.0 * pow(r - 0.150, 2.0)) * 0.15;
    let gd     = (uv - (vec2f(1.0) - SUN_POS)) * asp;
    let gr     = length(gd);
    let ghost  = exp(-220.0 * pow(gr - 0.030, 2.0)) * 0.20;
    let dR     = (uv - SUN_POS) * asp * vec2f(0.985, 1.0);
    let dB     = (uv - SUN_POS) * asp * vec2f(1.015, 1.0);
    let rR     = length(dR); let rB = length(dB);
    let thR    = atan2(dR.y, dR.x); let thB = atan2(dB.y, dB.x);
    var sR     = 0.0; var sB = 0.0;
    for (var k = 0u; k < 6u; k++) {
        let ak  = f32(k) * PI / 3.0 + rot;
        let lm  = 0.7 + 0.3 * sin(t * (0.11 + f32(k) * 0.073) + f32(k) * 1.3);
        let al  = 1.0 + audioLow * 0.5;
        let dtR = thR - ak; let dtRw = dtR - TAU * round(dtR / TAU);
        let dtB = thB - ak; let dtBw = dtB - TAU * round(dtB / TAU);
        sR += exp(-dtRw * dtRw * 280.0) * exp(-rR * 9.5 / (lm * al));
        sB += exp(-dtBw * dtBw * 280.0) * exp(-rB * 8.5 / (lm * al));
    }
    let chromaSpoke = vec3f(clamp(sR, 0.0, 1.0), spokes, clamp(sB, 0.0, 1.0)) * 0.55;
    let rings  = C_BH_GLOW  * (ring1 + ring2 + ring3)
                + C_SUN_HALO * ghost;

    // ── Musk-style ghost circles ──────────────────────────────────
    // uvd = uv * length(uv) is Musk's key trick: it smears each pixel
    // toward the opposite side of frame, projecting ghost artefacts
    // along the axis that passes through the light source.
    // All coords here are in aspect-corrected screen space centred at origin.
    // asp already declared above in lensFlare()
    let sun_ac = (SUN_POS - 0.5) * asp;               // sun in aspect-corrected [-0.5..0.5] space
    let uv_ac  = (uv - 0.5) * asp;                    // pixel in same space
    let uvd    = uv_ac * length(uv_ac);               // Musk distortion

    // Tier 1 — tight bright circles closest to sun on the axis
    let f2  = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.80 * sun_ac), 2.0)), 0.0) * 0.25;
    let f22 = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.85 * sun_ac), 2.0)), 0.0) * 0.23;
    let f23 = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.90 * sun_ac), 2.0)), 0.0) * 0.21;

    // Tier 2 — medium bokeh blobs, softer, further along axis
    let uvx1 = mix(uv_ac, uvd, -0.5);
    let f4   = max(0.01 - pow(length(uvx1 + 0.40 * sun_ac), 2.4), 0.0) * 6.0;
    let f42  = max(0.01 - pow(length(uvx1 + 0.45 * sun_ac), 2.4), 0.0) * 5.0;
    let f43  = max(0.01 - pow(length(uvx1 + 0.50 * sun_ac), 2.4), 0.0) * 3.0;

    // Tier 3 — small sharp pips on opposite side of centre from sun
    let uvx2 = mix(uv_ac, uvd, -0.4);
    let f5   = max(0.01 - pow(length(uvx2 + 0.20 * sun_ac), 5.5), 0.0) * 2.0;
    let f52  = max(0.01 - pow(length(uvx2 + 0.40 * sun_ac), 5.5), 0.0) * 2.0;
    let f53  = max(0.01 - pow(length(uvx2 + 0.60 * sun_ac), 5.5), 0.0) * 2.0;

    // Tier 4 — large soft arcs near far side
    let uvx3 = mix(uv_ac, uvd, -0.5);
    let f6   = max(0.01 - pow(length(uvx3 - 0.30 * sun_ac), 1.6), 0.0) * 6.0;
    let f62  = max(0.01 - pow(length(uvx3 - 0.325 * sun_ac), 1.6), 0.0) * 3.0;
    let f63  = max(0.01 - pow(length(uvx3 - 0.35 * sun_ac), 1.6), 0.0) * 5.0;

    // RGB-split gives prismatic colour fringing across the chain
    let musk_r = f2  + f4  + f5  + f6;
    let musk_g = f22 + f42 + f52 + f62;
    let musk_b = f23 + f43 + f53 + f63;
    let musk   = vec3f(musk_r, musk_g, musk_b) * 0.6;

    let out    = rings + chromaSpoke + musk;
    return clamp(out * strength, vec3f(0.0), vec3f(1.0));
}

// ── Gravitational drain — singularity strength ───────────────────
fn gravitationalDrainUV(uv: vec2f, warp: f32) -> vec2f {
    let centre = vec2f(0.5, 0.5);
    let d   = (uv - centre) * vec2f(16.0/9.0, 1.0);
    let r   = length(d);
    let eps = mix(0.25, 0.001, warp);
    let pull = warp * warp / (r + eps);
    let angle = warp * TAU * 2.0 * max(0.0, 1.0 - r * 0.8);
    let cosA  = cos(angle); let sinA = sin(angle);
    let rotD  = vec2f(cosA * d.x - sinA * d.y, sinA * d.x + cosA * d.y);
    let warped = centre + (rotD * max(0.0, 1.0 - pull)) / vec2f(16.0/9.0, 1.0);
    return clamp(warped, vec2f(0.001), vec2f(0.999));
}


fn rotate(a: f32) -> mat2x2<f32> {
    let s = sin(a);
    let c = cos(a);
    return mat2x2<f32>(c, s, -s, c);
}

fn path(v: f32) -> vec3<f32> {
    return vec3<f32>(
        cos(v * 0.2 + sin(v * 0.1) * 2.0) * 3.0,
        sin(v * 0.2 + cos(v * 0.3)) * 3.0,
        v
    );
}

fn hash33(p3_in: vec3<f32>) -> vec3<f32> {
    var p3 = fract(p3_in * vec3<f32>(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}

fn hash13(p3: vec3<f32>) -> f32 {
    return fract(dot(p3, cos(p3.yzx)));
}

fn hash12(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn fbm(p: vec3<f32>) -> f32 {
    var amp: f32 = 1.0;
    var fre: f32 = 1.0;
    var n: f32 = 0.0;
    for (var i: f32 = 0.0; i < 5.0; i += 1.0) {
        n += amp * abs(dot(cos(p * fre), vec3<f32>(0.06)));
        amp *= 0.5;
        fre *= 2.0;
    }
    return n;
}

fn checkFlag(flags: f32, bit: u32) -> bool {
    let f = u32(flags);
    return (f & (1u << bit)) != 0u;
}

fn getFlag(flags: f32, bit: u32) -> f32 {
    if checkFlag(flags, bit) { return 1.0; }
    return 0.0;
}