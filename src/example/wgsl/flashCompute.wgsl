@compute @workgroup_size(1)
fn main() {
    let flash_period = 15.0;
    let flash_time = u.time % flash_period;
    
    // Calculate the spike
    let envelope = smoothstep(0.0, 0.05, flash_time) * smoothstep(0.8, 0.1, flash_time);
    let flicker = sin(u.time * 60.0) * 0.15 + 0.85;
    
    // Result: 0.0 to 2.5
    let brightness = envelope * flicker * 2.5;
    
    // Store in a single float buffer
    data[0] = brightness;
}