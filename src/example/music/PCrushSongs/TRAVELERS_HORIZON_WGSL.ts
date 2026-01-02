export const TRAVELERS_HORIZON_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

// Massive Brass "Bwaaa" with harmonic grit
fn zimmerBrass(t: f32, f: f32, intensity: f32) -> f32 {
    var brass = sin(2.0 * PI * f * t) * 1.0;
    brass += sin(2.0 * PI * f * 2.0 * t) * 0.5;
    brass += sin(2.0 * PI * f * 3.0 * t) * 0.3;
    let growl = sin(2.0 * PI * 12.0 * t) * 0.2 * intensity;
    return (tanh((brass + growl) * 4.0 * intensity));
}

// Cathedral Bell (High-quality FM)
fn churchBell(t: f32, f: f32) -> f32 {
    let env = exp(-1.5 * t);
    let md = sin(2.0 * PI * f * 2.51 * t) * 4.0 * env; // Inharmonic multiplier
    return sin(2.0 * PI * f * t + md) * env;
}

// Heavy Industrial Drum
fn warDrum(t: f32) -> f32 {
    let env = exp(-15.0 * t);
    let pitch_env = exp(-25.0 * t);
    return sin(2.0 * PI * (45.0 + 120.0 * pitch_env) * t) * env;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    let timeline = (t % 90.0) / 90.0;
    var output_signal: f32 = 0.0; // RENAMED to avoid mix() conflict

    // 1. THE CLOCK (Ticking - Constant but swells)
    let tick = (fract(sin(t * 8000.0)) * 0.03) * exp(-120.0 * (t % 0.5));
    output_signal += tick;

    // 2. THE SUB DRONE (D-Minor Root)
    let sub = sin(2.0 * PI * 36.7 * t) * 0.4 * smoothstep(0.0, 0.2, timeline);
    output_signal += sub;

    // 3. INDUSTRIAL DRUMS (Starts at 30s)
    let beat_active = smoothstep(0.3, 0.4, timeline);
    let beat_t = t % 1.0;
    // Classic 4/4 Zimmer stomp
    if (beat_t < 0.2 || (beat_t > 0.5 && beat_t < 0.7)) {
        output_signal += warDrum(beat_t % 0.5) * 0.8 * beat_active;
    }

    // 4. CATHEDRAL BELLS (Melancholy Melody - Starts at 45s)
    let bell_active = smoothstep(0.5, 0.6, timeline);
    let bell_cycle = t % 12.0;
    let bell_notes = array<f32, 4>(220.0, 196.0, 174.6, 164.8); // A, G, F, E
    let current_bell = i32(bell_cycle / 3.0) % 4;
    
    output_signal += churchBell(bell_cycle % 3.0, bell_notes[current_bell]) * 0.2 * bell_active;

    // 5. THE BRASS "BWAAA" (Climax - Starts at 60s)
    let brass_active = smoothstep(0.66, 0.75, timeline);
    let brass_cycle = t % 10.0;
    
    // Switch between D (36Hz) and Bb (29Hz)
    var f = 36.71; 
    if (brass_cycle > 5.0) { f = 29.14; }
    
    if (brass_cycle < 4.0 || (brass_cycle > 5.0 && brass_cycle < 9.0)) {
        let b_env = smoothstep(0.0, 1.2, brass_cycle % 5.0) * (1.0 - smoothstep(3.0, 4.0, brass_cycle % 5.0));
        output_signal += zimmerBrass(t, f, b_env * brass_active) * 0.5;
    }

    // --- MASTERING ---
    let master_fade = 1.0 - smoothstep(0.93, 1.0, timeline);
    
    // The "Zimmer Wall" - High saturation
    output_signal = tanh(output_signal * 1.6) * master_fade;

    // Stereo Panning (Now correctly using the built-in mix function)
    let panner = mix(0.85, 1.15, u.channel);
    output[idx] = clamp(output_signal * panner, -0.98, 0.98);
}
`;