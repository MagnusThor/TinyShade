@fragment fn main(in: VSOut) -> @location(0) vec4f {
   let current = textureSample(computeTex0, samp, in.uv).rgb;
   let history = textureSample(prev_pass_rt, samp, in.uv).rgb;
   return vec4f(mix(current, history, 0.75), 1.0);
}
