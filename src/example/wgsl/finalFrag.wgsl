@fragment 
fn main(in: VSOut) -> @location(0) vec4f {
    let uv = in.uv;
    let r = u.resolution.xy;

    let world_tex = textureSample(world, samp, uv).rgb;
    let particle_trails = textureSample(particleTrails, samp, uv).rgb;
    let meteor_tex = textureSample(meteors, samp, uv).rgb;

    let ripple = sin(uv.x * 25.0 + u.time * 2.0) * 0.003;
    let reflected_uv = vec2f(uv.x + ripple, 1.0 - uv.y);
    
    let refl_trails = textureSample(particleTrails, samp, reflected_uv).rgb;
    let refl_meteors = textureSample(meteors, samp, reflected_uv).rgb;
    
    let water_mask = smoothstep(0.46, 0.44, uv.y); 
    let water_tint = vec3f(0.02, 0.05, 0.1); 
    let reflections = (refl_trails + refl_meteors) * vec3f(0.4, 0.6, 1.0);

    var color = world_tex + particle_trails;
    
    color = mix(color, color * 0.5 + reflections + water_tint, water_mask);

    let tint_color = hsv2rgb(vec3f(0.3, 0.7, 0.2)); 
    let vignette_mask = length(-1.0 + 2.0 * uv);
    color = color - (vignette_mask + 0.2) * tint_color;

    color = tanh_approx(color);

    color += meteor_tex;

    let final_vignette = smoothstep(1.6, 0.5, vignette_mask);
    color *= final_vignette;

    return vec4f(max(color, vec3f(0.0)), 1.0);
}