


export const DARKNESS_END_OF_TIME_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

// --- NATURAL TEXTURES ---

// Simulates the "grit" of a cello bow or wind
fn brownNoise(t: f32) -> f32 {
    return (fract(sin(t * 12.9898) * 43758.5453) * 2.0 - 1.0);
}

// Orchestral Strings approximation (Additive)
// Using slightly out-of-tune sines to create "ensemble" thickness
fn ensemble(t: f32, f: f32) -> f32 {
    var s = sin(2.0 * PI * f * t) * 1.0;
    s += sin(2.0 * PI * (f * 1.002) * t + 0.5) * 0.6;
    s += sin(2.0 * PI * (f * 0.998) * t + 1.2) * 0.6;
    s += sin(2.0 * PI * (f * 2.001) * t) * 0.3; // Harmonic air
    
    // Add "bow friction" using filtered noise
    let friction = brownNoise(t) * 0.02 * sin(t * 0.5);
    return s + friction;
}

// Gravity Wave (Low frequency interference)
fn gravityWave(t: f32, intensity: f32) -> f32 {
    // Two very low frequencies beating against each other
    let f1 = 30.0; 
    let f2 = 30.5 + sin(t * 0.1) * 0.5;
    return (sin(2.0 * PI * f1 * t) + sin(2.0 * PI * f2 * t)) * intensity;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    var final_mix: f32 = 0.0;

    // 1. THE VOID (Deep Sub Gravity)
    // A constant, breathing pressure
    let void_breath = sin(t * 0.2) * 0.5 + 0.5;
    final_mix += gravityWave(t, 0.4 * void_breath);

    // 2. THE DISTANT STRINGS (Orchestral "End of Time" Chord)
    // A dark, open chord (D - A - E)
    let notes = array<f32, 3>(26.16, 39.0, 41.2); // Very low frequencies
    let swell = sin(t * 0.15) * 0.5 + 0.5; // Very slow 10-second swells
    
    final_mix += ensemble(t, 73.42) * 0.15 * swell;  // Low D
    final_mix += ensemble(t, 110.0) * 0.12 * swell;  // A
    final_mix += ensemble(t, 164.8) * 0.08 * swell;  // E

    // 3. SINGING BOWL / EVENT HORIZON (Metallic shimmer)
    // High-pitched, resonant frequencies that "orbit"
    let orbit = sin(t * 0.1);
    let shimmer = sin(2.0 * PI * 880.0 * t + 5.0 * sin(t * 0.5)) * 0.01 * swell;
    final_mix += shimmer;

    // 4. THE "BLACK HOLE" COLLISION (Occasional deep thuds)
    // Happens every 12 seconds
    let collision_t = t % 12.0;
    let impact = exp(-0.5 * collision_t) * sin(2.0 * PI * 40.0 * collision_t) * 0.3;
    final_mix += impact;

    // --- SPATIAL PROCESSING ---
    // Make the sound "wider" by shifting phase slightly between channels
    let phase_shift = u.channel * 0.001; 
    
    // Soft saturation for a warm, analog feel
    final_mix = final_mix / (1.0 + abs(final_mix));
    
    output[idx] = clamp(final_mix, -0.9, 0.9);
}
`;

