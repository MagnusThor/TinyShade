
export const EPIC_CINEMATIC_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

// Basic sine wave
fn sine(t: f32, f: f32) -> f32 {
    return sin(2.0 * PI * f * t);
}

// ADSR envelope: attack, decay, sustain, release
fn adsr(t_abs: f32, env: vec4f, start: f32, duration: f32) -> f32 {
    let t = t_abs - start;
    let sustain = env.z;
    let t1 = env.x;
    let t2 = t1 + env.y;
    let t3 = max(t2, duration);
    let t4 = t3 + env.w;

    if (t < 0.0 || t > t4) { return 0.0; }
    if (t <= t1) { return smoothstep(0.0, t1, t); }
    if (t <= t2) { return sustain + smoothstep(t2, t1, t) * (1.0 - sustain); }
    if (t <= t3) { return sustain; }
    return sustain * smoothstep(t4, t3, t);
}

// Slow evolving pad using sine + FM
fn pad(t: f32, f: f32) -> f32 {
    let modulator = sin(t * 0.3) * 5.0;
    return sine(t, f + modulator) * 0.3;
}

// Deep cinematic bass
fn bass(t: f32, f: f32) -> f32 {
    return sine(t, f) * 0.5 * exp(-t * 0.1);
}

// Simple percussive hit
fn hit(t: f32, f: f32) -> f32 {
    return sine(t, f) * exp(-t * 10.0);
}

// Converts MIDI note to frequency
fn noteToFreq(n: f32) -> f32 {
    return pow(2.0, (n - 69.0) / 12.0) * 440.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    var sound: f32 = 0.0;

    // Slow pad chord progression
    var padNotes = array<f32, 4>(48.0, 52.0, 55.0, 59.0); // C, E, G, B
    for (var i: i32 = 0; i < 4; i = i + 1) {
        sound += pad(t, noteToFreq(padNotes[i])) * adsr(t, vec4f(2.0, 4.0, 0.7, 2.0), f32(i) * 0.5, 8.0);
    }

    // Deep bass drone
    sound += bass(t, 32.0 + 4.0 * sin(t * 0.05));

    // Sparse cinematic hits every 1.5 seconds
  let beatTime = t - 1.5 * floor(t / 1.5);

    sound += hit(beatTime, 80.0) * adsr(beatTime, vec4f(0.01, 0.1, 0.0, 0.2), 0.0, 0.2);

    // Stereo pan effect
    let pan = mix(-0.3, 0.3, u.channel);
    output[idx] = clamp(sound * (1.0 + pan), -1.0, 1.0);
}
`;


export const EPIC_LONG_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

fn sine(t: f32, f: f32) -> f32 {
    return sin(2.0 * PI * f * t);
}

fn adsr(t_abs: f32, env: vec4f, start: f32, duration: f32) -> f32 {
    let t = t_abs - start;
    if (t < 0.0) { return 0.0; }
    let sustain = env.z;
    let t1 = env.x;
    let t2 = t1 + env.y;
    let t3 = max(t2, duration);
    let t4 = t3 + env.w;
    if (t > t4) { return 0.0; }
    if (t <= t1) { return smoothstep(0.0, t1, t); }
    if (t <= t2) { return sustain + smoothstep(t2, t1, t) * (1.0 - sustain); }
    if (t <= t3) { return sustain; }
    return sustain * smoothstep(t4, t3, t);
}

fn pad(t: f32, f: f32) -> f32 {
    let modulator = sin(t * 0.3) * 5.0;
    return sine(t, f + modulator) * 0.3;
}

fn bass(t: f32, f: f32) -> f32 {
    // Thicker bass with a bit of saturation
    let s = sine(t, f);
    return (s / (1.0 + abs(s))) * 0.6;
}

fn hit(t: f32, f: f32) -> f32 {
    return sine(t, f) * exp(-t * 8.0);
}

fn noteToFreq(n: f32) -> f32 {
    return pow(2.0, (n - 69.0) / 12.0) * 440.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    
    // --- 60 SECOND TIMELINE ---
    let song_dur = 60.0;
    let timeline = (t % song_dur) / song_dur;
    var sound: f32 = 0.0;

    // 1. DYNAMIC CHORD PROGRESSION
    // We change the root note every 15 seconds
    // C (48) -> A (45) -> F (41) -> G (43)
    let roots = array<f32, 4>(48.0, 45.0, 41.0, 43.0);
    let section = i32(timeline * 4.0) % 4;
    let root = roots[section];
    
    // Play a triad based on the current root
    let padNotes = array<f32, 3>(root, root + 4.0, root + 7.0); 
    for (var i: i32 = 0; i < 3; i = i + 1) {
        // Pads fade in more as the song progresses
        let vol = 0.2 + 0.3 * timeline;
        sound += pad(t, noteToFreq(padNotes[i])) * vol;
    }

    // 2. EVOLVING BASS
    // The bass follows the root note and gets heavier
    let bass_env = 0.4 + 0.4 * timeline;
    sound += bass(t, noteToFreq(root - 12.0)) * bass_env;

    // 3. PROGRESSIVE BEAT
    // Beat starts every 3 seconds, speeds up to every 0.75 seconds
    let beat_speed = mix(3.0, 0.75, timeline);
    let beatTime = t % beat_speed;
    let hit_vol = smoothstep(0.1, 0.9, timeline); // Drum fades in over time
    sound += hit(beatTime, 60.0) * hit_vol;

    // 4. ATMOSPHERIC SHIMMER (Appears halfway through)
    let shimmer_env = smoothstep(0.5, 0.8, timeline);
    sound += sine(t, noteToFreq(root + 24.0)) * 0.05 * shimmer_env * sin(t * 2.0);

    // Stereo and Output
    let pan = mix(-0.4, 0.4, u.channel);
    // Soft limiter to prevent clipping during the build-up
    sound = sound / (1.0 + abs(sound));
    
    output[idx] = clamp(sound * (1.0 + pan), -0.9, 0.9);
}
`;


