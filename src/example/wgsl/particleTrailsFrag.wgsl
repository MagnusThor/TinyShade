  @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let dots = textureSample(particles, samp, in.uv).rgb;
            let oldTrails = textureSample(particleTrails, samp, in.uv).rgb;
            let fade = oldTrails * 0.2;
            return vec4f(dots + fade, 1.0);
}   