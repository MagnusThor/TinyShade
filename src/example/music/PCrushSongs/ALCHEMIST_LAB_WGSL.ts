export const ALCHEMIST_LAB_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

// --- MECHANICAL COMPONENTS ---

// Precise brass "Tick"
fn gearTick(t: f32, pitch: f32) -> f32 {
    let decay = exp(-150.0 * t);
    return sin(2.0 * PI * pitch * t) * decay;
}

// Resonant "Ping" (Metal hitting metal)
fn metalPing(t: f32, f: f32) -> f32 {
    let decay = exp(-12.0 * t);
    // Add metallic inharmonics
    var s = sin(2.0 * PI * f * t);
    s += sin(2.0 * PI * f * 2.57 * t) * 0.4;
    s += sin(2.0 * PI * f * 4.12 * t) * 0.2;
    return s * decay;
}

// Steampipe "Hiss"
fn steamHiss(t: f32) -> f32 {
    let noise = fract(sin(t * 123.456) * 789.123) * 2.0 - 1.0;
    let envelope = sin(t * 0.5) * 0.5 + 0.5; // Slow breathing hiss
    return noise * 0.05 * pow(envelope, 4.0);
}

// Deep Hydraulic Heartbeat
fn hydraulicBass(t: f32, f: f32) -> f32 {
    let pulse = t % 1.0;
    let env = exp(-4.0 * pulse);
    // Square-ish wave for "industrial" feel
    let osc = sign(sin(2.0 * PI * f * t));
    return osc * env * 0.3;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    var final_mix: f32 = 0.0;

    // 1. THE MAIN HEARTBEAT (120 BPM)
    let beat_t = t % 0.5;
    final_mix += hydraulicBass(t, 40.0) * 0.8;

    // 2. THE GEARS (Poly-rhythmic Ticking)
    let tick_fast = t % 0.125; // 16th notes
    let tick_med = t % 0.25;   // 8th notes
    final_mix += gearTick(tick_fast, 3000.0) * 0.1;
    final_mix += gearTick(tick_med, 1500.0) * 0.05;

    // 3. THE MELODIC PING (A small brass bell melody)
    let mel_time = i32(t * 2.0) % 8;
    let notes = array<f32, 8>(72.0, 0.0, 75.0, 77.0, 0.0, 80.0, 79.0, 0.0); // C, Eb, F, Ab, G
    if (notes[mel_time] > 0.0) {
        let note_t = t % 0.5;
        let freq = pow(2.0, (notes[mel_time] - 69.0) / 12.0) * 440.0;
        final_mix += metalPing(note_t, freq) * 0.15;
    }

    // 4. ATMOSPHERE (Steam & Hiss)
    final_mix += steamHiss(t);

    // 5. THE "PRESSURE" (Low drone)
    final_mix += sin(2.0 * PI * 60.0 * t + sin(t * 2.0)) * 0.1;

    // Soft clipping
    final_mix = final_mix / (1.0 + abs(final_mix));
    
    output[idx] = clamp(final_mix, -0.9, 0.9);
}
`;

