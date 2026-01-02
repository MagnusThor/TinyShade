
export const INCEPTION_STORM_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

// A richer, buzzier wave for brass/strings
fn sawtooth(t: f32, f: f32) -> f32 {
    return 2.0 * (t * f - floor(0.5 + t * f));
}

fn adsr(t_abs: f32, env: vec4f, start: f32, duration: f32) -> f32 {
    let t = t_abs - start;
    if (t < 0.0 || t > duration + env.w) { return 0.0; }
    if (t <= env.x) { return smoothstep(0.0, env.x, t); }
    if (t <= env.x + env.y) { return mix(1.0, env.z, (t - env.x) / env.y); }
    if (t <= duration) { return env.z; }
    return mix(env.z, 0.0, (t - duration) / env.w);
}

fn powerSine(t: f32, f: f32, drive: f32) -> f32 {
    let s = sin(2.0 * PI * f * t);
    return tanh(s * drive);
}

fn bray(t: f32, f: f32, intensity: f32) -> f32 {
    // We build the sound by stacking harmonics (f, 2f, 3f...)
    // This sounds much "rounder" and more like an instrument
    var sound = 0.0;
    
    // Fundamental (The deep punch)
    sound += powerSine(t, f, 1.5) * 0.8;
    
    // 2nd Harmonic (Adds "body")
    sound += powerSine(t, f * 2.0, 1.2) * 0.4;
    
    // 3rd Harmonic (Adds the "brass" bite)
    // We modulate this one so it 'growls'
    let growl = sin(t * 15.0) * 0.1 + 0.9;
    sound += powerSine(t, f * 3.0, 2.0 * intensity) * 0.3 * growl;
    
    // 4th Harmonic (High end sizzle)
    sound += powerSine(t, f * 4.0, 1.0) * 0.1 * intensity;

    // Apply a massive "Saturation" boost
    // This is the Hans Zimmer secret: driving the signal hard
    let drive = mix(1.0, 8.0, intensity);
    var final_bray = tanh(sound * drive);

    // Add a low-end rumble (Sub)
    final_bray += sin(2.0 * PI * (f * 0.5) * t) * 0.5 * intensity;

    return final_bray * intensity;
}
// Dark, rising piano/string ostinato
fn ostinato(t: f32, f: f32) -> f32 {
    return sin(2.0 * PI * f * t) * exp(-3.0 * (t % 0.25));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    var final_mix: f32 = 0.0;

    // --- 1. THE BRAAAAAM (Every 8 seconds) ---
    let bray_cycle = t % 8.0;
    let bray_env = adsr(bray_cycle, vec4f(0.5, 0.2, 0.6, 3.0), 0.0, 4.0);
    final_mix += bray(t, 27.5, bray_env) * 0.6; // Low A0

    // --- 2. THE RISING OSTINATO (Arpeggio) ---
    // A minor / C Major feel: A, C, E, G
    let notes = array<f32, 4>(45.0, 48.0, 52.0, 55.0);
    let step = i32(t * 4.0) % 4; // 16th notes
    let ost_env = adsr(t % 0.25, vec4f(0.01, 0.1, 0.0, 0.1), 0.0, 0.2);
    
    // Gradual build up over 32 seconds
    let build_up = min(t / 32.0, 1.0);
    
    let freq = pow(2.0, (notes[step] - 69.0) / 12.0) * 440.0;
    final_mix += ostinato(t, freq) * 0.3 * build_up;

    // --- 3. SUB BASS DRONE ---
    final_mix += sin(2.0 * PI * 32.7 * t) * 0.2;

    // --- 4. THE "TICKING" (Clock-like precision) ---
    let tick = (sin(2.0 * PI * 2000.0 * t) * exp(-100.0 * (t % 0.5))) * 0.05;
    final_mix += tick;

    // Master compression / Soft clipping
    final_mix = tanh(final_mix * (1.0 + build_up));
    
    // Stereo spread
    let pan = sin(t * 0.1) * 0.2;
    let side = mix(1.0 - pan, 1.0 + pan, u.channel);
    
    output[idx] = clamp(final_mix * side, -0.9, 0.9);
}
`;
