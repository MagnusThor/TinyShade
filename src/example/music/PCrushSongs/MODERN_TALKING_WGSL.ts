
export const MODERN_TALKING_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

// --- 80s DISCO DRUMS ---
fn discoDrum(t: f32) -> f32 {
    let beat_t = t % 0.5; // 120 BPM
    let kick = sin(2.0 * PI * 50.0 * beat_t - 10.0 * exp(-20.0 * beat_t)) * exp(-10.0 * beat_t);
    
    // Snare on the 2 and 4 (every 1.0s, offset by 0.5s)
    let snare_t = (t + 0.5) % 1.0;
    let snare_noise = (fract(sin(snare_t * 9876.54)) * 2.0 - 1.0) * exp(-15.0 * snare_t) * 0.4;
    
    // Bright Hi-hats on the "off-beat"
    let hat_t = (t + 0.25) % 0.5;
    let hat = (fract(sin(hat_t * 12345.67)) * 2.0 - 1.0) * exp(-100.0 * hat_t) * 0.1;
    
    return kick + snare_noise + hat;
}

// --- PUNCHY 80s BASS ---
fn euroBass(t: f32, f: f32) -> f32 {
    let env = exp(-8.0 * (t % 0.25)); // 16th note bounce
    // Mix of Saw and Square for that Juno-60 feel
    let osc = (2.0 * (t * f - floor(0.5 + t * f))) * 0.5 + (sign(sin(2.0 * PI * f * t))) * 0.2;
    return osc * env * 0.6;
}

// --- GLASSY CHORD SYNTH ---
fn glassySynth(t: f32, f: f32) -> f32 {
    let chorus = sin(t * 2.0) * 0.002;
    return sin(2.0 * PI * (f + chorus) * t) * 0.2;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    var mix: f32 = 0.0;

    // 1. THE BEAT
    mix += discoDrum(t);

    // 2. THE BASSLINE (Classic Disco Octave Jump)
    // Progression: C -> Bb -> F -> G (Common 80s pop)
    let cycle = i32(t / 2.0) % 4;
    let base_notes = array<f32, 4>(36.0, 34.0, 29.0, 31.0);
    let is_octave = i32(t * 4.0) % 2 == 1;
    var note = base_notes[cycle];
    if (is_octave) { note += 12.0; } // Jump up an octave on every other 8th note
    
    let freq = pow(2.0, (note - 69.0) / 12.0) * 440.0;
    mix += euroBass(t, freq) * 0.7;

    // 3. THE CHORDS (Minor 7th vibes)
    let chord_env = 0.1 + 0.1 * sin(t * PI);
    mix += glassySynth(t, freq * 1.5) * chord_env;
    mix += glassySynth(t, freq * 1.8) * chord_env;

    // Final output
    output[idx] = clamp(mix * 0.8, -0.9, 0.9);
}
`;




