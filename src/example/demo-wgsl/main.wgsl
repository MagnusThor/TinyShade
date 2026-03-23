@fragment
fn main(in: VSOut) -> @location(0) vec4f {

    let fuv = vec2f(in.uv.x, 1.0 - in.uv.y);

    // --------------------------------------------------
    // Base color (with chroma)
    // --------------------------------------------------
    var col: vec3f;

    if (u.showChroma > 0.05) {
        let off = (0.0025 + 0.001 * sin(u.time * 0.7)) * u.showChroma;

        col = vec3f(
            textureSample(pass_fx, samp, vec2f(fuv.x + off, fuv.y)).r,
            textureSample(pass_fx, samp, fuv).g,
            textureSample(pass_fx, samp, vec2f(fuv.x - off, fuv.y)).b
        );
    } else {
        col = textureSample(pass_fx, samp, fuv).rgb;
    }

    // --------------------------------------------------
    // EXPOSURE + TONEMAP (FIXED PIPELINE)
    // --------------------------------------------------

    // Exposure first
    col *= u.exposure;

    // Restore highlights (prevents flat look)
    col = col + 0.15 * col * col;

    // Partial filmic (not destructive)
    if (u.showFilmic > 0.05) {
        let film = filmic(col);
        col = mix(col, film, 0.65 * u.showFilmic);
    }

    // Gamma lift (fix dark mids)
    col = pow(max(col, vec3f(0.0)), vec3f(0.85));

    // Slight saturation boost
    let luma = dot(col, vec3f(0.299, 0.587, 0.114));
    col = mix(vec3f(luma), col, 1.15);

    // --------------------------------------------------
    // DEPTH MASK (sky detection)
    // --------------------------------------------------
    let depth   = textureSample(computeTex0, samp, in.uv).a;
    let skyMask = smoothstep(0.75, 1.0, depth);

    // --------------------------------------------------
    // DISTANT SUN (additive, not multiplicative)
    // --------------------------------------------------
    let sun = distantSun(fuv, u.time, u.bhPulse * 0.4);
    col += sun * skyMask;

    // --------------------------------------------------
    // LENS FLARE
    // --------------------------------------------------
    let isS1     = step(0.5, 1.0 - abs(u.sceneId - 1.0));
    let isS2     = step(0.5, 1.0 - abs(u.sceneId - 2.0));

    let flareStr = isS1 * smoothstep(0.0, 0.25, u.progress)
                 + isS2 * smoothstep(1.0, 0.75, u.progress);

    if (flareStr > 0.005) {
        let flare     = lensFlare(fuv, u.time, u.audioLow, flareStr * 0.75);
        let flareMask = mix(skyMask, 1.0, 0.35);
        col += flare * flareMask;
    }

    // --------------------------------------------------
    // PARTICLES (additive)
    // --------------------------------------------------
    if (u.showParticles > 0.05) {
        let p = textureSample(pass_particles, samp, fuv).rgb;
        col += p * 0.6;
    }

    // --------------------------------------------------
    // BLACK HOLE (additive, not darkening)
    // --------------------------------------------------
    if (u.showBlackHole > 0.01) {
        let bh = blackHole(fuv, u.time, u.bhPulse);
        col = mix(col, col + bh, u.showBlackHole);
    }

    // --------------------------------------------------
    // VIGNETTE (softened)
    // --------------------------------------------------
    if (u.showVignette > 0.5) {
        let uvc = fuv - 0.5;
        let vig = clamp(1.0 - dot(uvc, uvc) * 1.4, 0.0, 1.0);
        col *= mix(1.0, vig, 0.6);
    }

    // --------------------------------------------------
    // OVERLAY
    // --------------------------------------------------
    if (u.sceneId != 1.0 && u.overlayAlpha > 0.01) {
        let tx = textureSample(overlay, samp, in.uv);
        col = mix(col, tx.rgb, tx.a * u.overlayAlpha);
    }

    // --------------------------------------------------
    // CORNER OVERLAY
    // --------------------------------------------------
    {
        let cx0 = 1.0 - u.cornerFracW - u.cornerMarginX;
        let cy0 = 1.0 - u.cornerFracH - u.cornerMarginY;
        let cx1 = cx0 + u.cornerFracW;
        let cy1 = cy0 + u.cornerFracH;

        let mask =
            step(cx0, fuv.x) * step(fuv.x, cx1) *
            step(cy0, fuv.y) * step(fuv.y, cy1);

        let cuv = vec2f(
            (fuv.x - cx0) / u.cornerFracW,
            1.0 - (fuv.y - cy0) / u.cornerFracH
        );

        let ctx = textureSample(corner, samp, cuv);
        col = mix(col, ctx.rgb, ctx.a * u.cornerAlpha * mask);
    }

    // --------------------------------------------------
    // FINAL CLAMP
    // --------------------------------------------------
    col = clamp(col, vec3f(0.0), vec3f(1.0));

    return vec4f(col, 1.0);
}