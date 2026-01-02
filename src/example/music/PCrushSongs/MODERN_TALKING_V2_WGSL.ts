
export const MODERN_TALKING_V2_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

// --- 80s FM BELL (The "DX7" Secret) ---
fn fmBell(t: f32, f: f32, intensity: f32) -> f32 {
    let env = exp(-6.0 * t); // Fast decay
    // The modulator runs at a multiple of the carrier frequency
    let modulator = sin(2.0 * PI * f * 3.5 * t) * (10.0 * env); 
    let carrier = sin(2.0 * PI * f * t + modulator);
    
    return carrier * env * intensity;
}

// --- SNAPPY 80s DRUMS ---
fn discoDrums(t: f32) -> f32 {
    let beat_t = t % 0.5;
    
    // Solid Kick
    let kick = sin(2.0 * PI * 55.0 * beat_t - 8.0 * exp(-15.0 * beat_t)) * exp(-12.0 * beat_t);
    
    // Snare on the "2" and "4" - White noise with a punchy start
    let snare_cycle = (t + 0.5) % 1.0;
    let snare_noise = (fract(sin(snare_cycle * 1234.56)) * 2.0 - 1.0) * exp(-20.0 * snare_cycle);
    let snare_snap = sin(2.0 * PI * 180.0 * snare_cycle) * exp(-40.0 * snare_cycle);
    
    // The "Off-beat" Open Hat (Essential for disco)
    let hat_t = (t + 0.25) % 0.5;
    let hat = (fract(sin(hat_t * 9999.9)) * 0.4) * exp(-50.0 * hat_t);
    
    return kick + (snare_noise + snare_snap) * 0.5 + hat;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    var mix: f32 = 0.0;

    // 1. DRUMS
    mix += discoDrums(t) * 0.8;

    // 2. THE FM BELL MELODY
    // Simple 80s "D-C-G-A" pattern
    let mel_time = t % 4.0;
    let mel_step = i32(t * 2.0) % 8;
    let mel_notes = array<f32, 8>(74.0, 0.0, 72.0, 0.0, 67.0, 69.0, 71.0, 0.0);
    
    if (mel_notes[mel_step] > 0.0) {
        let note_t = t % 0.5;
        let freq = pow(2.0, (mel_notes[mel_step] - 69.0) / 12.0) * 440.0;
        mix += fmBell(note_t, freq, 0.3);
    }

    // 3. THE BASS (Octave jump)
    let bass_cycle = i32(t / 2.0) % 4;
    let root_notes = array<f32, 4>(38.0, 34.0, 36.0, 31.0); // Dm, Bb, C, G
    let is_octave = i32(t * 4.0) % 2 == 1;
    var note = root_notes[bass_cycle];
    if (is_octave) { note += 12.0; }
    
    let b_freq = pow(2.0, (note - 69.0) / 12.0) * 440.0;
    let bass_env = exp(-12.0 * (t % 0.25));
    mix += (sin(2.0 * PI * b_freq * t) + 0.5 * sign(sin(2.0 * PI * b_freq * t))) * 0.3 * bass_env;

    output[idx] = clamp(mix * 0.7, -0.9, 0.9);
}
`;
