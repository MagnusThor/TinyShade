@fragment fn main(in: VSOut) -> @location(0) vec4f {
        let frozen = textureSample(prev_pass_freeze, samp, in.uv);
        if (u.freezeActive > 0.5) { return frozen; }
        let live = textureSample(pass_rt, samp, in.uv).rgb;
        return vec4f(mix(live, frozen.rgb, 0.05), 1.0);
}