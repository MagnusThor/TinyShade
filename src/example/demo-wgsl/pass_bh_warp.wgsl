@fragment fn main(in: VSOut) -> @location(0) vec4f {

    if (u.sceneId < 7.0) {
        return vec4f(0.0); 
    }

    let fuv  = vec2f(in.uv.x, 1.0 - in.uv.y);
    let warp = u.bhWarp;

    // ── Scene 8 (credits): pure black so blackHole() in main.wgsl
    //    is the only thing visible. No frozen world, no warp artefacts.
    if (u.sceneId >= 8.0) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    // ── No warp yet — pass the frozen frame straight through.
    if (warp < 0.003) {
        return textureSample(pass_freeze, samp, in.uv);
    }

    // ── Gravitational drain — suck the frozen image into the centre.
    let src_uv  = gravitationalDrainUV(fuv, warp);
    let samp_uv = vec2f(src_uv.x, 1.0 - src_uv.y);
    var col     = textureSample(pass_freeze, samp, samp_uv).rgb;

    // ── Event horizon — black disc that grows with warp.
    //    Pixels inside it go dark so the BH ring can paint over them.
    let centre    = vec2f(0.5, 0.5);
    let d_uv      = (fuv - centre) * vec2f(16.0 / 9.0, 1.0);
    let r_sc      = length(d_uv);
    let horizon_r = 0.08 + warp * warp * 1.2;
    let disc      = 1.0 - smoothstep(horizon_r * 0.7, horizon_r, r_sc);
    col          *= (1.0 - disc);

    // ── Dim the whole frame as warp climbs toward 1.
    //    At warp=1 the frozen world is nearly invisible — the BH owns the screen.
    col *= (1.0 - warp * 0.85);

    return vec4f(col, 1.0);
}
