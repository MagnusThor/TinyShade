

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


export const EPIC_LONG_WGSL_MIN = `struct AudioUniforms{bufferTime:f32,sampleRate:f32,channel:f32,_pad:f32}@group(0) @binding(0) var<uniform> u:AudioUniforms;@group(0) @binding(1) var<storage,read_write> output:array<f32>;const PI:f32=3.14159265359;fn sine(t:f32,f:f32)->f32{return sin(2.0*PI*f*t);}fn pad(t:f32,f:f32)->f32{let modulator=sin(t*0.3)*5.0;return sine(t,f+modulator)*0.3;}fn bass(t:f32,f:f32)->f32{let s=sine(t,f);return (s/(1.0+abs(s)))*0.6;}fn hit(t:f32,f:f32)->f32{return sine(t,f)*exp(-t*8.0);}fn noteToFreq(n:f32)->f32{return pow(2.0,(n-69.0)/12.0)*440.0;}@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let idx=id.x;if (idx>=arrayLength(&output)){return;}let t=u.bufferTime+f32(idx)/u.sampleRate;let song_dur=60.0;let timeline=(t%song_dur)/song_dur;var sound:f32=0.0;let roots=array<f32,4>(48.0,45.0,41.0,43.0);let section=i32(timeline*4.0)%4;let root=roots[section];let padNotes=array<f32,3>(root,root+4.0,root+7.0);for(var i:i32=0;i<3;i=i+1){let vol=0.2+0.3*timeline;sound+=pad(t,noteToFreq(padNotes[i]))*vol;}let bass_env=0.4+0.4*timeline;sound+=bass(t,noteToFreq(root-12.0))*bass_env;let beat_speed=mix(3.0,0.75,timeline);let beatTime=t%beat_speed;let hit_vol=smoothstep(0.1,0.9,timeline);sound+=hit(beatTime,60.0)*hit_vol;let shimmer_env=smoothstep(0.5,0.8,timeline);sound+=sine(t,noteToFreq(root+24.0))*0.05*shimmer_env*sin(t*2.0);let pan=mix(-0.4,0.4,u.channel);sound=sound/(1.0+abs(sound));output[idx]=clamp(sound*(1.0+pan),-0.9,0.9);}`