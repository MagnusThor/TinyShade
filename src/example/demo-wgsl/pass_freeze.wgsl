@fragment fn main(in: VSOut) -> @location(0) vec4f {
    let live   = textureSample(pass_rt, samp, in.uv).rgb;
    let frozen = textureSample(prev_pass_freeze, samp, in.uv);

    // freezeActive == 0  → normal playback: keep writing the live frame in.
    //                       A tiny blend toward the previous freeze output
    //                       prevents a 1-frame flash on the very first tick.
    // freezeActive == 1  → hold the last captured frame; stop updating.
    if (u.freezeActive > 0.5) {
        // Return the last captured image unchanged (hold freeze).
        return frozen;
    }

    // Capture mode: output the live frame so it accumulates into prev_pass_freeze.
    // The 0.05 blend with any existing frozen data smooths the very first
    // activation frame in case the frozen texture still has stale content.
    let blended = mix(live, frozen.rgb, 0.05 * frozen.a);
    return vec4f(blended, 1.0);
}
