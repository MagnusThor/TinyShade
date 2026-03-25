/**
 * ──────────────────────────────────────────────────────────────────────────
 *  Lattice of Light — a Fruit of the Loom production
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Timeline (beat-locked to ~129 BPM, 127 494 ms total):
 *
 *    Scene 1 — Title / Intro        0 ms –  23 928 ms   (23.9 s)
 *    Scene 2 — Neutrinos        23 928 ms –  39 868 ms   (15.9 s)
 *    Scene 3 — Through Earth    39 868 ms –  63 773 ms   (23.9 s)
 *    Scene 4 — Quantum Fields   63 773 ms –  88 142 ms   (24.4 s)
 *    Scene 5 — Observer         88 142 ms –  97 869 ms   ( 9.7 s)  ← 2 s donated to s6
 *    Scene 6 — World Itself     97 869 ms – 104 083 ms   ( 6.2 s)  ← gained 2 s
 *    Scene 7 — Black Hole      104 083 ms – 112 047 ms   ( 8.0 s)
 *    Scene 8 — Credits         112 047 ms – 127 494 ms   (15.4 s)
 *
 *  Fixes applied vs previous version:
 *    • Scene 7 corner card fade pushed to p>0.75 so quote lands fully
 *    • BH accretion ring blooms at p=0 but warp drain delayed to p=0.25,
 *      giving a clear "here is the black hole" moment before consumption
 *    • Scene 5 shortened by 2 s, scene 6 gains those 2 s for quote breathing
 *    • pass_rt accumulation factor is audio-reactive (loud bass = sharper)
 *    • Scene 3 nodePull reduced to 0.15, per-particle flow phase added
 *    • Greetings line in credits appears at p≥0.45 (while music still audible)
 *    • Credits scene holds a ghost warp (bhWarp=0.04) for subtle spacetime shimmer
 * ──────────────────────────────────────────────────────────────────────────
 */

import { TinyShade } from "../TinyShade";
import { TSSequencer } from "../TSSequencer";
import { WavAudioPlugin } from "./WavAudioPlugin";
import { UniformLayout } from "../UniformLayout";



import commonWGSL from './demo-wgsl/common.wgsl';
import computeTex0WGSL from './demo-wgsl/computeTex0.wgsl'
import computeTex1WGSL from './demo-wgsl/computeTex1.wgsl'

import pass_rtWGSL from './demo-wgsl/pass_rt.wgsl'

import tunnelWGSL from './demo-wgsl/tunnel.wgsl'

import pass_freezeWGSL from './demo-wgsl/pass_freeze.wgsl'
import pass_bh_warpWGSL from './demo-wgsl/pass_bh_warp.wgsl'
import pass_fxWGSL from './demo-wgsl/pass_fx.wgsl'
import pass_particlesWGSL from './demo-wgsl/pass_particles.wgsl'
import mainWGSL from './demo-wgsl/main.wgsl';



const FFT_SIZE = 128;
const fftCanvas = document.createElement("canvas");
fftCanvas.width = FFT_SIZE;
fftCanvas.height = 1;
const fftCtx = fftCanvas.getContext("2d")!;
const fftImgData = fftCtx.createImageData(FFT_SIZE, 1);

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


function mountStartButton(onPlay: () => void): void {
    const overlay = document.getElementById("start-overlay") as HTMLDivElement | null;
    const btn = document.getElementById("start-btn") as HTMLButtonElement | null;
    if (!overlay || !btn) { onPlay(); return; }
    const handleClick = async () => {
        btn.removeEventListener("click", handleClick);
        try {
            const el = document.documentElement as any;
            const req = el.requestFullscreen ?? el.webkitRequestFullscreen
                ?? el.mozRequestFullScreen ?? el.msRequestFullscreen;
            if (req) await req.call(el);
        } catch { }
        overlay.classList.add("hiding");
        overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
        onPlay();
    };
    btn.addEventListener("click", handleClick);
}



const DESIGN_W = 640;
const DESIGN_H = 360;

const CORNER_FRAC_W = 480 / DESIGN_W;
const CORNER_FRAC_H = 240 / DESIGN_H;
const CORNER_MARGIN_X = 80 / DESIGN_W;
const CORNER_MARGIN_Y = 80 / DESIGN_H;

const BPM = 129;
const BEAT_MS = 60000 / BPM;

const _gpuCanvas = document.getElementById("canvas") as HTMLCanvasElement | null;
const CANVAS_W = _gpuCanvas?.width ?? DESIGN_W;
const CANVAS_H = _gpuCanvas?.height ?? DESIGN_H;

const TEXT_SCALE = CANVAS_H / DESIGN_H;

const OVERLAY_W = CANVAS_W;
const OVERLAY_H = CANVAS_H;
const CORNER_W = Math.round(CANVAS_W * CORNER_FRAC_W);
const CORNER_H = Math.round(CANVAS_H * CORNER_FRAC_H);


interface TextWord { text: string; revealTime: number; opacity: number; }
interface TextLine { words: TextWord[]; y: number; size: number; subtitle: boolean; baseAlpha: number; }
interface TextCard {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    lines: TextLine[];
    startTime: number;
    allRevealed: boolean;
    dirty: boolean;
    isCorner: boolean;
}

function makeCard(
    lines: { text: string; y: number; size: number; subtitle?: boolean; alpha?: number }[],
    wordsPerBeat = 1.0,
    initialDelay = BEAT_MS,
    isCorner = false
): TextCard {
    const w = isCorner ? CORNER_W : OVERLAY_W;
    const h = isCorner ? CORNER_H : OVERLAY_H;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;

    const msPerWord = BEAT_MS / wordsPerBeat;
    let wordIdx = 0;

    const cardLines: TextLine[] = lines.map(l => ({
        y: l.y * TEXT_SCALE, size: l.size * TEXT_SCALE,
        subtitle: l.subtitle ?? false,
        baseAlpha: l.alpha ?? 1.0,
        words: l.text.split(" ").map(w => ({
            text: w,
            revealTime: initialDelay + wordIdx++ * msPerWord,
            opacity: 0,
        }))
    }));

    return { canvas, ctx, lines: cardLines, startTime: 0, allRevealed: false, dirty: true, isCorner };
}

function tickCard(card: TextCard, audioTimeMs: number): boolean {
    const elapsed = audioTimeMs - card.startTime;
    let changed = false, allDone = true;
    for (const line of card.lines) {
        for (const word of line.words) {
            const we = elapsed - word.revealTime;
            let target: number;
            if (we < 0) { target = 0; allDone = false; }
            else if (we < 120) { target = we / 120; allDone = false; }
            else { target = 1; }
            if (Math.abs(target - word.opacity) > 0.005) { word.opacity = target; changed = true; }
        }
    }
    if (!card.allRevealed && allDone) { card.allRevealed = true; changed = true; }
    return changed;
}

function drawCard(card: TextCard, masterAlpha: number): void {
    const { ctx } = card;
    const w = card.canvas.width;
    const h = card.canvas.height;
    ctx.clearRect(0, 0, w, h);

    for (const line of card.lines) {
        ctx.font = `${line.subtitle ? "300" : "bold"} ${line.size}px Inter, system-ui, sans-serif`;

        const totalWidth = line.words.reduce((acc, wd, i) =>
            acc + ctx.measureText(wd.text).width + (i < line.words.length - 1 ? ctx.measureText(" ").width : 0), 0);

        let x = card.isCorner
            ? w - totalWidth - Math.round(w * 0.04)
            : (w - totalWidth) / 2;

        for (let wi = 0; wi < line.words.length; wi++) {
            const word = line.words[wi];
            const alpha = word.opacity * line.baseAlpha * masterAlpha;
            const ww = ctx.measureText(word.text).width;
            if (alpha > 0.001) {
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.fillStyle = "white";
                ctx.textBaseline = "middle";
                ctx.textAlign = "left";
                ctx.shadowColor = "rgba(80, 200, 255, 0.5)";
                ctx.shadowBlur = line.subtitle ? 6 : 18;
                ctx.fillText(word.text, x, line.y);
                ctx.restore();
            }
            x += ww + (wi < line.words.length - 1 ? ctx.measureText(" ").width : 0);
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

    fact2: makeCard([
        { text: "Right now,", y: 18, size: 9, subtitle: true, alpha: 0.55 },
        { text: "65 billion neutrinos", y: 40, size: 15, subtitle: false, alpha: 0.90 },
        { text: "from the sun", y: 62, size: 9, subtitle: true, alpha: 0.65 },
        { text: "pass through your hand", y: 82, size: 9, subtitle: true, alpha: 0.65 },
        { text: "every second.", y: 100, size: 9, subtitle: true, alpha: 0.55 },
    ], 1.5, BEAT_MS * 2, true),

    fact3: makeCard([
        { text: "They pass through the Earth", y: 30, size: 9, subtitle: true, alpha: 0.65 },
        { text: "as if it were not there.", y: 50, size: 9, subtitle: true, alpha: 0.65 },
        { text: "You do not notice.", y: 78, size: 9, subtitle: true, alpha: 0.65 },
        { text: "Neither do they.", y: 102, size: 12, subtitle: false, alpha: 0.85 },
    ], 1.2, BEAT_MS * 2, true),

    tunnelCard: makeCard([
        { text: "We travel not through space,", y: 32, size: 9, subtitle: true, alpha: 0.65 },
        { text: "but through possibility.", y: 52, size: 9, subtitle: true, alpha: 0.65 },
        { text: "A path unfolds", y: 76, size: 9, subtitle: true, alpha: 0.65 },
        { text: "because we move.", y: 100, size: 12, subtitle: false, alpha: 0.85 },
    ], 1.2, BEAT_MS * 2, true),

    fact4: makeCard([
        { text: "Space is not empty.", y: 24, size: 9, subtitle: true, alpha: 0.60 },
        { text: "It is woven from", y: 44, size: 9, subtitle: true, alpha: 0.60 },
        { text: "quantum fields", y: 66, size: 13, subtitle: false, alpha: 0.88 },
        { text: "that stretch across", y: 86, size: 9, subtitle: true, alpha: 0.60 },
        { text: "the entire universe.", y: 104, size: 9, subtitle: true, alpha: 0.55 },
    ], 1.3, BEAT_MS * 3, true),

    fact5: makeCard([
        { text: "The act of observation", y: 32, size: 9, subtitle: true, alpha: 0.60 },
        { text: "changes what is observed.", y: 52, size: 9, subtitle: true, alpha: 0.60 },
        { text: "We are not separate", y: 76, size: 9, subtitle: true, alpha: 0.60 },
        { text: "from the world.", y: 100, size: 12, subtitle: false, alpha: 0.85 },
    ], 1.2, BEAT_MS * 2, true),

    fact6: makeCard([
        { text: "We are the world", y: 42, size: 13, subtitle: false, alpha: 0.90 },
        { text: "observing itself.", y: 66, size: 13, subtitle: false, alpha: 0.90 },
        { text: "— Ulf Danielsson", y: 98, size: 8, subtitle: true, alpha: 0.40 },
    ], 0.9, BEAT_MS * 1.5, true),

    fact7: makeCard([
        { text: "Not our world,", y: 16, size: 10, subtitle: true, alpha: 0.65 },
        { text: "nor neutrinos,", y: 33, size: 10, subtitle: true, alpha: 0.65 },
        { text: "can escape.", y: 54, size: 14, subtitle: false, alpha: 0.92 },
        { text: "Beyond the horizon", y: 76, size: 8, subtitle: true, alpha: 0.55 },
        { text: "the universe ends", y: 91, size: 8, subtitle: true, alpha: 0.55 },
        { text: "its conversation", y: 106, size: 8, subtitle: true, alpha: 0.55 },
        { text: "with itself.", y: 122, size: 11, subtitle: false, alpha: 0.80 },
        { text: "— Ulf Danielsson", y: 140, size: 8, subtitle: true, alpha: 0.35 },
    ], 1.0, BEAT_MS * 1.5, true),


    credits: makeCard([
        { text: "CODE", y: 30, size: 10, subtitle: true, alpha: 0.5 },
        { text: "Bagzy", y: 50, size: 16 },

        { text: "MUSIC", y: 80, size: 10, subtitle: true, alpha: 0.5 },
        { text: "Virgill", y: 100, size: 16 },

        { text: "DIRECTION", y: 130, size: 10, subtitle: true, alpha: 0.5 },
        { text: "Bagzy", y: 150, size: 16 },
    ], 1.0, BEAT_MS * 1.0, true),


    greetings: makeCard([
        { text: "greetings to all our friends in the universe....", y: 425, size: 17, subtitle: true, alpha: 0.36 },
    ], 2.5, BEAT_MS * 2),
};

let activeCard: TextCard | null = null;
let activeCornerCard: TextCard | null = null;

function activateCard(card: TextCard, audioTimeMs: number): void {
    for (const line of card.lines) for (const word of line.words) word.opacity = 0;
    card.allRevealed = false;
    card.dirty = true;
    card.startTime = audioTimeMs;
    if (card.isCorner) activeCornerCard = card;
    else activeCard = card;
}


const F_LATTICE = 1 << 0;  // 1
const F_SPHERE = 1 << 1;  // 2
const F_LIGHTS = 1 << 2;  // 4
const F_FLOOR = 1 << 3;  // 8
const F_FOG = 1 << 4;  // 16
const F_CHROMA = 1 << 5;  // 32
const F_TWIST = 1 << 6;  // 64
const F_FILMIC = 1 << 7;  // 128
const F_PARTICLES = 1 << 8;  // 256
const F_BH = 1 << 9;  // 512
const F_FREEZE = 1 << 10; // 1024


// Example Scene 4: Lattice + Sphere + Lights + Particles
// flags = F_LATTICE | F_SPHERE | F_LIGHTS | F_PARTICLES (val: 263)

/*
let showLattice   = getFlag(u.flags, 0u);
let showSphere    = getFlag(u.flags, 1u);
let showLights    = getFlag(u.flags, 2u);
let showFloor     = getFlag(u.flags, 3u);
let showFog       = getFlag(u.flags, 4u);
let showChroma    = getFlag(u.flags, 5u);
let showTwist     = getFlag(u.flags, 6u);
let showFilmic    = getFlag(u.flags, 7u);
let showParticles = getFlag(u.flags, 8u);
let showBH        = getFlag(u.flags, 9u);
let freezeActive  = getFlag(u.flags, 10u);
*/


const arr_ro = [
    [0.0, 0.5, -5.0],
    [-2.2, -2.6, -5.0],
    [-0.7, -2.2, -4.0],
    [3.0, -5.2, -3.0],
    [-0.4, -0.4, -5.2],
];

let u_ro = [...arr_ro[0]];
let u_samples = 8;
let u_exposure = 1.0;

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

let u_cornerAlpha = 0.0;
let u_audioLow = 0.0;
let u_audioMid = 0.0;
let u_audioHigh = 0.0;
let u_showBlackHole = 0.0;
let u_bhPulse = 0.0;
let u_bhWarp = 0.0;
let u_freezeActive = 0.0;


let u_accumBlend = 0.75;

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => { const c = clamp(t); return c * c * (3 - 2 * c); };
const ease = (t: number) => { const c = clamp(t); return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c; };
const lerp3 = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

let lastSceneId = -1;
let titleBShown = false;
let greetingsShown = false;
let currentAudioMs = 0;

function applyScene(app: TinyShade, sceneId: number, progress: number): void {
    const p = clamp(progress);
    const ep = ease(p);

    if (sceneId !== lastSceneId) {
        lastSceneId = sceneId;
        titleBShown = false;
        greetingsShown = false;

        activeCard = null;
        activeCornerCard = null;

        if (sceneId === 1) { activateCard(cards.titleA, currentAudioMs); }
        else if (sceneId === 2) { activateCard(cards.fact2, currentAudioMs); }
        else if (sceneId === 3) { activateCard(cards.tunnelCard, currentAudioMs); } // NEW
        else if (sceneId === 4) { activateCard(cards.fact3, currentAudioMs); }
        else if (sceneId === 5) { activateCard(cards.fact4, currentAudioMs); }
        else if (sceneId === 6) { activateCard(cards.fact5, currentAudioMs); }
        else if (sceneId === 7) { activateCard(cards.fact6, currentAudioMs); }
        else if (sceneId === 8) { activateCard(cards.fact7, currentAudioMs); }
        else if (sceneId === 9) { activateCard(cards.credits, currentAudioMs); }
    }

    u_accumBlend = clamp(0.75 - u_audioLow * 0.3, 0.35, 0.75);

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
            u_particleCount = 1_200;
            u_particleSpeed = 0.2;
            u_showBlackHole = 0.0;
            u_bhPulse = 0.0;
            u_bhWarp = 0.0;
            u_freezeActive = 0.0;

            u_ro = [arr_ro[0][0], arr_ro[0][1] + 0.5, arr_ro[0][2] - 2.5];
            u_exposure = 1.0 + 0.08 * Math.sin(currentAudioMs * 0.002);

            if (p >= 0.5 && !titleBShown) { titleBShown = true; activateCard(cards.titleB, currentAudioMs); }
            if (p < 0.5 && titleBShown) { titleBShown = false; activateCard(cards.titleA, currentAudioMs); }

            u_overlayAlpha = p < 0.08 ? smooth(p / 0.08) : p > 0.92 ? smooth((1 - p) / 0.08) : 1.0;
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
            u_showBlackHole = 0.0;
            u_bhPulse = 0.0;
            u_bhWarp = 0.0;
            u_freezeActive = 0.0;

            u_particleCount = 5_000;
            u_particleSpeed = 0.5 + ep * 0.4;

            u_overlayAlpha = 0.0;
            u_showFloor = 0.0;
            u_showLattice = 0.0;

            u_exposure = 1.4;
            u_ro = lerp3(arr_ro[0], arr_ro[1], ep * 0.15);

            u_cornerAlpha = p < 0.30 ? smooth(p / 0.30) : p > 0.85 ? smooth((1 - p) / 0.15) : 1.0;
            break;
        }

        // 🚀 NEW SCENE 3 — TUNNEL
        case 3: {
            u_showFloor = 0.0;
            u_showLattice = 0.0;
            u_showSphere = 0.0;
            u_showLights = 0.0;
            u_showFog = 0.0;

            u_showParticles = 0.0;

            u_showChroma = 0.3;
            u_showTwist = 1.0;
            u_showFilmic = 1.0;

            u_showBlackHole = 0.0;
            u_bhPulse = 0.0;
            u_bhWarp = 0.0;
            u_freezeActive = 0.0;

            u_exposure = 1.2 + ep * 0.4;

            // forward motion
            u_ro = [0.0, 0.0, -5.0 + ep * 12.0];

            u_cornerAlpha =
                p < 0.2 ? smooth(p / 0.2)
                    : p > 0.85 ? smooth((1 - p) / 0.15)
                        : 1.0;

            break;
        }

        case 4: {
            u_showFloor = 0.0;
            u_showLattice = 1.0;
            u_showFog = 0.5 + smooth(p) * 0.3;
            u_showChroma = 0.0;
            u_showTwist = 0.0;
            u_showParticles = 1.0;

            u_showBlackHole = 0.0;
            u_bhPulse = 0.0;
            u_bhWarp = 0.0;
            u_freezeActive = 0.0;

            u_particleCount = 6_000;
            u_particleSpeed = 0.5 + ep * 0.3;

            u_overlayAlpha = 0.0;

            u_showSphere = smooth(p * 2.0);
            u_showLights = smooth(clamp((p - 0.2) / 0.8));
            u_showFilmic = smooth(clamp((p - 0.35) / 0.65));

            u_exposure = 1.1 + ep * 0.5;
            u_ro = lerp3(arr_ro[0], arr_ro[1], ep * 0.5);

            u_cornerAlpha = p < 0.25 ? smooth(p / 0.25) : p > 0.85 ? smooth((1 - p) / 0.15) : 1.0;
            break;
        }

        // shift rest ↓↓↓


        case 5: {
            u_showFloor = 0.0;
            u_showLattice = 1.0;
            u_showSphere = 1.0;
            u_showLights = 1.0;
            u_showFog = 0.0;
            u_showFilmic = 1.0;
            u_showParticles = 1.0;
            u_showBlackHole = 0.0;
            u_bhPulse = 0.0;
            u_bhWarp = 0.0;
            u_freezeActive = 0.0;
            u_particleCount = 15_000;
            u_overlayAlpha = 0.0;
            u_showTwist = 1.2;
            u_showChroma = smooth(clamp((p - 0.45) / 0.55));
            u_particleSpeed = 0.8 + ep * 0.9;
            u_exposure = 1.2 + ep * 0.3;
            u_ro = lerp3(arr_ro[1], arr_ro[3], ease(p));
            u_cornerAlpha = p < 0.35 ? smooth(p / 0.35) : p > 0.80 ? smooth((1 - p) / 0.20) : 1.0;
            break;
        } case 6: {
            u_showFloor = 0.0;
            u_showLattice = 1.0;
            u_showSphere = 1.0;
            u_showLights = 1.0;
            u_showFilmic = 1.0;
            u_showParticles = 1.0;
            u_showBlackHole = 0.0;
            u_bhPulse = 0.0;
            u_bhWarp = 0.0; u_freezeActive = 0.0; u_particleCount = 6_000; u_overlayAlpha = 0.0; u_showFog = smooth(clamp((p - 0.5) / 0.5)) * 0.8; u_showTwist = 1.0 - smooth(p); u_showChroma = smooth(clamp(1.0 - p * 1.3, 0.0, 1.0)); u_particleSpeed = 1.4 - ep * 0.6; u_exposure = 1.1 - ep * 0.2; u_ro = lerp3(arr_ro[3], arr_ro[2], ep); u_cornerAlpha = p < 0.30 ? smooth(p / 0.30) : p > 0.80 ? smooth((1 - p) / 0.20) : 1.0; break;
        }
        case 7: {
            u_showFloor = 0.0;
            u_showLattice = 1.0;
            u_showSphere = 1.0;
            u_showLights = 1.0;
            u_showFog = 0.0;
            u_showFilmic = 1.0;
            u_showChroma = 1.0;
            u_showParticles = 1.0;
            u_showBlackHole = 0.0;
            u_bhPulse = 0.0;
            u_bhWarp = 0.0;
            u_freezeActive = 0.0;
            u_particleCount = 18_000;
            u_overlayAlpha = 0.0;
            u_showTwist = 0.8;
            u_particleSpeed = 1.2 + ep * 0.6;
            u_exposure = 1.0 + 0.25 * Math.sin(p * Math.PI);
            u_ro = lerp3(arr_ro[2], arr_ro[4], ep);
            u_cornerAlpha = p < 0.35 ? smooth(p / 0.35) : p > 0.85 ? smooth((1 - p) / 0.15) : 1.0;
            break;
        }
        case 8: {
            u_showFloor = 0.0;
            u_showLattice = 0.0;
            u_showSphere = 0.0;
            u_showLights = 0.0;
            u_showFog = 0.0;
            u_showFilmic = 1.0;
            u_showChroma = 0.0;
            u_showTwist = 0.0;
            u_showParticles = smooth(clamp(1.0 - p * 2.0, 0.0, 1.0));
            u_particleCount = 6_000;
            u_particleSpeed = 0.8 + ep * 2.0; u_freezeActive = 1.0;
            u_showBlackHole = smooth(p);
            u_bhPulse = u_audioLow * 0.6 + u_audioMid * 0.3 + u_audioHigh * 0.1;
            const warpOnset = clamp((p - 0.25) / 0.75);
            const warpBase = smooth(smooth(warpOnset));
            u_bhWarp = clamp(warpBase + u_audioLow * 0.04, 0.0, 1.0);
            u_overlayAlpha = 0.0;
            u_ro = [...arr_ro[4]];
            if (p < 0.25) { u_exposure = 1.2; }
            else {
                u_exposure = 1.2 * (1.0 - smooth((p - 0.25) / 0.75) * 0.8);

            }
            u_cornerAlpha = p < 0.20 ? smooth(p / 0.20) : p > 0.75 ? smooth((1 - p) / 0.25) : 1.0;
            break;
        }
        case 9: {
            u_showFloor = 0.0;
            u_showLattice = 0.0;
            u_showSphere = 0.0;
            u_showLights = 0.0;
            u_showFog = 0.0;
            u_showFilmic = 1.0;
            u_showTwist = 0.0;
            u_showChroma = 0.0;
            u_showParticles = 0.0;
            u_particleCount = 0;
            u_particleSpeed = 0.0;
            u_freezeActive = 1.0;
            u_bhWarp = 0.0;
            u_showBlackHole = p > 0.90 ? smooth((1.0 - p) / 0.10) : 1.0;
            u_bhPulse = u_audioLow * 0.8 + u_audioMid * 0.3;
            u_exposure = 0.5;
            u_overlayAlpha = p < 0.10 ? smooth(p / 0.10) : 1.0;
            u_cornerAlpha = p < 0.10 ? smooth(p / 0.10) : p > 0.90 ? smooth((1.0 - p) / 0.10) : 1.0;
            u_ro = [...arr_ro[0]];
            if (p >= 0.45 && !greetingsShown) {
                greetingsShown = true; activateCard(cards.greetings, currentAudioMs);
            }
            break;
        }
    }
    const beat = u_audioLow * 0.7 + u_audioMid * 0.3;
    u_particleSpeed *= 1.0 + beat * 0.15;
    u_exposure += beat * 0.08;

}






const start = async () => {
    const app = await TinyShade.create("canvas");
    const audio = new WavAudioPlugin();
    await audio.load("assets/song.mp3");

    const TOTAL_LENGTH_MS = 127_494;
    const seq = new TSSequencer([], TOTAL_LENGTH_MS, BPM, 4);
    const L = TOTAL_LENGTH_MS;

    seq.timeline = [
        [seq.getUnitsFromMs(23_928, L), 0x0001, 1],
        [seq.getUnitsFromMs(15_940, L), 0x0002, 2],

        [seq.getUnitsFromMs(15_000, L), 0x0010, 3],

        [seq.getUnitsFromMs(18_000, L), 0x0004, 4],

        [seq.getUnitsFromMs(20_000, L), 0x00FF, 5],

        [seq.getUnitsFromMs(9_727, L), 0x0008, 6],
        [seq.getUnitsFromMs(6_214, L), 0x00FF, 7],
        [seq.getUnitsFromMs(7_964, L), 0x00FF, 8],
        [seq.getUnitsFromMs(15_447, L), 0x0000, 9],

        [255, 0x0000, 0],
    ];


    await app.addTexture("overlay", cards.titleA.canvas);
    await app.addTexture("corner", cards.fact2.canvas);
    await app.addTexture("fft", fftCanvas);

    seq.onUpdate = (state) => {

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
            if (tickCard(activeCard, currentAudioMs)) {
                drawCard(activeCard, 1.0);
                app.updateTexture("overlay", activeCard.canvas);
            }
        }

        if (activeCornerCard) {
            if (tickCard(activeCornerCard, currentAudioMs)) {
                drawCard(activeCornerCard, 1.0);
                app.updateTexture("corner", activeCornerCard.canvas);
            }
        }

        applyScene(app, state.sceneId, state.progress)
    };


    /**
 * Processes all float-based scene transitions into a single 4-float array (vec4f).
 * Returns: [exposure, particleSpeed, bhWarp, accumBlend/Misc]
 */
    const getSceneParams = (sceneId: number, p: number): number[] => {



        if (audio.isPlaying) {
            const bytes = getFrequencyBytes(audio);
            updateFftCanvas(bytes);
            app.updateTexture("fft", fftCanvas);
            const fd = audio.getFrequencyData();
            u_audioLow = u_audioLow * 0.7 + fd.low * 0.3;
            u_audioMid = u_audioMid * 0.7 + fd.mid * 0.3;
            u_audioHigh = u_audioHigh * 0.7 + fd.high * 0.3;
        }



        const ep = ease(p);
        let exp = 1.0, spd = 0.5, warp = 0.0, acc = 0.75;


        acc = clamp(0.75 - u_audioLow * 0.3, 0.35, 0.75);

        switch (sceneId) {
            case 1: // Intro
                exp = 1.0 + 0.08 * Math.sin(currentAudioMs * 0.002);
                spd = 0.2;
                break;

            case 2: // Neutrinos
                exp = 1.4;
                spd = 0.5 + ep * 0.4;
                break;

            case 3: // Tunnel
                exp = 1.2 + ep * 0.4;
                spd = 0.0; // Particles hidden here
                break;

            case 4: // Quantum Fields
                exp = 1.1 + ep * 0.5;
                spd = 0.5 + ep * 0.3;
                break;

            case 5: // Observer
                exp = 1.2 + ep * 0.3;
                spd = 0.8 + ep * 0.9;
                break;

            case 6: // World Itself
                exp = 1.1 - ep * 0.2;
                spd = 1.4 - ep * 0.6;
                break;

            case 7: // Final Quote
                exp = 1.0 + 0.25 * Math.sin(p * Math.PI);
                spd = 1.2 + ep * 0.6;
                break;

            case 8: // Black Hole Horizon
                const warpOnset = clamp((p - 0.25) / 0.75);
                exp = (p < 0.25) ? 1.2 : 1.2 * (1.0 - smooth(warpOnset) * 0.8);
                spd = 0.8 + ep * 2.0;
                warp = clamp(smooth(smooth(warpOnset)) + u_audioLow * 0.04, 0.0, 1.0);
                break;

            case 9: // Credits
                exp = 0.5;
                spd = 0.0;
                warp = 0.0;
                break;
        }

        return [exp, spd, warp, acc];
    };





    const uniforms = (l: UniformLayout) => {
        l.addUniform({ name: "p1", value: () => getSceneParams(seq.state?.sceneId || -1, seq.state?.progress || 0) });
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
        l.addUniform({ name: "cornerAlpha", value: () => u_cornerAlpha });
        l.addUniform({ name: "audioLow", value: () => u_audioLow });
        l.addUniform({ name: "audioMid", value: () => u_audioMid });
        l.addUniform({ name: "audioHigh", value: () => u_audioHigh });
        l.addUniform({ name: "showBlackHole", value: () => u_showBlackHole });
        l.addUniform({ name: "bhPulse", value: () => u_bhPulse });
        l.addUniform({ name: "bhWarp", value: () => u_bhWarp });
        l.addUniform({ name: "freezeActive", value: () => u_freezeActive });
        l.addUniform({ name: "accumBlend", value: () => u_accumBlend });
        l.addUniform({ name: "cornerFracW", value: () => CORNER_FRAC_W });
        l.addUniform({ name: "cornerFracH", value: () => CORNER_FRAC_H });
        l.addUniform({ name: "cornerMarginX", value: () => CORNER_MARGIN_X });
        l.addUniform({ name: "cornerMarginY", value: () => CORNER_MARGIN_Y });

    };

    const pipeline = await app
        .setUniforms(uniforms)
        .addAudio(audio)
        .addSequencer(seq)

        .addCommon(commonWGSL
        )

        .addPass("pass_tunnel", tunnelWGSL, [])


        .addCompute("computeTex0", computeTex0WGSL, 0, [])

        .addCompute("computeTex1", computeTex1WGSL
            , 32_000 * 4 * 4, ["computeTex0"])

        .addPass("pass_rt", pass_rtWGSL, ["pass_rt", "pass_rt", "computeTex0"])

        .addPass("pass_freeze", pass_freezeWGSL, ["pass_rt", "pass_freeze"])

        .addPass("pass_bh_warp", pass_bh_warpWGSL, ["pass_freeze"])

        .addPass("pass_fx", pass_fxWGSL, ["pass_rt", "pass_bh_warp", "overlay", "pass_tunnel"])

        .addPass("pass_particles", pass_particlesWGSL, ["computeTex0", "computeTex1", "pass_particles"])

        .main(mainWGSL, ["overlay", "pass_fx", "computeTex0", "pass_particles", "pass_tunnel"]);



    mountStartButton(async () => {


        await pipeline.run();

    });




};

start();