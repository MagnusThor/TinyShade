/**
 * ──────────────────────────────────────────────────────────────────────────
 *  Lattice of Light — a Fruit of the Loom production
 * ──────────────────────────────────────────────────────────────────────────
 */

import { TinyShade } from "../TinyShade";
import { TSSequencer } from "../TSSequencer";
import { WavAudioPlugin } from "./WavAudioPlugin";
import { UniformLayout } from "../UniformLayout";


const FFT_SIZE = 128;
const fftCanvas = document.createElement("canvas");
fftCanvas.width = FFT_SIZE;
fftCanvas.height = 1;
const fftCtx = fftCanvas.getContext("2d")!;
const fftImgData = fftCtx.createImageData(FFT_SIZE, 1);

function mountStartButton(onPlay: () => void): void {
    const overlay = document.getElementById("start-overlay") as HTMLDivElement | null;
    const btn     = document.getElementById("start-btn")     as HTMLButtonElement | null;

    if (!overlay || !btn) {
        onPlay();
        return;
    }

    const handleClick = async () => {
        btn.removeEventListener("click", handleClick);

        try {
            const el  = document.documentElement as any;
            const req = el.requestFullscreen
                     ?? el.webkitRequestFullscreen
                     ?? el.mozRequestFullScreen
                     ?? el.msRequestFullscreen;
            if (req) await req.call(el);
        } catch {
        }

        overlay.classList.add("hiding");
        overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });

        onPlay();
    };

    btn.addEventListener("click", handleClick);
}


function updateFftCanvas(bytes: Uint8Array): void {
    for (let i = 0; i < FFT_SIZE; i++) {
        const v = bytes[i];
        fftImgData.data[i * 4 + 0] = v;
        fftImgData.data[i * 4 + 1] = v;
        fftImgData.data[i * 4 + 2] = v;
        fftImgData.data[i * 4 + 3] = 255;
    }
    fftCtx.putImageData(fftImgData, 0, 0);
}

function getFrequencyBytes(audio: WavAudioPlugin): Uint8Array {
    const analyser = (audio as any).analyserNode as AnalyserNode;
    const bytes = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bytes);
    return bytes;
}


const CANVAS_W = 1280;
const CANVAS_H = 720;
const BPM = 128;
const BEAT_MS = 60000 / BPM;

interface TextWord {
    text: string;
    revealTime: number;
    opacity: number;
}

interface TextLine {
    words: TextWord[];
    y: number;
    size: number;
    subtitle: boolean;
    baseAlpha: number;
}

interface TextCard {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    lines: TextLine[];
    startTime: number;
    allRevealed: boolean;
    dirty: boolean;
}

/**
 * Build a TextCard from a line spec.
 * Each word gets a reveal time based on its sequential index across all lines
 * and the wordsPerBeat setting.
 *
 * @param lines      Array of {text, y, size, subtitle?, alpha?}
 * @param wordsPerBeat  How many words reveal per beat (can be fractional)
 * @param initialDelay  ms before first word appears (default = 1 beat)
 */
function makeCard(
    lines: { text: string; y: number; size: number; subtitle?: boolean; alpha?: number }[],
    wordsPerBeat = 1.0,
    initialDelay = BEAT_MS
): TextCard {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d")!;

    const msPerWord = BEAT_MS / wordsPerBeat;
    let wordIdx = 0;

    const cardLines: TextLine[] = lines.map(l => ({
        y: l.y,
        size: l.size,
        subtitle: l.subtitle ?? false,
        baseAlpha: l.alpha ?? 1.0,
        words: l.text.split(" ").map(w => ({
            text: w,
            revealTime: initialDelay + wordIdx++ * msPerWord,
            opacity: 0,
        }))
    }));

    return { canvas, ctx, lines: cardLines, startTime: 0, allRevealed: false, dirty: true };
}

/**
 * Update a card's word opacities based on elapsed time.
 * Returns true if anything changed (needs redraw).
 */
function tickCard(card: TextCard, audioTimeMs: number): boolean {
    const elapsed = audioTimeMs - card.startTime;
    let changed = false;
    let allDone = true;

    for (const line of card.lines) {
        for (const word of line.words) {
            const wordElapsed = elapsed - word.revealTime;
            let target: number;

            if (wordElapsed < 0) {
                target = 0;
                allDone = false;
            } else if (wordElapsed < 120) {
                target = wordElapsed / 120;
                allDone = false;
            } else {
                target = 1;
            }

            if (Math.abs(target - word.opacity) > 0.005) {
                word.opacity = target;
                changed = true;
            }
        }
    }

    if (!card.allRevealed && allDone) {
        card.allRevealed = true;
        changed = true;
    }

    return changed;
}

/**
 * Redraw a card onto its canvas.
 * Words are laid out with measured spacing so they flow naturally.
 */
function drawCard(card: TextCard, masterAlpha: number): void {
    const { ctx } = card;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    for (const line of card.lines) {
        const weight = line.subtitle ? "300" : "bold";
        ctx.font = `${weight} ${line.size}px Inter, system-ui, sans-serif`;

        const totalWidth = line.words.reduce((acc, w, i) => {
            const space = i < line.words.length - 1 ? ctx.measureText(" ").width : 0;
            return acc + ctx.measureText(w.text).width + space;
        }, 0);

        let x = (CANVAS_W - totalWidth) / 2;

        for (let wi = 0; wi < line.words.length; wi++) {
            const word = line.words[wi];
            const alpha = word.opacity * line.baseAlpha * masterAlpha;
            if (alpha < 0.001) {
                x += ctx.measureText(word.text).width;
                if (wi < line.words.length - 1) x += ctx.measureText(" ").width;
                continue;
            }

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = "white";
            ctx.textBaseline = "middle";
            ctx.textAlign = "left";
            ctx.shadowColor = "rgba(80, 200, 255, 0.6)";
            ctx.shadowBlur = line.subtitle ? 8 : 28;
            ctx.fillText(word.text, x, line.y);
            ctx.restore();

            x += ctx.measureText(word.text).width;
            if (wi < line.words.length - 1) x += ctx.measureText(" ").width;
        }
    }
}


const cards = {
    titleA: makeCard([
        { text: "Lattice of Light", y: 195, size: 64 },
        { text: "a Fruit of the Loom production", y: 272, size: 24, subtitle: true, alpha: 0.55 },
    ], 0.6, BEAT_MS * 2),

    titleB: makeCard([
        { text: "There is a wonderfully weird", y: 148, size: 28, subtitle: true, alpha: 0.85 },
        { text: "but real world out there,", y: 190, size: 28, subtitle: true, alpha: 0.85 },
        { text: "and we are a part of it.", y: 232, size: 28, subtitle: true, alpha: 0.85 },
        { text: "— Ulf Danielsson", y: 292, size: 20, subtitle: true, alpha: 0.45 },
    ], 1.5, BEAT_MS),

    credits: makeCard([
        { text: "CODE   Magnus Thor", y: 160, size: 32, subtitle: true },
        { text: "MUSIC  Virgill", y: 215, size: 32, subtitle: true },
        { text: "DIRECTION  Magnus Thor", y: 270, size: 32, subtitle: true },
        { text: "greetings to all friends...", y: 340, size: 20, subtitle: true, alpha: 0.5 },
    ], 1.0, BEAT_MS),
};

let activeCard: TextCard | null = null;

function activateCard(card: TextCard, audioTimeMs: number): void {
    for (const line of card.lines) {
        for (const word of line.words) {
            word.opacity = 0;
        }
    }
    card.allRevealed = false;
    card.dirty = true;
    card.startTime = audioTimeMs;
    activeCard = card;
}


const arr_ro = [
    [0.0, 0.5, -5.0],
    [-2.2, -2.6, -5.0],
    [-0.7, -2.2, -4.0],
    [3.0, -5.2, -3.0],
    [-0.4, -0.4, -5.2],
];

let u_ro = [...arr_ro[0]];
let u_samples = 8;
let u_exposure = 0.001;
let u_showLattice = 0.0;
let u_showSphere = 0.0;
let u_showLights = 0.0;
let u_showFloor = 0.0;
let u_showFog = 1.0;
let u_showChroma = 0.0;
let u_showTwist = 0.0;
let u_showFilmic = 0.0;
let u_showVignette = 1.0;
let u_particleCount = 2_000;
let u_showParticles = 1.0;
let u_particleSpeed = 0.2;
let u_overlayAlpha = 1.0;
let u_audioLow = 0.0;
let u_audioMid = 0.0;
let u_audioHigh = 0.0;


const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => { const c = clamp(t); return c * c * (3 - 2 * c); };
const ease = (t: number) => { const c = clamp(t); return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c; };
const lerp3 = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);


let lastSceneId = -1;
let titleBShown = false;
let currentAudioMs = 0;

function applyScene(app: TinyShade, sceneId: number, progress: number): void {
    const p = clamp(progress);
    const ep = ease(p);

    if (sceneId !== lastSceneId) {
        lastSceneId = sceneId;
        titleBShown = false;
        if (sceneId === 1) activateCard(cards.titleA, currentAudioMs);
        else if (sceneId === 7) activateCard(cards.credits, currentAudioMs);
        else activeCard = null;
    }

    switch (sceneId) {

        case 1: {
            u_showLattice = 0.0;
            u_showSphere = 0.0;
            u_showLights = 0.0;
            u_showFloor = 0.0;
            u_showFog = 1.0;
            u_showChroma = 0.0;
            u_showTwist = 0.0;
            u_showFilmic = 0.0;
            u_showParticles = 1.0;
            u_particleCount = 2_000_000;
            u_particleSpeed = 0.2;
            u_ro = [...arr_ro[0]];
            u_exposure = smooth(p) * 0.8;
            u_overlayAlpha = 1.0;

            if (p >= 0.5 && !titleBShown) {
                titleBShown = true;
                activateCard(cards.titleB, currentAudioMs);
            } else if (p < 0.5 && titleBShown) {
                titleBShown = false;
                activateCard(cards.titleA, currentAudioMs);
            }

            const sceneFade = p < 0.08 ? smooth(p / 0.08)
                : p > 0.92 ? smooth((1 - p) / 0.08)
                    : 1.0;
            u_overlayAlpha = sceneFade;
            break;
        }

        case 2: {
            u_showFog = 1.0;
            u_showChroma = 0.0;
            u_showTwist = 0.0;
            u_showFilmic = 0.0;
            u_showParticles = 1.0;
            u_showSphere = 0.0;
            u_showLights = 0.0;
            u_particleCount = 4_000;
            u_particleSpeed = 0.3 + ep * 0.2;
            u_ro = [...arr_ro[0]];
            u_overlayAlpha = 0.0;
            u_showFloor = smooth(p * 2.0);
            u_showLattice = smooth(clamp((p - 0.3) / 0.7));
            u_exposure = 0.7 + ep * 0.5;
            break;
        }

        case 3: {
            u_showFloor = 1.0;
            u_showLattice = 1.0;
            u_showFog = 0.5;
            u_showChroma = 0.0;
            u_showTwist = 0.0;
            u_showParticles = 1.0;
            u_particleCount = 6_000;
            u_particleSpeed = 0.5 + ep * 0.2;
            u_overlayAlpha = 0.0;
            u_showSphere = smooth(p * 2.0);
            u_showLights = smooth(clamp((p - 0.3) / 0.7));
            u_showFilmic = smooth(clamp((p - 0.6) / 0.4));
            u_exposure = 1.2 + ep * 0.3;
            u_ro = lerp3(arr_ro[0], arr_ro[1], ep * 0.4);
            break;
        }

        case 4: {
            u_showFloor = 1.0;
            u_showLattice = 1.0;
            u_showSphere = 1.0;
            u_showLights = 1.0;
            u_showFog = 0.0;
            u_showFilmic = 1.0;
            u_showParticles = 1.0;
            u_particleCount = 10_000;
            u_overlayAlpha = 0.0;
            u_showTwist = smooth(p);
            u_showChroma = smooth(p);
            u_particleSpeed = 0.7 + ep * 0.8;
            u_exposure = 1.5 + ep * 0.4;
            u_ro = lerp3(arr_ro[1], arr_ro[3], ease(clamp(p * 1.5)));
            break;
        }

        case 5: {
            u_showFloor = 1.0;
            u_showLattice = 1.0;
            u_showSphere = 1.0;
            u_showLights = 1.0;
            u_showFilmic = 1.0;
            u_showParticles = 1.0;
            u_particleCount = 6_000;
            u_overlayAlpha = 0.0;
            u_showFog = smooth(p) * 0.8;
            u_showTwist = 1.0 - smooth(p);
            u_showChroma = 1.0 - smooth(p * 2);
            u_particleSpeed = 1.5 - ep * 0.8;
            u_exposure = 1.9 - ep * 0.5;
            u_ro = lerp3(arr_ro[3], arr_ro[2], ep);
            break;
        }

        case 6: {
            u_showFloor = 1.0;
            u_showLattice = 1.0;
            u_showSphere = 1.0;
            u_showLights = 1.0;
            u_showFog = 0.0;
            u_showFilmic = 1.0;
            u_showChroma = 1.0;
            u_showParticles = 1.0;
            u_particleCount = 16_000;
            u_overlayAlpha = 0.0;
            u_showTwist = smooth(p);
            u_particleSpeed = 1.2 + ep * 0.6;
            u_exposure = 1.4 + Math.sin(p * Math.PI) * 0.8;
            u_ro = lerp3(arr_ro[2], arr_ro[4], ep);
            break;
        }

        case 7: {
            u_showFloor = 1.0 - smooth(p);
            u_showLattice = 1.0 - smooth(p * 1.5);
            u_showSphere = 1.0 - smooth(p);
            u_showLights = 1.0 - smooth(p * 1.5);
            u_showFog = smooth(p);
            u_showFilmic = 1.0;
            u_showChroma = 1.0 - smooth(p * 2);
            u_showTwist = 0.0;
            u_showParticles = 1.0 - smooth(p * 2);
            u_particleCount = 4_000;
            u_particleSpeed = 0.3;
            u_exposure = 1.4 * (1.0 - smooth(p));
            u_overlayAlpha = p < 0.08 ? smooth(p / 0.08) : 1.0;
            u_ro = lerp3(arr_ro[4], arr_ro[0], ease(p));
            break;
        }
    }
}


const start = async () => {
    const app = await TinyShade.create("canvas");
    const audio = new WavAudioPlugin();
    await audio.load("assets/song.mp3");

    const TOTAL_LENGTH_MS = 127_490;
    const seq = new TSSequencer([], TOTAL_LENGTH_MS, BPM, 4);

    const L = TOTAL_LENGTH_MS;
    seq.timeline = [
        [seq.getUnitsFromMs(24_000, L), 0x0001, 1],
        [seq.getUnitsFromMs(16_000, L), 0x0002, 2],
        [seq.getUnitsFromMs(24_000, L), 0x0004, 3],
        [seq.getUnitsFromMs(24_000, L), 0x00FF, 4],
        [seq.getUnitsFromMs(16_000, L), 0x0008, 5],
        [seq.getUnitsFromMs(8_000, L), 0x00FF, 6],
        [seq.getUnitsFromMs(15_490, L), 0x0000, 7],
        [255, 0x0000, 0],
    ];

    await app.addTexture("overlay", cards.titleA.canvas);
    await app.addTexture("fft", fftCanvas);

    seq.onUpdate = (state) => {
        applyScene(app, state.sceneId, state.progress);
    };

    const uniforms = (l: UniformLayout) => {
        l.addUniform({ name: "ro", value: () => u_ro });
        l.addUniform({ name: "samples", value: () => u_samples });
        l.addUniform({ name: "exposure", value: () => u_exposure });
        l.addUniform({ name: "particleCount", value: () => u_particleCount });
        l.addUniform({ name: "particleSpeed", value: () => u_particleSpeed });
        l.addUniform({ name: "showLattice", value: () => u_showLattice });
        l.addUniform({ name: "showSphere", value: () => u_showSphere });
        l.addUniform({ name: "showLights", value: () => u_showLights });
        l.addUniform({ name: "showFloor", value: () => u_showFloor });
        l.addUniform({ name: "showFog", value: () => u_showFog });
        l.addUniform({ name: "showChroma", value: () => u_showChroma });
        l.addUniform({ name: "showTwist", value: () => u_showTwist });
        l.addUniform({ name: "showFilmic", value: () => u_showFilmic });
        l.addUniform({ name: "showVignette", value: () => u_showVignette });
        l.addUniform({ name: "showParticles", value: () => u_showParticles });
        l.addUniform({ name: "overlayAlpha", value: () => u_overlayAlpha });
        l.addUniform({ name: "audioLow", value: () => u_audioLow });
        l.addUniform({ name: "audioMid", value: () => u_audioMid });
        l.addUniform({ name: "audioHigh", value: () => u_audioHigh });
    };

    const pipeline = await app
        .setUniforms(uniforms)
        .addAudio(audio)
        .addSequencer(seq)

        .addCommon(`
            const PI:  f32 = 3.141592654;
            const TAU: f32 = 6.283185307;

            fn noise3(p: vec3f) -> f32 {
                let ip = floor(p);
                var fp = p - ip;
                let s  = vec3f(7.0, 157.0, 113.0);
                let h4 = vec4f(0.0, s.y, s.z, s.y + s.z) + dot(ip, s);
                fp = fp * fp * (3.0 - 2.0 * fp);
                let ha  = mix(fract(sin(h4) * 43758.5), fract(sin(h4 + s.x) * 43758.5), fp.x);
                let hxy = mix(vec2f(ha.x, ha.z), vec2f(ha.y, ha.w), fp.y);
                return mix(hxy.x, hxy.y, fp.z);
            }
            fn smin(a: f32, b: f32, k: f32) -> f32 {
                let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
                return mix(b, a, h) - k * h * (1.0 - h);
            }
            fn pR(p: vec2f, a: f32) -> vec2f {
                return cos(a) * p + sin(a) * vec2f(p.y, -p.x);
            }
            fn pcg_hash(input: u32) -> u32 {
                var state = input * 747796405u + 2891336453u;
                var word  = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
                return (word >> 22u) ^ word;
            }
            fn rand(seed: ptr<function, u32>) -> f32 {
                *seed = pcg_hash(*seed);
                return f32(*seed) / f32(0xffffffffu);
            }
            fn hashHs(seed: ptr<function, u32>) -> vec3f {
                let a = (rand(seed) * 2.0) - 1.0;
                let b = TAU * rand(seed);
                let c = sqrt(max(0.0, 1.0 - a * a));
                return vec3f(c * cos(b), a, c * sin(b));
            }
            fn filmic(x: vec3f) -> vec3f {
                let a = x * (x + 0.0245786) - 0.000090537;
                let b = x * (0.983729 * x + 0.432951) + 0.238081;
                return a / b;
            }
            fn latticeSDF(p: vec3f) -> f32 {
                var pl = p;
                if (u.showTwist > 0.05) {
                    let twist = u.showTwist * 0.25 * sin(u.time * 0.3 + p.y * 0.8);
                    let plxz  = pR(pl.xz, twist);
                    pl = vec3f(plxz.x, pl.y, plxz.y);
                }
                let ql = abs(pl - round(pl - 0.5) - 0.5);
                let g  = min(min(max(ql.x, ql.y), max(ql.x, ql.z)), max(ql.y, ql.z)) - 0.05;
                let c  = min(0.6 - abs(pl.x + pl.z), 0.45 - abs(pl.y));
                return max(g, c);
            }
            fn mapScene(p: vec3f, rot: f32) -> vec3f {
                var d = vec3f(1e9, 0.0, 0.0);
                if (u.showFloor > 0.05) {
                    let f_dist = smin(5.0 - p.z, 1.5 - p.y, 10.0);
                    let f_mat  = 0.1 + 0.3 * step(0.5, (4.0 * p.z) % 1.0);
                    if (f_dist < d.x) { d = vec3f(f_dist, f_mat, 0.0); }
                }
                if (u.showLattice > 0.05) {
                    let lat = latticeSDF(p);
                    if (lat < d.x) { d = vec3f(lat, 0.1, -0.5); }
                }
                if (u.showSphere > 0.05) {
                    var q   = p;
                    let qxy = pR(q.xy, sin(rot) + 0.2);
                    q = vec3f(qxy.x, qxy.y, q.z);
                    let s1 = length(q + vec3f(0.0, 0.0, 2.5)) - 0.5;
                    if (s1 < d.x) { d = vec3f(s1, 0.9, 0.5); }
                    let s2 = length(q + vec3f(0.0, 0.0, 2.5)) - 0.445 - 0.09 * sin(43.0 * q.y);
                    if (s2 < d.x) { d = vec3f(s2, 1.0, 0.1); }
                }
                if (u.showLights > 0.05) {
                    let distort = 0.2 * noise3(10.0 * p);
                    const size  = 0.4;
                    let l1_size = size + u.audioLow * 0.35;
                    let l1 = max(abs(p.z + 2.0) - l1_size, abs(p.x + 2.0) - l1_size) - distort - 0.08;
                    if (l1 < d.x) { d = vec3f(l1, 1.0, 0.35); }
                    let lightSize = 0.6 + u.audioMid * 0.8 + 0.2 * sin(u.time * 2.0);
                    let l2 = max(abs(p.z - 1.2) - lightSize, abs(p.x + 1.2) - lightSize) - distort;
                    if (l2 < d.x) { d = vec3f(l2, 1.0, -0.35); }
                }
                return d;
            }
            fn getCameraAxes(ro: vec3f) -> mat3x3<f32> {
                let fwd   = normalize(vec3f(0.0) - ro);
                let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
                let up    = cross(right, fwd);
                return mat3x3<f32>(right, up, fwd);
            }
            fn flowField(p: vec3f, t: f32) -> vec3f {
                let scale  = 0.4;
                let scroll = t * 0.08;
                let n1 = noise3(p * scale + vec3f(scroll, 0.0,    0.0));
                let n2 = noise3(p * scale + vec3f(0.0,    scroll, 3.7));
                let n3 = noise3(p * scale + vec3f(0.0,    7.3,    scroll));
                return normalize(vec3f(n1, n2, n3) * 2.0 - 1.0);
            }
            fn fftBin(bin: f32) -> f32 {
                return textureSample(fft, samp, vec2f((bin + 0.5) / 128.0, 0.5)).r;
            }
        `)

        .addCompute("computeTex0", `
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = u.resolution.xy;
                if (f32(id.x) >= res.x || f32(id.y) >= res.y) { return; }
                var seed      = pcg_hash(id.x + id.y * u32(res.x) + u32(u.time * 1000.0));
                let rot_time  = u.time * 0.2;
                let k         = vec2f(1.0, -1.0);
                let eps       = 0.001;
                let res_ratio = res.x / res.y;
                let ro = u.ro + vec3f(
                    0.05 * sin(u.time * 0.3),
                    0.03 * sin(u.time * 0.4 + 1.0),
                    0.02 * sin(u.time * 0.5 + 2.0)
                );
                let cam = getCameraAxes(ro);
                var total_radiance = vec3f(0.0);
                var first_t        = 20.0;
                let samples        = i32(u.samples);
                for (var s = 0; s < samples; s++) {
                    var jitter = vec2f(0.0);
                    if (s > 0) { jitter = vec2f(rand(&seed), rand(&seed)) - 0.5; }
                    let p  = (vec2f(f32(id.x), res.y - f32(id.y)) + jitter)
                           * 2.0 / res.y - vec2f(res_ratio, 1.0);
                    var rd = normalize(p.x * cam[0] + p.y * cam[1] + 1.5 * cam[2]);
                    let ryz = pR(rd.yz, 0.2 * sin(rot_time) + 0.2);
                    rd = vec3f(rd.x, ryz.x, ryz.y);
                    let ryx = pR(rd.yx, rot_time * 0.2 * sin(0.3));
                    rd = vec3f(ryx.y, ryx.x, rd.z);
                    var t = 0.0; var m = vec3f(1e9); var hit = false;
                    for (var i = 0; i < 80; i++) {
                        m = mapScene(ro + rd * t, rot_time);
                        t += m.x * 0.5;
                        if (t > 20.0) { break; }
                        if (m.x < 0.001) { hit = true; break; }
                    }
                    if (s == 0) { first_t = t; }
                    if (!hit) {
                        if (u.showFog > 0.05) { total_radiance += vec3f(0.02, 0.02, 0.06) * u.showFog * 0.4; }
                        continue;
                    }
                    let hp = ro + rd * t;
                    let nor = normalize(
                        k.xyy * mapScene(hp + eps * k.xyy, rot_time).x +
                        k.yyx * mapScene(hp + eps * k.yyx, rot_time).x +
                        k.yxy * mapScene(hp + eps * k.yxy, rot_time).x +
                        k.xxx * mapScene(hp + eps * k.xxx, rot_time).x
                    );
                    let col1 = vec3f(1.0 - m.z, 1.0, 1.0 + m.z);
                    let rd2 = normalize(mix(reflect(rd, nor), hashHs(&seed), m.y));
                    var t2 = 0.0; var m2 = vec3f(1e9); var hit2 = false;
                    for (var j = 0; j < 48; j++) {
                        m2 = mapScene(hp + rd2 * t2, rot_time);
                        t2 += m2.x * 0.5;
                        if (t2 > 12.0) { break; }
                        if (m2.x < 0.001) { hit2 = true; break; }
                    }
                    let col2 = vec3f(1.0 - m2.z, 1.0, 1.0 + m2.z);
                    total_radiance += col2 * step(1.0, m2.y) + col1 * step(1.0, m.y);
                    if (hit2) {
                        let hp2 = hp + rd2 * t2;
                        let nor2 = normalize(
                            k.xyy * mapScene(hp2 + eps * k.xyy, rot_time).x +
                            k.yyx * mapScene(hp2 + eps * k.yyx, rot_time).x +
                            k.yxy * mapScene(hp2 + eps * k.yxy, rot_time).x +
                            k.xxx * mapScene(hp2 + eps * k.xxx, rot_time).x
                        );
                        let rd3 = normalize(mix(reflect(rd2, nor2), hashHs(&seed), m2.y));
                        let m3  = mapScene(hp2 + rd3 * 1.5, rot_time);
                        total_radiance += vec3f(1.0 - m3.z, 1.0, 1.0 + m3.z) * step(1.0, m3.y) * 0.4;
                    }
                    if (u.showFog > 0.05) {
                        let fog = 1.0 - exp(-t * 0.08);
                        total_radiance = mix(total_radiance, vec3f(0.02, 0.02, 0.06), fog * u.showFog);
                    }
                }
                textureStore(outTex, id.xy, vec4f(total_radiance / f32(samples), first_t / 20.0));
            }
        `, 0)

        .addCompute("computeTex1",`
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = u.resolution.xy;
                if (f32(id.x) < res.x && f32(id.y) < res.y) { textureStore(outTex, id.xy, vec4f(0.0)); }
                let i = id.x;
                if (i >= u32(u.particleCount) || u.showParticles < 0.05) { return; }
                let ro = u.ro; let cam = getCameraAxes(ro); let cam_fwd = cam[2];
                let b = i * 4u;
                var px = data[b]; var py = data[b+1u]; var pz = data[b+2u]; var pw = data[b+3u];
                let pworld = vec3f(px, py, pz);
                if (length(pworld) > 7.0 || dot(pworld - ro, cam_fwd) < -1.5 || u.time < 0.1) {
                    let angle = fract(f32(i)*0.001)*TAU + u.time*0.15;
                    let radius = 0.3 + fract(f32(i)*0.431)*3.0;
                    px = cos(angle)*radius; py = (fract(f32(i)*0.717)-0.5)*4.0;
                    pz = sin(angle)*radius*0.6 - 1.5; pw = 0.3 + fract(f32(i)*7.7)*0.7;
                }
                let pos = vec3f(px, py, pz); let field = flowField(pos, u.time);
                let speed = 0.006 * pw * u.particleSpeed;
                px += field.x*speed + (-pos.x*0.0003);
                py += field.y*speed + (-pos.y*0.0003);
                pz += field.z*speed + (-pos.z*0.0003);
                data[b]=px; data[b+1u]=py; data[b+2u]=pz; data[b+3u]=pw;
                let rod = u.ro + vec3f(0.05*sin(u.time*0.3), 0.03*sin(u.time*0.4+1.0), 0.02*sin(u.time*0.5+2.0));
                let cd = getCameraAxes(rod); let prel = vec3f(px,py,pz) - rod;
                let pcam = vec3f(dot(prel,cd[0]), dot(prel,cd[1]), dot(prel,cd[2]));
                if (pcam.z <= 0.01) { return; }
                let sx = (pcam.x/(pcam.z*1.5))*0.5+0.5; let sy = (pcam.y/(pcam.z*1.5))*-0.5+0.5;
                let cx = i32(sx*res.x); let cy = i32(sy*res.y);
                if (cx<1||cx>=i32(res.x)-1||cy<1||cy>=i32(res.y)-1) { return; }
                let sdn = textureLoad(computeTex0, vec2i(cx, i32(res.y)-cy), 0).a;
                if (pcam.z > sdn*20.0) { return; }
                let df = saturate((sdn*20.0 - pcam.z)/0.3);
                let tc = saturate(length(vec3f(px,py,pz)-vec3f(0.0,0.0,-2.5))/4.0);
                var pcol = mix(mix(vec3f(1.0,0.85,0.4),vec3f(0.15,0.9,0.8),tc*2.0),
                               mix(vec3f(0.15,0.9,0.8),vec3f(0.1,0.25,1.0),(tc-0.5)*2.0),
                               step(0.5, tc));
                pcol *= (1.0-tc*0.7)*2.5*u.showParticles*df;
                textureStore(outTex, vec2i(cx,cy), vec4f(pcol,1.0));
            }
        `, 16_000 * 4 * 4)

        .addPass("pass_rt", `
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let cur = textureSample(computeTex0, samp, in.uv).rgb;
                let his = textureSample(prev_pass_rt, samp, in.uv).rgb;
                return vec4f(mix(cur, his, 0.75), 1.0);
            }
        `)


        .addPass("pass_fx",`
    @fragment fn main(in: VSOut) -> @location(0) vec4f {
        if (u.sceneId != 1.0) {
            return textureSample(pass_rt, samp, in.uv);
        }

        // ── Fade: full strength until 92%, then out ────────────────────────
        let fade = 1.0 - smoothstep(0.92, 1.0, u.progress);

        // ── Zoom: slow linear push-in, no oscillation ─────────────────────
        // Starts at 1.0, reaches 1.04 by end of scene 1.
        // Feels like the camera is very slowly drifting forward.
        // Audio adds a tiny per-beat micro-pulse on top (< 0.5% range).
        let zoom_base  = 1.0 + u.progress * 0.04 * fade;
        let zoom_pulse = u.audioLow * 0.004 * fade;
        let zoom       = zoom_base + zoom_pulse;
        let zoom_uv    = (in.uv - 0.5) * zoom + 0.5;

        // ── Shake: very subtle, X-only drift ──────────────────────────────
        // Not a sine wave — just a slow wander driven by low-freq audio.
        // Keeps the frame feeling alive without rocking back and forth.
        let shake_x = (u.audioLow - u.audioMid) * 0.004 * fade;
        let shake_y = (u.audioMid - u.audioHigh) * 0.002 * fade;
        let suv     = zoom_uv + vec2f(shake_x, shake_y);

        // ── Block distortion: music-driven, not time-driven ───────────────
        // Each horizontal band gets an X offset.
        // The offset magnitude comes from the FFT bin that corresponds to
        // that band's Y position — so different frequencies distort different
        // vertical regions of the screen simultaneously.
        //
        // band_size  = height of each block in UV space
        // bin_scale  = maps band index → FFT bin (0..127)
        //
        // Wide bands (0.10) for the big cinematic slabs, fine bands (0.025)
        // for the secondary texture layer on top.

        // Wide bands — driven by low/mid bins
        let wide_band  = floor(suv.y / 0.10);
        let wide_bin   = clamp(wide_band * 6.0, 0.0, 60.0);
        let wide_fft   = fftBin(wide_bin);
        // Phase stagger via golden ratio so adjacent bands pull in opposite dirs
        let wide_sign  = select(-1.0, 1.0, fract(wide_band * 0.618) > 0.5);
        let wide_off   = wide_fft * wide_sign * 0.022 * fade;

        // Fine bands — driven by mid/high bins
        let fine_band  = floor(suv.y / 0.025);
        let fine_bin   = clamp(50.0 + fract(fine_band * 0.381) * 40.0, 50.0, 90.0);
        let fine_fft   = fftBin(fine_bin);
        let fine_sign  = select(-1.0, 1.0, fract(fine_band * 1.618) > 0.5);
        let fine_off   = fine_fft * fine_sign * 0.005 * fade;

        let duv = vec2f(
            clamp(suv.x + wide_off + fine_off, 0.001, 0.999),
            clamp(suv.y,                       0.001, 0.999)
        );

        // Sample distorted background
        let bg = textureSample(pass_rt, samp, duv).rgb;

        // Overlay: flip Y, apply same X distortion so text warps with scene
        var col = bg;
        if (u.overlayAlpha > 0.01) {
            let overlay_uv = vec2f(duv.x, 1.0 - duv.y);
            let tx = textureSample(overlay, samp, overlay_uv);
            col = mix(col, tx.rgb, tx.a * u.overlayAlpha);
        }

        return vec4f(col, 1.0);
    }
`)
        .addPass("pass_particles", `
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let dots  = textureSample(computeTex1, samp, in.uv).rgb;
                let old   = textureSample(prev_pass_particles, samp, in.uv).rgb;
                return vec4f(dots + old * 0.6, 1.0);
            }
        `)

        .main(`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let fuv = vec2f(in.uv.x, 1.0 - in.uv.y);

                var col: vec3f;
                if (u.showChroma > 0.05) {
                    let off = (0.0025 + 0.001 * sin(u.time * 0.7)) * u.showChroma;
                    col = vec3f(
                        textureSample(pass_fx, samp, vec2f(fuv.x+off, fuv.y)).r,
                        textureSample(pass_fx, samp, fuv).g,
                        textureSample(pass_fx, samp, vec2f(fuv.x-off, fuv.y)).b
                    );
                } else {
                    col = textureSample(pass_fx, samp, fuv).rgb;
                }

                col *= u.exposure;

                if (u.showFilmic > 0.05) {
                    col = mix(pow(max(col,vec3f(0.0)),vec3f(0.4545)), filmic(col), u.showFilmic);
                } else {
                    col = pow(max(col, vec3f(0.0)), vec3f(0.4545));
                }

                if (u.showParticles > 0.05) {
                    let p = textureSample(pass_particles, samp, fuv).rgb;
                    col = 1.0 - (1.0 - col) * (1.0 - p * 0.6);
                }

                if (u.showVignette > 0.5) {
                    let uvc = fuv - 0.5;
                    col *= clamp(1.0 - dot(uvc,uvc)*2.2, 0.0, 1.0);
                }

                // Scene 1 overlay is handled in pass_fx (text gets distorted).
                // All other scenes (credits etc) composite here cleanly.
                if (u.sceneId != 1.0 && u.overlayAlpha > 0.01) {
                    let tx = textureSample(overlay, samp, in.uv);
                    col = mix(col, tx.rgb, tx.a * u.overlayAlpha);
                }

                return vec4f(col, 1.0);
            }
        `);

    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
        currentAudioMs = audio.getTime() * 1000;

        if (audio.isPlaying) {
            const bytes = getFrequencyBytes(audio);
            updateFftCanvas(bytes);
            app.updateTexture("fft", fftCanvas);

            const fd = audio.getFrequencyData();
            u_audioLow = u_audioLow * 0.7 + fd.low * 0.3;
            u_audioMid = u_audioMid * 0.7 + fd.mid * 0.3;
            u_audioHigh = u_audioHigh * 0.7 + fd.high * 0.3;
        }

        if (activeCard) {
            const changed = tickCard(activeCard, currentAudioMs);
            if (changed) {
                drawCard(activeCard, 1.0);
                app.updateTexture("overlay", activeCard.canvas);
            }
        }

        cb(t);
    });


    mountStartButton(async () => {
   await pipeline.run();
    });
 
};

start();