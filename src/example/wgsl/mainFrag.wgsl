@fragment 
fn main(in: VSOut) -> @location(0) vec4f {
    let uv = in.uv;
    let center = vec2f(0.5, 0.5);

    // 1. QUICK READ (One value for the whole screen)
    let flash_strength = flash_data[0];

    // 2. SAMPLING (Minimal samples)
    let current = textureSample(fin, samp, uv).rgb;
    
    let zoom = 0.995; 
    let feedback_uv = (uv - center) * zoom + center;
    let previous = textureSample(prev_fin, samp, feedback_uv).rgb;

    var color = mix(current, previous, 0.2);

    // 3. SHIFT (Only calculate if flash is active to save GPU)
    var shift = 0.003 * length(uv - center);
    if (flash_strength > 0.01) {
        shift += flash_strength * 0.01 * length(uv - center);
    }
    
    let r = textureSample(fin, samp, uv + vec2f(shift, 0.0)).r;
    let b = textureSample(fin, samp, uv - vec2f(shift, 0.0)).b;
    color = vec3f(mix(color.r, r, 0.5), color.g, mix(color.b, b, 0.5));

    // 4. FLASH TINT (Simple math)
    // Strongest at top of screen (1.0 - uv.y)
    color += vec3f(0.4, 0.5, 0.6) * flash_strength * (1.0 - uv.y);
    color *= (1.0 + flash_strength * 0.2);

    // 5. POST-PROCESS
    let dist = length(uv - center);
    color *= smoothstep(1.0, 0.2, dist * 0.9);
    color = 1.0 - exp(-color * 1.5);
    color = pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.2)); 

    return vec4f(color, 1.0);
}