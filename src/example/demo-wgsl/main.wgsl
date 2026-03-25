@fragment
fn main(in: VSOut) -> @location(0) vec4f {

    let fuv = vec2f(in.uv.x, 1.0 - in.uv.y);

   

    if (u.sceneId >= 8.0) {
        let p = u.progress;

        let bhFade = select(
        select(
            1.0,
            smoothstep(0.0, 1.0, (1.0 - p) / 0.25),
            p > 0.75
        ),
        smoothstep(0.0, 1.0, p / 0.08),
        p < 0.08
    );
        let bhScale = 0.55 + 0.10 * sin(u.time * 0.18);   // gentle breath
        let bh_uv   = (fuv - 0.5) / bhScale + 0.5;
        var bh_col  = vec3f(0.0);
        if (bh_uv.x > 0.0 && bh_uv.x < 1.0 && bh_uv.y > 0.0 && bh_uv.y < 1.0) {
            bh_col = blackHole(bh_uv, u.time, u.bhPulse) * bhFade;
        }

        let sun = distantSun(fuv, u.time, u.bhPulse * 0.3);

        let flare = lensFlare(fuv, u.time, u.audioLow, 0.6);

        var col = bh_col + sun + flare;

        col = mix(col, filmic(col), 0.5);
        col = clamp(col, vec3f(0.0), vec3f(1.0));

        {
            let cx0 = 1.0 - u.cornerFracW - u.cornerMarginX;
            let cy0 = 1.0 - u.cornerFracH - u.cornerMarginY;
            let cx1 = cx0 + u.cornerFracW;
            let cy1 = cy0 + u.cornerFracH;
            let mask = step(cx0, fuv.x) * step(fuv.x, cx1) *
                       step(cy0, fuv.y) * step(fuv.y, cy1);
            let cuv = vec2f(
                (fuv.x - cx0) / u.cornerFracW,
                1.0 - (fuv.y - cy0) / u.cornerFracH
            );
            let ctx = textureSample(corner, samp, cuv);
            col = mix(col, ctx.rgb + bh_col * 0.15, ctx.a * u.cornerAlpha * mask);
        }

        if (u.overlayAlpha > 0.01) {
            let tx = textureSample(overlay, samp, in.uv);
            col = mix(col, tx.rgb, tx.a * u.overlayAlpha);
        }

        return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
    }

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

    // Exposure + tonemap
    col *= u.exposure;
    col  = col + 0.15 * col * col;
    if (u.showFilmic > 0.05) {
        let film = filmic(col);
        col = mix(col, film, 0.65 * u.showFilmic);
    }
    col = pow(max(col, vec3f(0.0)), vec3f(0.85));
    let luma = dot(col, vec3f(0.299, 0.587, 0.114));
    col = mix(vec3f(luma), col, 1.15);

    // Depth / sky mask
    let depth   = textureSample(computeTex0, samp, in.uv).a;
    let skyMask = smoothstep(0.75, 1.0, depth);

    // Distant sun visible at scene 1 & 2
    if (u.sceneId <= 2.0) {
        let sun = distantSun(fuv, u.time, u.bhPulse * 0.4);
        col += sun * skyMask;

        // Lens flare (scenes 1 & 2)
        let isS1 = step(0.5, 1.0 - abs(u.sceneId - 1.0));
        let isS2 = step(0.5, 1.0 - abs(u.sceneId - 2.0));
        let flareStr = isS1 * smoothstep(0.0, 0.25, u.progress)
                    + isS2 * smoothstep(1.0, 0.75, u.progress);
        if (flareStr > 0.005) {
            let flare     = lensFlare(fuv, u.time, u.audioLow, flareStr * 0.75);
            let flareMask = mix(skyMask, 1.0, 0.35);
            col += flare * flareMask;
        }

    }

    // Particles
    if (u.showParticles > 0.05) {
        let p = textureSample(pass_particles, samp, fuv).rgb;
        col += p * 0.6;
    }

    // Black hole (scene 7)
    if (u.showBlackHole > 0.01) {
        let bh = blackHole(fuv, u.time, u.bhPulse);
        col = mix(col, col + bh, u.showBlackHole);
    }

    // Vignette
    if (u.showVignette > 0.5) {
        let uvc = fuv - 0.5;
        let vig = clamp(1.0 - dot(uvc, uvc) * 1.4, 0.0, 1.0);
        col *= mix(1.0, vig, 0.6);
    }

    if (u.sceneId != 1.0 && u.overlayAlpha > 0.01) {
        let tx = textureSample(overlay, samp, in.uv);
        col = mix(col, tx.rgb, tx.a * u.overlayAlpha);
    }

    {
        let cx0 = 1.0 - u.cornerFracW - u.cornerMarginX;
        let cy0 = 1.0 - u.cornerFracH - u.cornerMarginY;
        let cx1 = cx0 + u.cornerFracW;
        let cy1 = cy0 + u.cornerFracH;
        let mask = step(cx0, fuv.x) * step(fuv.x, cx1) *
                   step(fuv.x, cx1) * step(cy0, fuv.y) * step(fuv.y, cy1);
        let cuv = vec2f(
            (fuv.x - cx0) / u.cornerFracW,
            1.0 - (fuv.y - cy0) / u.cornerFracH
        );
        let ctx = textureSample(corner, samp, cuv);
        col = mix(col, ctx.rgb, ctx.a * u.cornerAlpha * mask);
    }

    col = clamp(col, vec3f(0.0), vec3f(1.0));
    return vec4f(col, 1.0);
}
