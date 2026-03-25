@fragment
fn main(in: VSOut) -> @location(0) vec4f {

    let uv = in.uv;

    let texel = 1.0 / u.resolution.xy;

    // center
    let c = textureSample(computeTex1, samp, uv).rgb;

    // small glow kernel (5 taps)
    let glow =
        textureSample(computeTex1, samp, uv + vec2f(texel.x, 0.0)).rgb +
        textureSample(computeTex1, samp, uv - vec2f(texel.x, 0.0)).rgb +
        textureSample(computeTex1, samp, uv + vec2f(0.0, texel.y)).rgb +
        textureSample(computeTex1, samp, uv - vec2f(0.0, texel.y)).rgb;

    let dots = c * 1.5 + glow * 0.6;

    // trails
    let oldTrails = textureSample(prev_pass_particles, samp, uv).rgb;
    let fade = oldTrails * 0.5;

    // neon boost
    let neon = pow(dots, vec3f(0.7)) * 1.2;

    return vec4f(neon + fade, 1.0);
}