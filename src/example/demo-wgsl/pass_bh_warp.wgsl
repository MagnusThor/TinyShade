@fragment fn main(in: VSOut) -> @location(0) vec4f {
    let fuv  = vec2f(in.uv.x, 1.0 - in.uv.y);
    let warp = u.bhWarp;
    if (warp < 0.003) {
        return textureSample(pass_freeze, samp, in.uv);
    }
    let src_uv  = gravitationalDrainUV(fuv, warp);
    let samp_uv = vec2f(src_uv.x, 1.0 - src_uv.y);
    var col     = textureSample(pass_freeze, samp, samp_uv).rgb;
    let centre  = vec2f(0.5, 0.5);
    let d_uv    = (fuv - centre) * vec2f(16.0/9.0, 1.0);
    let r_sc    = length(d_uv);
    let redshift = warp * smoothstep(0.7, 0.0, r_sc) * 0.65;
    col = vec3f(
        col.r + redshift * (1.0 - col.r),
        col.g * (1.0 - redshift * 0.5),
        col.b * (1.0 - redshift * 0.85)
    );
    let horizon_r = 0.08 + warp * warp * 1.2;
    let disc      = 1.0 - smoothstep(horizon_r * 0.7, horizon_r, r_sc);
    
    //col *= (1.0 - disc);

    let rim = smoothstep(horizon_r, horizon_r + 0.05, r_sc);
    col += C_BH_RIM * rim * 0.4;
    
    return vec4f(col, 1.0);
}