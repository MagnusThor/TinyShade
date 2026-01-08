@fragment fn main(in: VSOut) -> @location(0) vec4f {
    let res = u.resolution.xy;
    let idx = u32(in.uv.y * res.y) * u32(res.x) + u32(in.uv.x * res.x);
    let val = f32(atomicLoad(&volcano_map_data[idx]));
    
    var explosion = vec3f(0.0);
    if (val > 0.0) {
        let heat = saturate(val * 0.1);
        explosion = mix(vec3f(1.0, 0.2, 0.0), vec3f(1.0, 0.8, 0.3), heat) * heat * 5.0;
    }

    // THE TRAIL (Rising heat and falling debris)
    let history = textureSample(prev_volcanoFrag, samp, in.uv).rgb;
    
    // This creates the "fade" and "upward drift" of the eruption smoke
    let trail = textureSample(prev_volcanoFrag, samp, in.uv + vec2f(0.0, 0.003)).rgb;

    // Mix them: Current explosion + persistent trail
    let final_col = explosion + (trail * 0.96);

    return vec4f(final_col, 1.0);
}