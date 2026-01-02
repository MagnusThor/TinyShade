
export const THE_SHORES_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

// --- NATURAL ELEMENTS ---

// Generates organic noise for the waves
fn waveNoise(t: f32) -> f32 {
    return fract(sin(t * 12.9898) * 43758.5453) * 2.0 - 1.0;
}

// Low-frequency baseline (warm and round)
fn shoreBass(t: f32, f: f32) -> f32 {
    // Pure sine with a tiny bit of 2nd harmonic for "warmth"
    let osc = sin(2.0 * PI * f * t) + 0.1 * sin(2.0 * PI * f * 2.0 * t);
    return osc * 0.4;
}

// Distant Boat Horn (Deep, resonant, slightly distorted)
fn boatHorn(t: f32, f: f32, intensity: f32) -> f32 {
    // Stacking a fundamental and a fifth (3:2 ratio) for that classic horn chord
    var horn = sin(2.0 * PI * f * t) * 1.0;
    horn += sin(2.0 * PI * (f * 1.498) * t) * 0.5; 
    horn += sin(2.0 * PI * (f * 2.0) * t) * 0.3;
    
    // Saturation makes it feel like it's traveling through air
    return tanh(horn * 2.0) * intensity;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    var final_mix: f32 = 0.0;

    // 1. THE OCEAN WAVES (6-second cycle)
    let wave_cycle = (t * (2.0 * PI / 6.0));
    let wave_env = pow(sin(wave_cycle) * 0.5 + 0.5, 3.0);
    // Modulate noise: Louder waves are "brighter" (more high-freq)
    let water = waveNoise(t) * wave_env * mix(0.05, 0.25, wave_env);
    final_mix += water;

    // 2. THE SLOW BEAT (Soft pulse every 2 seconds)
    let beat_t = t % 2.0;
    let beat_env = exp(-3.0 * beat_t);
    let kick = sin(2.0 * PI * 45.0 * beat_t - 2.0 * beat_env) * beat_env;
    final_mix += kick * 0.4;

    // 3. THE BASELINE (Deep E-flat)
    // Slowly oscillates volume with the waves
    let bass_swell = sin(wave_cycle) * 0.2 + 0.8;
    final_mix += shoreBass(t, 38.89) * 0.5 * bass_swell;

    // 4. THE BOAT HORNS (Occasional, distant)
    // Appears every 15 seconds
    let horn_cycle = t % 15.0;
    // Horn hits twice: a long blast and a short blast
    let horn_1 = smoothstep(2.0, 3.0, horn_cycle) * (1.0 - smoothstep(6.0, 8.0, horn_cycle));
    let horn_2 = smoothstep(9.0, 9.5, horn_cycle) * (1.0 - smoothstep(10.5, 11.0, horn_cycle));
    
    final_mix += boatHorn(t, 55.0, horn_1 * 0.15); // Low A-sharp
    final_mix += boatHorn(t, 55.0, horn_2 * 0.1);

    // Final Polish (Soft Limiter)
    final_mix = tanh(final_mix * 0.9);
    
    // Stereo Pan for the Waves
    let wave_pan = sin(t * 0.2) * 0.3;
    let side = mix(1.0 - wave_pan, 1.0 + wave_pan, u.channel);

    output[idx] = clamp(final_mix * side, -0.9, 0.9);
}
`;

