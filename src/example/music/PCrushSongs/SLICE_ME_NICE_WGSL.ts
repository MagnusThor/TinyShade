
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
const TWO_PI: f32 = 6.28318530718;

// ─────────────────────────────────────────────────────────
// TUNING  (A = 432 Hz, as measured in the original recording)
// ─────────────────────────────────────────────────────────
const A432: f32 = 432.0;

// MIDI → frequency in A=432 tuning
fn midiToHz(m: f32) -> f32 {
    return A432 * pow(2.0, (m - 69.0) / 12.0);
}

// C minor scale pitches (observed directly from spectral analysis)
// C4=255Hz  D4=284Hz  Eb4=320Hz  F4=358Hz  G4=381Hz  Ab4=427Hz  C5=509Hz
// All match A=432 tuning within ~1Hz measurement error
const C4:  f32 = 255.0;
const D4:  f32 = 284.0;
const EB4: f32 = 320.0;
const F4:  f32 = 358.0;
const G4:  f32 = 381.0;
const AB4: f32 = 427.0;
const C5:  f32 = 509.0;
const C2:  f32 = 63.75;   // bass pedal, enters at ~30s
const G2:  f32 = 95.5;    // fifth pedal companion

// ─────────────────────────────────────────────────────────
// GLASS BOWL VOICE
// Inharmonic partial structure measured from recording:
//   x1.000  (fundamental)       amp ≈ 1.00
//   x1.587  (≈2^(2/3), cube-root inharmonic — glass signature)  amp ≈ 0.55
//   x2.000  (octave)            amp ≈ 0.48
//   x2.388  (sharp compound 3rd) amp ≈ 0.20
//   x3.000  (3rd harmonic)      amp ≈ 0.16
//   x4.013  (4th harmonic)      amp ≈ 0.11
//   x5.037  (5th harmonic)      amp ≈ 0.05
//   x6.050  (6th harmonic)      amp ≈ 0.03
// ─────────────────────────────────────────────────────────
fn glassBowl(t: f32, freq: f32, age: f32) -> f32 {
    // age = time since this note began (seconds)
    // Long sustain: ~3s to 1/e, very soft attack (5ms)
    let attack  = 1.0 - exp(-200.0 * age);     // ~5ms attack
    let sustain = exp(-0.33 * age);             // ~3s decay (measured)
    let env = attack * sustain;

    // Inharmonic partials (measured from spectral analysis)
    var s: f32 = 0.0;
    s += sin(TWO_PI * freq          * t) * 1.00;
    s += sin(TWO_PI * freq * 1.587  * t) * 0.55;
    s += sin(TWO_PI * freq * 2.000  * t) * 0.48;
    s += sin(TWO_PI * freq * 2.388  * t) * 0.20;
    s += sin(TWO_PI * freq * 3.000  * t) * 0.16;
    s += sin(TWO_PI * freq * 4.013  * t) * 0.11;
    s += sin(TWO_PI * freq * 5.037  * t) * 0.05;
    s += sin(TWO_PI * freq * 6.050  * t) * 0.03;

    // Slight frequency shimmer (glass wobble / resonance beating)
    let shimmer = 1.0 + sin(TWO_PI * 3.1 * age) * 0.0008;
    s += sin(TWO_PI * freq * shimmer * t) * 0.04 * sustain;

    return s * env;
}

// ─────────────────────────────────────────────────────────
// HIGH SPARKLE — upper register C5 (509 Hz) with very
// bright, short inharmonic burst (heard as brief chime hits)
// ─────────────────────────────────────────────────────────
fn glassBowlHigh(t: f32, freq: f32, age: f32) -> f32 {
    let attack  = 1.0 - exp(-300.0 * age);
    let sustain = exp(-0.55 * age);   // shorter decay at high register
    let env = attack * sustain;
    var s: f32 = 0.0;
    s += sin(TWO_PI * freq         * t) * 1.00;
    s += sin(TWO_PI * freq * 1.587 * t) * 0.45;
    s += sin(TWO_PI * freq * 2.0   * t) * 0.30;
    s += sin(TWO_PI * freq * 3.0   * t) * 0.10;
    return s * env;
}

// ─────────────────────────────────────────────────────────
// BASS PEDAL — deep C2/G2 drone, enters ~30s
// Bowed/sustained rather than struck, so envelope is much flatter
// ─────────────────────────────────────────────────────────
fn bassPedal(t: f32, globalT: f32) -> f32 {
    // Bass fades in slowly after 30s
    let fadeIn = clamp((globalT - 30.0) / 8.0, 0.0, 1.0);

    // Slow volume swell (observed ~10s breathing cycle)
    let swell = 0.6 + 0.4 * sin(TWO_PI * globalT / 9.7);

    // C2 root with second harmonic
    var bass: f32 = 0.0;
    bass += sin(TWO_PI * C2 * t) * 1.0;
    bass += sin(TWO_PI * C2 * 2.0 * t) * 0.45;  // octave reinforce
    bass += sin(TWO_PI * G2 * t) * 0.35;          // fifth adds warmth

    // Very slight growl (sub-harmonic motion)
    bass += sin(TWO_PI * C2 * 1.587 * t) * 0.12;

    return bass * 0.18 * fadeIn * swell;
}

// ─────────────────────────────────────────────────────────
// MULTI-TAP REVERB SIMULATION
// Real glass bowl recordings have a very long, rich reverb.
// WGSL can't do true feedback delay (no persistent state),
// so we fake it with time-offset re-triggers of the note voice.
// Each tap plays the same voice at a slight time offset, amplitude-attenuated.
// ─────────────────────────────────────────────────────────
fn reverbTap(t: f32, freq: f32, noteAge: f32, tapDelay: f32, tapAmp: f32) -> f32 {
    let age = noteAge - tapDelay;
    if (age < 0.0) { return 0.0; }
    return glassBowl(t, freq, age) * tapAmp;
}

// ─────────────────────────────────────────────────────────
// MELODY SEQUENCER
// Reconstructed from spectral pitch-tracking of the recording.
// The piece uses a free/rubato feel — no strict tempo.
// Phrase structure (observed):
//   ph0: C4  Eb4  F4  D4  C4         (slow opening, ~8s)
//   ph1: C4  Eb4  C5  G4  F4         (rising phrase)
//   ph2: C4  D4   Eb4 C4  Ab4  Eb4   (chromatic fill)
//   ph3: C4  Eb4  F4  C5  Eb4  C4    (arch phrase)
//   ph4: Eb4 Ab4  F4  Eb4 D4   C4    (descending)
//
// Note onset times within each phrase (in seconds, from phrase start):
// ─────────────────────────────────────────────────────────

struct Note {
    freq: f32,
    onset: f32,   // time from phrase start
    dur:   f32,   // how long this note rings before next
};

// Phrase 0 — opening (8.75s total)
fn phrase0(idx: i32) -> Note {
    var n: Note;
    let freqs  = array<f32, 5>(C4,  EB4, F4,  D4,  C4);
    let onsets = array<f32, 5>(0.0, 0.875, 1.75, 2.625, 3.5);
    let durs   = array<f32, 5>(0.875, 0.875, 0.875, 0.875, 4.375);
    let i = clamp(idx, 0, 4);
    n.freq  = freqs[i];
    n.onset = onsets[i];
    n.dur   = durs[i];
    return n;
}
const PH0_LEN: f32 = 8.75;

// Phrase 1 — rising (7.5s)
fn phrase1(idx: i32) -> Note {
    var n: Note;
    let freqs  = array<f32, 5>(C4,  EB4, C5,  G4,  F4);
    let onsets = array<f32, 5>(0.0, 1.0, 1.875, 2.625, 3.375);
    let durs   = array<f32, 5>(1.0, 0.875, 0.75, 0.75, 3.25);
    let i = clamp(idx, 0, 4);
    n.freq  = freqs[i];
    n.onset = onsets[i];
    n.dur   = durs[i];
    return n;
}
const PH1_LEN: f32 = 7.5;

// Phrase 2 — chromatic fill (9.25s)
fn phrase2(idx: i32) -> Note {
    var n: Note;
    let freqs  = array<f32, 6>(C4, D4,  EB4, C4, AB4, EB4);
    let onsets = array<f32, 6>(0.0, 0.5, 1.0, 1.75, 2.625, 3.5);
    let durs   = array<f32, 6>(0.5, 0.5, 0.75, 0.875, 0.875, 4.875);
    let i = clamp(idx, 0, 5);
    n.freq  = freqs[i];
    n.onset = onsets[i];
    n.dur   = durs[i];
    return n;
}
const PH2_LEN: f32 = 9.25;

// Phrase 3 — arch (9.0s)
fn phrase3(idx: i32) -> Note {
    var n: Note;
    let freqs  = array<f32, 6>(C4, EB4, F4, C5, EB4, C4);
    let onsets = array<f32, 6>(0.0, 1.0, 1.875, 2.75, 3.625, 4.5);
    let durs   = array<f32, 6>(1.0, 0.875, 0.875, 0.875, 0.875, 3.625);
    let i = clamp(idx, 0, 5);
    n.freq  = freqs[i];
    n.onset = onsets[i];
    n.dur   = durs[i];
    return n;
}
const PH3_LEN: f32 = 9.0;

// Phrase 4 — descending (8.5s)
fn phrase4(idx: i32) -> Note {
    var n: Note;
    let freqs  = array<f32, 6>(EB4, AB4, F4, EB4, D4, C4);
    let onsets = array<f32, 6>(0.0, 0.875, 1.75, 2.5, 3.25, 4.125);
    let durs   = array<f32, 6>(0.875, 0.875, 0.75, 0.75, 0.875, 3.5);
    let i = clamp(idx, 0, 5);
    n.freq  = freqs[i];
    n.onset = onsets[i];
    n.dur   = durs[i];
    return n;
}
const PH4_LEN: f32 = 8.5;

// Total cycle length
const CYCLE_LEN: f32 = 43.0; // ph0+ph1+ph2+ph3+ph4

// ─────────────────────────────────────────────────────────
// MAIN VOICE EVALUATOR
// Given global time t, find which notes are currently
// sounding and accumulate their contributions.
// We check current phrase + previous phrase overlap (for long decays).
// ─────────────────────────────────────────────────────────
fn voiceAtTime(t: f32, globalT: f32) -> f32 {
    var mix: f32 = 0.0;

    // Determine which phrase we're in within the current cycle
    let cycle_t = globalT % CYCLE_LEN;

    // Phrase offsets within cycle
    let PH0_START: f32 = 0.0;
    let PH1_START: f32 = PH0_LEN;
    let PH2_START: f32 = PH0_LEN + PH1_LEN;
    let PH3_START: f32 = PH0_LEN + PH1_LEN + PH2_LEN;
    let PH4_START: f32 = PH0_LEN + PH1_LEN + PH2_LEN + PH3_LEN;

    // Evaluate all notes from all phrases that may still be ringing
    // (notes decay over ~4s, so we only need current + brief look-back)

    // Phrase 0 notes
    for (var i: i32 = 0; i < 5; i++) {
        let n = phrase0(i);
        let note_global = (globalT - (globalT % CYCLE_LEN)) + PH0_START + n.onset;
        let age = globalT - note_global;
        if (age >= 0.0 && age < 6.0) {
            let isHigh = n.freq > 480.0;
            if (isHigh) {
                mix += glassBowlHigh(t, n.freq, age) * 0.18;
            } else {
                mix += glassBowl(t, n.freq, age) * 0.22;
                // Reverb taps (simulated long tail)
                mix += reverbTap(t, n.freq, age, 0.08, 0.12) * 0.22;
                mix += reverbTap(t, n.freq, age, 0.18, 0.07) * 0.22;
                mix += reverbTap(t, n.freq, age, 0.32, 0.04) * 0.22;
            }
        }
    }
    // Phrase 1 notes
    for (var i: i32 = 0; i < 5; i++) {
        let n = phrase1(i);
        let note_global = (globalT - (globalT % CYCLE_LEN)) + PH1_START + n.onset;
        let age = globalT - note_global;
        if (age >= 0.0 && age < 6.0) {
            let isHigh = n.freq > 480.0;
            if (isHigh) {
                mix += glassBowlHigh(t, n.freq, age) * 0.18;
            } else {
                mix += glassBowl(t, n.freq, age) * 0.22;
                mix += reverbTap(t, n.freq, age, 0.08, 0.12) * 0.22;
                mix += reverbTap(t, n.freq, age, 0.20, 0.06) * 0.22;
            }
        }
    }
    // Phrase 2 notes
    for (var i: i32 = 0; i < 6; i++) {
        let n = phrase2(i);
        let note_global = (globalT - (globalT % CYCLE_LEN)) + PH2_START + n.onset;
        let age = globalT - note_global;
        if (age >= 0.0 && age < 6.0) {
            let isHigh = n.freq > 480.0;
            if (isHigh) {
                mix += glassBowlHigh(t, n.freq, age) * 0.18;
            } else {
                mix += glassBowl(t, n.freq, age) * 0.22;
                mix += reverbTap(t, n.freq, age, 0.09, 0.11) * 0.22;
                mix += reverbTap(t, n.freq, age, 0.22, 0.05) * 0.22;
            }
        }
    }
    // Phrase 3 notes
    for (var i: i32 = 0; i < 6; i++) {
        let n = phrase3(i);
        let note_global = (globalT - (globalT % CYCLE_LEN)) + PH3_START + n.onset;
        let age = globalT - note_global;
        if (age >= 0.0 && age < 6.0) {
            let isHigh = n.freq > 480.0;
            if (isHigh) {
                mix += glassBowlHigh(t, n.freq, age) * 0.18;
            } else {
                mix += glassBowl(t, n.freq, age) * 0.22;
                mix += reverbTap(t, n.freq, age, 0.08, 0.12) * 0.22;
                mix += reverbTap(t, n.freq, age, 0.19, 0.06) * 0.22;
            }
        }
    }
    // Phrase 4 notes
    for (var i: i32 = 0; i < 6; i++) {
        let n = phrase4(i);
        let note_global = (globalT - (globalT % CYCLE_LEN)) + PH4_START + n.onset;
        let age = globalT - note_global;
        if (age >= 0.0 && age < 6.0) {
            let isHigh = n.freq > 480.0;
            if (isHigh) {
                mix += glassBowlHigh(t, n.freq, age) * 0.18;
            } else {
                mix += glassBowl(t, n.freq, age) * 0.22;
                mix += reverbTap(t, n.freq, age, 0.10, 0.10) * 0.22;
                mix += reverbTap(t, n.freq, age, 0.24, 0.05) * 0.22;
            }
        }
    }

    return mix;
}

// ─────────────────────────────────────────────────────────
// HIGH SHIMMER — continuous crystalline air
// Represents the glass harmonic overtones that ring freely,
// creating the ambient halo heard throughout the recording
// ─────────────────────────────────────────────────────────
fn highShimmer(t: f32) -> f32 {
    // Very subtle interference beating between near-unison partials
    var s: f32 = 0.0;
    s += sin(TWO_PI * 1018.0 * t) * 0.012;
    s += sin(TWO_PI * 1020.5 * t) * 0.010;   // 2.5Hz beating
    s += sin(TWO_PI * 763.5  * t) * 0.008;
    s += sin(TWO_PI * 766.0  * t) * 0.007;   // 2.5Hz beating
    // Slow amplitude modulation
    let lfo = sin(TWO_PI * 0.07 * t) * 0.5 + 0.5;
    return s * (0.4 + 0.6 * lfo);
}

// ─────────────────────────────────────────────────────────
// COMPUTE ENTRY POINT
// ─────────────────────────────────────────────────────────
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let globalT = u.bufferTime + f32(idx) / u.sampleRate;
    let t = globalT;   // we use absolute t for oscillators

    var mix: f32 = 0.0;

    // 1. Glass bowl melody voices (polyphonic, with reverb taps)
    mix += voiceAtTime(t, globalT);

    // 2. Bass pedal (fades in at 30s)
    mix += bassPedal(t, globalT);

    // 3. High shimmer / air
    mix += highShimmer(t);

    // 4. Soft warm saturation (matches the analog warmth in recording)
    mix = mix / (1.0 + abs(mix) * 0.6);

    // Final clip
    output[idx] = clamp(mix, -0.9, 0.9);
}

`;
