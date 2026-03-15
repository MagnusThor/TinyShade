import { TinyShade } from "../TinyShade";

const start = async () => {
    const app = await TinyShade.create("canvas");

    (await app
        .setUniforms()

        // ============================================================
        // COMMON
        // ============================================================
        .addCommon(/* wgsl */`
const PI  : f32 = 3.14159265359;
const TAU : f32 = 6.28318530718;
const Dist: f32 = 1000.0;

/* ---------------- OKLAB (Shadertoy exact) ---------------- */
const OKLAB_LMS = mat3x3f(
    1.0,  1.0,  1.0,
    0.39633778, -0.10556135, -0.08948418,
    0.21580376, -0.06385417, -1.29148555
);

const OKLAB_RGB = mat3x3f(
    4.07674166, -1.26843800, -0.00419609,
   -3.30771159,  2.60975740, -0.70341861,
    0.23096993, -0.34131940,  1.70761470
);

fn oklabToLinear(c: vec3f) -> vec3f {
    let lms = OKLAB_LMS * c;
    return OKLAB_RGB * (lms * lms * lms);
}

/* ---------------- Hash ---------------- */
fn hash(x: f32) -> f32 {
    return fract(sin(x * 12.9898) * 43758.5453123);
}

fn hash22(x: f32) -> vec2f {
    return fract(sin(x * vec2f(12.9898, 78.233)) * 43758.5453123);
}

/* ---------------- Hemisphere ---------------- */
fn point_on_sphere(r: vec2f) -> vec3f {
    let a = vec2f(TAU * r.x, 2.0 * r.y - 1.0);
    return vec3f(
        sqrt(1.0 - a.y * a.y) * vec2f(cos(a.x), sin(a.x)),
        a.y
    );
}

fn uniform_lambert(r: vec2f, n: vec3f) -> vec3f {
    return normalize(n + point_on_sphere(r));
}

/* ---------------- Tonemap ---------------- */
fn aces_approx(v: vec3f) -> vec3f {
    let x = max(v, vec3f(0.0)) * 0.6;
    return clamp(
        (x * (2.51 * x + 0.03)) /
        (x * (2.43 * x + 0.59) + 0.14),
        vec3f(0.0),
        vec3f(1.0)
    );
}

fn sRGB(c: vec3f) -> vec3f {
    return mix(
        1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055,
        12.92 * c,
        step(c, vec3f(0.0031308))
    );
}

/* ---------------- Shadertoy NDC ---------------- */
fn shadertoyNDC(pos: vec2f) -> vec2f {
    let frag = vec2f(pos.x, u.resolution.y - pos.y);
    return (2.0 * frag - u.resolution.xy) / u.resolution.y;
}
`)

        // ============================================================
        // PASS A — SKY + MOUNTAINS
        // ============================================================
        .addPass("passA", /* wgsl */`
const ok_sky_lo_0 = vec3f(0.88, -0.43, -0.16);
const ok_sky_lo_1 = vec3f(1.17, -0.59, -0.18);
const ok_sky_lo_2 = vec3f(1.46, -0.77, -0.18);
const ok_sky_lo_3 = vec3f(1.72, -0.95, -0.14);
const ok_sky_lo_4 = vec3f(1.79, -1.02, -0.11);
const ok_sky_lo_5 = vec3f(1.80, -1.03, -0.09);
const ok_sky_lo_6 = vec3f(1.76, -1.02, -0.06);
const ok_sun      = vec3f(1.38, -0.81, -0.05);

fn simple_noise(p: vec2f) -> vec3f {
    let c = cos(p);
    let s = sin(p);
    return vec3f(s.x * s.y, c.x * s.y, s.x * c.y);
}

fn mountain(P: vec3f, H: f32) -> f32 {
    let R = mat2x2f(1.2, 1.6, -1.6, 1.2);
    var a = 1.0;
    var h = 0.0;
    var S = 0.0;
    var D = vec2f(0.0);
    var x = 2.0 * P.xz;

    for (var i = 0; i < 6; i++) {
        let N = simple_noise(x);
        D += N.yz;
        h += a * (1.0 + N.x) / (1.0 + 3.0 * dot(D, D));
        S += a;
        a *= 0.55;
        x = R * x;
    }

    return P.y - H * h / S;
}

fn get_sky(P: vec2f) -> vec3f {
    let y = 1.0 - P.y;

    var c0: vec3f;
    var c1: vec3f;
    var t: f32;

    if (y < 0.35)      { c0=ok_sky_lo_0; c1=ok_sky_lo_1; t=y/0.35; }
    else if (y < 0.65) { c0=ok_sky_lo_1; c1=ok_sky_lo_2; t=(y-0.35)/0.3; }
    else if (y < 0.775){ c0=ok_sky_lo_2; c1=ok_sky_lo_3; t=(y-0.65)/0.125; }
    else if (y < 0.835){ c0=ok_sky_lo_3; c1=ok_sky_lo_4; t=(y-0.775)/0.06; }
    else if (y < 0.935){ c0=ok_sky_lo_4; c1=ok_sky_lo_5; t=(y-0.835)/0.1; }
    else               { c0=ok_sky_lo_5; c1=ok_sky_lo_6; t=(y-0.935)/0.065; }

    let sun = ok_sun / (1.0 + 5.0 * dot(P - vec2f(-0.6,0.0), P - vec2f(-0.6,0.0)));
    return mix(c0, c1, t) + sun;
}

@fragment fn main(in: VSOut) -> @location(0) vec4f {
    let P = shadertoyNDC(in.uv);
    let sky = get_sky(P);
    var col = sky;

    let aa = sqrt(2.0) / u.resolution.y;

    for (var i = 0; i < 4; i++) {
        let fi = f32(i);
        let m = mountain(
            vec3f(P + vec2f(0.7 + 0.25*fi, 0.005*fi), 4.0 + fi),
            0.2 / (1.0 + 0.2*fi)
        );

        col = mix(
            col,
            sky * (0.8 - 0.2 * fi),
            smoothstep(aa, -aa, mix(0.25, 1.0, fi / 3.0) * m)
        );
    }

    return vec4f(col, 1.0);
}
`)

        // ============================================================
        // PASS B — REFLECTION + TEMPORAL
        // ============================================================
        .addPass("passB", /* wgsl */`
fn sampleA(p: vec2f) -> vec3f {
    return textureSampleLevel(
        passA, samp,
        p * 0.5 + 0.5,
        0.0
    ).rgb;
}

@fragment fn main(in: VSOut) -> @location(0) vec4f {
    let P = shadertoyNDC(in.pos.xy);

    let ro = vec3f(0.0, 1.0, -Dist);
    let la = vec3f(0.0, 1.0, 0.0);

    let cz = normalize(la - ro);
    let cx = normalize(cross(cz, vec3f(0.0,1.0,0.0)));
    let cy = cross(cx, cz);

    var col = vec3f(0.0);

    let rd = normalize(-P.x*cx + P.y*cy + 2.0*cz);
    col = sampleA((ro + rd*(-ro.z/rd.z)).xy);

    let prev = textureSampleLevel(prev_passB, samp, in.uv, 0.0).rgb;
    col = mix(col, prev, 0.707);

    return vec4f(col, 1.0);
}
`)

        // ============================================================
        // FINAL
        // ============================================================
        .main(/* wgsl */`
@fragment fn main(in: VSOut) -> @location(0) vec4f {
    var col = textureSampleLevel(passB, samp, in.uv, 0.0).rgb;
    col = oklabToLinear(col);
    col = aces_approx(col);
    col = sRGB(col);
    return vec4f(col, 1.0);
}
`)).run();




};

start();
