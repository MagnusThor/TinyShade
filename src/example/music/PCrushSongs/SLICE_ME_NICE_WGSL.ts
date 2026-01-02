
export const SLICE_ME_NICE_WGSL = /* wgsl */ `

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;

// ----------------------------------------------------
// 80s ITALO DISCO DRUM MACHINE
// ----------------------------------------------------
fn italoDrums(t: f32) -> f32 {
    // 125 BPM
    let bt = t % 0.48;

    // Kick (short & punchy)
    let kick = sin(2.0 * PI * 55.0 * bt - 8.0 * exp(-18.0 * bt)) * exp(-9.0 * bt);

    // Snare (classic clap-ish noise)
    let st = (t + 0.48) % 0.96;
    let sn = (fract(sin(st * 9321.77)) * 2.0 - 1.0) * exp(-12.0 * st) * 0.45;

    // Hi-hat (steady 16ths)
    let ht = (t * 4.0) % 1.0;
    let hat = (fract(sin(ht * 18345.3)) * 2.0 - 1.0) * exp(-40.0 * ht) * 0.12;

    return kick + sn + hat;
}

// ----------------------------------------------------
// GALLoping ITALO BASS (Saw + Pulse)
// ----------------------------------------------------
fn italoBass(t: f32, f: f32) -> f32 {
    let step = t % 0.125;
    let env = exp(-10.0 * step);

    let saw = 2.0 * (t * f - floor(0.5 + t * f));
    let pulse = sign(sin(2.0 * PI * f * t));

    return (saw * 0.6 + pulse * 0.25) * env * 0.7;
}

// ----------------------------------------------------
// GATED 80s POLY CHORD
// ----------------------------------------------------
fn gatedChord(t: f32, f: f32, gateRate: f32) -> f32 {
    let gate = step(0.5, fract(t * gateRate));
    let detune = sin(t * 3.0) * 0.003;

    let osc =
        sin(2.0 * PI * (f + detune) * t) +
        sin(2.0 * PI * (f * 1.01 - detune) * t);

    return osc * gate * 0.18;
}

// ----------------------------------------------------
// SHIMMERY ARP LEAD
// ----------------------------------------------------
fn sliceLead(t: f32, f: f32) -> f32 {
    let at = t % 0.0625;
    let env = exp(-25.0 * at);
    let vibrato = sin(t * 6.0) * 0.004;

    return sin(2.0 * PI * (f + vibrato) * t) * env * 0.25;
}

// ----------------------------------------------------
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    var mix: f32 = 0.0;

    // 1. DRUMS
    mix += italoDrums(t);

    // 2. BASSLINE (Minor Italo progression)
    // Am -> F -> G -> Em
    let seq = i32(t / 1.92) % 4;
    let notes = array<f32, 4>(45.0, 41.0, 43.0, 40.0);

    let bounce = i32(t * 8.0) % 2 == 1;
    var note = notes[seq];
    if (bounce) { note += 12.0; }

    let bassFreq = pow(2.0, (note - 69.0) / 12.0) * 440.0;
    mix += italoBass(t, bassFreq) * 0.8;

    // 3. GATED CHORD STABS
    mix += gatedChord(t, bassFreq * 1.5, 4.0);
    mix += gatedChord(t, bassFreq * 1.8, 4.0);

    // 4. ARP LEAD (Slice me nice sparkle ✨)
    let arpNote = note + f32(i32(t * 16.0) % 3) * 7.0;
    let arpFreq = pow(2.0, (arpNote - 69.0) / 12.0) * 440.0;
    mix += sliceLead(t, arpFreq);

    // Final
    output[idx] = clamp(mix * 0.85, -0.9, 0.9);
}
`;
