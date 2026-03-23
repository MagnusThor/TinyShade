@fragment fn main(in: VSOut) -> @location(0) vec4f {
  

            let dots = textureSample(computeTex1, samp, in.uv).rgb;
        let oldTrails = textureSample(prev_pass_particles, samp, in.uv).rgb;
        let fade = oldTrails * 0.4;
        return vec4f(dots + fade, 1.0);

}