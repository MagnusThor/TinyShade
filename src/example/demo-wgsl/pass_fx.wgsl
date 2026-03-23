@fragment fn main(in: VSOut) -> @location(0) vec4f {
    if (u.sceneId == 1.0) {
        let fade      = 1.0 - smoothstep(0.92, 1.0, u.progress);
        let zoom      = 1.0 + u.progress * 0.04 * fade + u.audioLow * 0.004 * fade;
        let zoom_uv   = (in.uv - 0.5) * zoom + 0.5;
        let shake_x   = (u.audioLow - u.audioMid)  * 0.004 * fade;
        let shake_y   = (u.audioMid - u.audioHigh) * 0.002 * fade;
        let suv       = zoom_uv + vec2f(shake_x, shake_y);
        let wide_band = floor(suv.y / 0.10);
        let wide_fft  = fftBin(clamp(wide_band * 6.0, 0.0, 60.0));
        let wide_sign = select(-1.0, 1.0, fract(wide_band * 0.618) > 0.5);
        let wide_off  = wide_fft * wide_sign * 0.022 * fade;
        let fine_band = floor(suv.y / 0.025);
        let fine_fft  = fftBin(clamp(50.0 + fract(fine_band * 0.381) * 40.0, 50.0, 90.0));
        let fine_sign = select(-1.0, 1.0, fract(fine_band * 1.618) > 0.5);
        let fine_off  = fine_fft * fine_sign * 0.005 * fade;
        let duv = vec2f(
            clamp(suv.x + wide_off + fine_off, 0.001, 0.999),
            clamp(suv.y, 0.001, 0.999)
        );
        var col = textureSample(pass_rt, samp, duv).rgb;
        if (u.overlayAlpha > 0.01) {
            let tx = textureSample(overlay, samp, vec2f(duv.x, 1.0 - duv.y));
            col = mix(col, tx.rgb, tx.a * u.overlayAlpha);
        }
        return vec4f(col, 1.0);
    }
    if (u.sceneId >= 7.0) {
        return textureSample(pass_bh_warp, samp, in.uv);
    }
    return textureSample(pass_rt, samp, in.uv);
}
