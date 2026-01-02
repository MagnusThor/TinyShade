
export const THE_ROCK_ACTION_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

// --- UTILITIES ---

fn softClip(x: f32) -> f32 {
    return x / (1.0 + abs(x));
}

// Heavy distortion for that "90s Action" grit
fn drive(x: f32, gain: f32) -> f32 {
    return tanh(x * gain);
}

// --- INSTRUMENTS ---

// The "Gallop" - Bass with a 16th note rhythm (DA-da-da DA-da-da)
fn gallopBass(t: f32, f: f32) -> f32 {
    let rhythm = array<f32, 4>(1.0, 0.6, 0.7, 0.6);
    let step = i32(t * 8.0) % 4; // 8th note pulse
    let env = exp(-15.0 * (t % 0.125));
    
    let osc = sin(2.0 * PI * f * t) + 0.2 * sin(2.0 * PI * f * 2.0 * t);
    return osc * env * rhythm[step];
}

// Heavy Industrial Drum (The Rock signature)
fn rockDrum(t: f32) -> f32 {
    let beat_t = t % 0.5; // Double time beat
    let env = exp(-20.0 * beat_t);
    
    // Low punch
    let punch = sin(2.0 * PI * 60.0 * beat_t - 5.0 * env) * env;
    // Metallic noise hit (Gated Reverb feel)
    let noise = fract(sin(beat_t * 12345.67)) * 2.0 - 1.0;
    let gated_noise = noise * exp(-30.0 * beat_t) * 0.3;
    
    return (punch * 1.5 + gated_noise);
}

// Heroic Brass (Minor Chord Stabs)
fn heroicBrass(t: f32, f: f32, intensity: f32) -> f32 {
    var brass = sin(2.0 * PI * f * t) * 1.0;
    brass += sin(2.0 * PI * f * 1.5 * t) * 0.5; // Perfect fifth
    brass += sin(2.0 * PI * f * 2.0 * t) * 0.4; // Octave
    
    return drive(brass * intensity, 2.0) * 0.3;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    var mix: f32 = 0.0;

    // 1. THE ACTION DRUMS (High priority)
    // Heavy hits on 1 and 3
    mix += rockDrum(t) * 1.2;

    // 2. THE DRIVING BASS (D minor feel)
    let bassFreq = 36.71; // Low D
    mix += gallopBass(t, bassFreq) * 0.6;

    // 3. THE BRASS STABS (Every 4 seconds)
    // Classic Dm -> Bb -> C progression
    let chord_time = i32(t / 2.0) % 4;
    var notes = array<f32, 4>(38.0, 34.0, 36.0, 38.0); // D, Bb, C, D
    let freq = pow(2.0, (notes[chord_time] - 69.0) / 12.0) * 440.0;
    
    let brass_env = adsr(t % 2.0, vec4f(0.05, 0.1, 0.6, 0.5), 0.0, 0.8);
    mix += heroicBrass(t, freq, brass_env);

    // 4. HI-HAT "TICK" (16th notes for speed)
    let hihat = (fract(sin(t * 9999.9)) * 2.0 - 1.0) * exp(-150.0 * (t % 0.125)) * 0.05;
    mix += hihat;

    // Final Action Mastering
    mix = softClip(mix * 1.3);
    
    output[idx] = clamp(mix, -0.9, 0.9);
}

fn adsr(t_abs: f32, env: vec4f, start: f32, duration: f32) -> f32 {
    let t = t_abs - start;
    if (t < 0.0 || t > duration + env.w) { return 0.0; }
    if (t <= env.x) { return smoothstep(0.0, env.x, t); }
    if (t <= env.x + env.y) { return mix(1.0, env.z, (t - env.x) / env.y); }
    if (t <= duration) { return env.z; }
    return mix(env.z, 0.0, (t - duration) / env.w);
}
`;
