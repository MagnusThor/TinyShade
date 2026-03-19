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
import { createTimelineDebug } from "../ui/createTimelineDebug";



// ── FFT canvas ──────────────────────────────────────────────────────────────
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


// ── Start / fullscreen ──────────────────────────────────────────────────────
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



// ── Canvas dimensions ───────────────────────────────────────────────────────
const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Corner fractions — resolution-independent.
// At 1280×720: width=480px, height=240px, margins=80px each side.
const CORNER_FRAC_W = 480 / CANVAS_W;
const CORNER_FRAC_H = 240 / CANVAS_H;
const CORNER_MARGIN_X = 80 / CANVAS_W;
const CORNER_MARGIN_Y = 80 / CANVAS_H;

const BPM = 129;
const BEAT_MS = 60000 / BPM;

// Logical canvas sizes for 2D text rendering
const OVERLAY_W = CANVAS_W;
const OVERLAY_H = CANVAS_H;
const CORNER_W = Math.round(CANVAS_W * CORNER_FRAC_W);   // 300 px
const CORNER_H = Math.round(CANVAS_H * CORNER_FRAC_H);   // 150 px


// ── Text-card system ────────────────────────────────────────────────────────
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
        y: l.y, size: l.size,
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

// ── All text cards ──────────────────────────────────────────────────────────
// Corner cards are laid out in CORNER_W × CORNER_H space (300 × 150 px).
// Overlay cards are laid out in OVERLAY_W × OVERLAY_H space (800 × 450 px).
const cards = {

    // Scene 1 — full-screen
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

    // Scene 2 — corner (300 × 150)
    fact2: makeCard([
        { text: "Right now,", y: 18, size: 9, subtitle: true, alpha: 0.55 },
        { text: "65 billion neutrinos", y: 40, size: 15, subtitle: false, alpha: 0.90 },
        { text: "from the sun", y: 62, size: 9, subtitle: true, alpha: 0.65 },
        { text: "pass through your hand", y: 82, size: 9, subtitle: true, alpha: 0.65 },
        { text: "every second.", y: 100, size: 9, subtitle: true, alpha: 0.55 },
    ], 1.5, BEAT_MS * 2, true),

    // Scene 3 — corner
    fact3: makeCard([
        { text: "They pass through the Earth", y: 30, size: 9, subtitle: true, alpha: 0.65 },
        { text: "as if it were not there.", y: 50, size: 9, subtitle: true, alpha: 0.65 },
        { text: "You do not notice.", y: 78, size: 9, subtitle: true, alpha: 0.65 },
        { text: "Neither do they.", y: 102, size: 12, subtitle: false, alpha: 0.85 },
    ], 1.2, BEAT_MS * 2, true),

    // Scene 4 — corner
    fact4: makeCard([
        { text: "Space is not empty.", y: 24, size: 9, subtitle: true, alpha: 0.60 },
        { text: "It is woven from", y: 44, size: 9, subtitle: true, alpha: 0.60 },
        { text: "quantum fields", y: 66, size: 13, subtitle: false, alpha: 0.88 },
        { text: "that stretch across", y: 86, size: 9, subtitle: true, alpha: 0.60 },
        { text: "the entire universe.", y: 104, size: 9, subtitle: true, alpha: 0.55 },
    ], 1.3, BEAT_MS * 3, true),

    // Scene 5 — corner
    fact5: makeCard([
        { text: "The act of observation", y: 32, size: 9, subtitle: true, alpha: 0.60 },
        { text: "changes what is observed.", y: 52, size: 9, subtitle: true, alpha: 0.60 },
        { text: "We are not separate", y: 76, size: 9, subtitle: true, alpha: 0.60 },
        { text: "from the world.", y: 100, size: 12, subtitle: false, alpha: 0.85 },
    ], 1.2, BEAT_MS * 2, true),

    // Scene 6 — corner (now 6.2 s, quote has room to breathe)
    fact6: makeCard([
        { text: "We are the world", y: 42, size: 13, subtitle: false, alpha: 0.90 },
        { text: "observing itself.", y: 66, size: 13, subtitle: false, alpha: 0.90 },
        { text: "— Ulf Danielsson", y: 98, size: 8, subtitle: true, alpha: 0.40 },
    ], 0.9, BEAT_MS * 1.5, true),

    // Scene 7 — corner (black hole narrative)
    // Card fades at p>0.75 so the Danielsson attribution has time to land.
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

    // Scene 8 — credits (full-screen)
    // credits: makeCard([
    //     { text: "CODE & VISUALS",  y: 118, size: 17, subtitle: true,  alpha: 0.45 },
    //     { text: "Bagzy",           y: 154, size: 46, subtitle: false, alpha: 0.92 },
    //     { text: "MUSIC",           y: 218, size: 17, subtitle: true,  alpha: 0.45 },
    //     { text: "Virgill",         y: 254, size: 46, subtitle: false, alpha: 0.92 },
    //     { text: "DIRECTION",       y: 318, size: 17, subtitle: true,  alpha: 0.45 },
    //     { text: "Bagzy",           y: 354, size: 46, subtitle: false, alpha: 0.92 },
    // ], 0.7, BEAT_MS * 1.5),

    credits: makeCard([
        { text: "CODE", y: 30, size: 10, subtitle: true, alpha: 0.5 },
        { text: "Bagzy", y: 50, size: 16 },

        { text: "MUSIC", y: 80, size: 10, subtitle: true, alpha: 0.5 },
        { text: "Virgill", y: 100, size: 16 },

        { text: "DIRECTION", y: 130, size: 10, subtitle: true, alpha: 0.5 },
        { text: "Bagzy", y: 150, size: 16 },
    ], 1.0, BEAT_MS * 1.0, true),


    // Greetings — now at p≥0.45 so it arrives while music is still faintly audible
    greetings: makeCard([
        { text: "greetings to all our friends in universe....", y: 425, size: 17, subtitle: true, alpha: 0.36 },
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



// ── Camera positions ────────────────────────────────────────────────────────
const arr_ro = [
    [0.0, 0.5, -5.0],
    [-2.2, -2.6, -5.0],
    [-0.7, -2.2, -4.0],
    [3.0, -5.2, -3.0],
    [-0.4, -0.4, -5.2],
];

// ── Uniform state ───────────────────────────────────────────────────────────
let u_ro = [...arr_ro[0]];
let u_samples = 16;
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
let u_cornerAlpha = 0.0;
let u_audioLow = 0.0;
let u_audioMid = 0.0;
let u_audioHigh = 0.0;
let u_showBlackHole = 0.0;
let u_bhPulse = 0.0;
let u_bhWarp = 0.0;
let u_freezeActive = 0.0;
// Audio-reactive accumulation blend factor for pass_rt.
// Base 0.75; loud bass transients reduce it toward 0.35 for sharper image.
let u_accumBlend = 0.75;

// ── Helpers ─────────────────────────────────────────────────────────────────
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => { const c = clamp(t); return c * c * (3 - 2 * c); };
const ease = (t: number) => { const c = clamp(t); return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c; };
const lerp3 = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

let lastSceneId = -1;
let titleBShown = false;
let greetingsShown = false;
let currentAudioMs = 0;

// ── Scene logic ─────────────────────────────────────────────────────────────
function applyScene(app: TinyShade, sceneId: number, progress: number): void {
    const p = clamp(progress);
    const ep = ease(p);

    if (sceneId !== lastSceneId) {
        lastSceneId = sceneId;
        titleBShown = false;
        greetingsShown = false;

        if (sceneId === 1) activateCard(cards.titleA, currentAudioMs);
        else if (sceneId === 8) {
            activateCard(cards.credits, currentAudioMs);
            activeCornerCard = cards.credits;
            activeCard = null;
        }
        else activeCard = null;

        if (sceneId === 2) activateCard(cards.fact2, currentAudioMs);
        else if (sceneId === 3) activateCard(cards.fact3, currentAudioMs);
        else if (sceneId === 4) activateCard(cards.fact4, currentAudioMs);
        else if (sceneId === 5) activateCard(cards.fact5, currentAudioMs);
        else if (sceneId === 6) activateCard(cards.fact6, currentAudioMs);
        else if (sceneId === 7) activateCard(cards.fact7, currentAudioMs);
        else activeCornerCard = null;
    }

    // Audio-reactive accumulation: bass transients momentarily sharpen the image,
    // giving a nice reactive pulse on the beat without full temporal jitter.
    //u_accumBlend = clamp(0.75 - u_audioLow * 0.3, 0.35, 0.75);

    u_accumBlend = clamp(0.6 - u_audioLow * 0.25, 0.25, 0.6);

    switch (sceneId) {

        case 1: {
            u_showLattice = 0.0;
            u_showSphere = 0.0;
            u_showLights = 0.0;
            u_showFloor = 1.0;
            u_showFog = .4;  //1.0
            u_showChroma = 0.0;
            u_showTwist = 0.0;
            u_showFilmic = 0.0;
            u_showParticles = 1.0;
            u_particleCount = 1_200;  //2_000
            u_particleSpeed = 0.2;
            u_showBlackHole = 0.0;
            u_bhPulse = 0.0;
            u_bhWarp = 0.0;
            u_freezeActive = 0.0;
            u_ro = [arr_ro[0][0], arr_ro[0][1] + 0.5, arr_ro[0][2] - 2.5];

            //u_exposure = smooth(p) * 0.8; u_cornerAlpha = 0.0;
            u_exposure *= 0.9 + 0.1 * Math.sin(currentAudioMs * 0.002);

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
            u_particleCount = 5_000; // 4_000 
            u_particleSpeed = 0.5 + ep * 0.4;
            //u_particleSpeed *= 1.2;
            u_overlayAlpha = 0.0;
            u_showFloor = smooth(p * 2.0);
            u_showLattice = smooth(clamp((p - 0.1) / 0.9));
            u_exposure = 0.6 + ep * 0.7;
            u_ro = lerp3(arr_ro[0], arr_ro[1], ep * 0.15);
            u_cornerAlpha = p < 0.30 ? smooth(p / 0.30) : p > 0.85 ? smooth((1 - p) / 0.15) : 1.0;

            break;
        }

        case 3: {
            // nodePull reduced to 0.15 — prevents particle clustering at lattice nodes
            u_showFloor = 1.0;
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
            // u_ro         = lerp3(arr_ro[0], arr_ro[1], ep * 0.7);
            u_ro = lerp3(arr_ro[0], arr_ro[1], ep * 0.5);
            u_cornerAlpha = p < 0.25 ? smooth(p / 0.25) : p > 0.85 ? smooth((1 - p) / 0.15) : 1.0;
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
            u_showBlackHole = 0.0;
            u_bhPulse = 0.0;
            u_bhWarp = 0.0;
            u_freezeActive = 0.0;
            u_particleCount = 15_000; // 10_000 
            u_overlayAlpha = 0.0;
            u_showTwist = 1.2//smooth(clamp(p / 0.5));
            u_showChroma = smooth(clamp((p - 0.45) / 0.55));
            u_particleSpeed = 0.8 + ep * 0.9;

            //u_exposure = 1.4 + ep * 0.5;

            u_exposure = 1.2 + ep * 0.3;

            //u_exposure *= 1.15;

            u_ro = lerp3(arr_ro[1], arr_ro[3], ease(p));
            u_cornerAlpha = p < 0.35 ? smooth(p / 0.35) : p > 0.80 ? smooth((1 - p) / 0.20) : 1.0;
            break;
        }

        case 5: {
            // 9.7 s (donated 2 s to scene 6)
            u_showFloor = 1.0;
            u_showLattice = 1.0;
            u_showSphere = 1.0;
            u_showLights = 1.0;
            u_showFilmic = 1.0;
            u_showParticles = 1.0;
            u_showBlackHole = 0.0;
            u_bhPulse = 0.0;
            u_bhWarp = 0.0;
            u_freezeActive = 0.0;
            u_particleCount = 6_000;
            u_overlayAlpha = 0.0;
            u_showFog = smooth(clamp((p - 0.5) / 0.5)) * 0.8;
            u_showTwist = 1.0 - smooth(p);
            u_showChroma = smooth(clamp(1.0 - p * 1.3, 0.0, 1.0));
            u_particleSpeed = 1.4 - ep * 0.6;
            u_exposure *= 0.85// 1.8 - ep * 0.4;
            u_ro = lerp3(arr_ro[3], arr_ro[2], ep);
            u_cornerAlpha = p < 0.30 ? smooth(p / 0.30) : p > 0.80 ? smooth((1 - p) / 0.20) : 1.0;
            break;
        }

        case 6: {
            // 6.2 s — enough time for the Danielsson quote to reveal and sit
            u_showFloor = 1.0;
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
            u_showTwist = 0.8;//smooth(p); 
            u_particleSpeed = 1.2 + ep * 0.6;
            //u_exposure  = 1.4 + Math.sin(p * Math.PI) * 0.8;
            u_exposure *= 1.0 + 0.3 * Math.sin(p * Math.PI);

            u_ro = lerp3(arr_ro[2], arr_ro[4], ep);
            u_cornerAlpha = p < 0.35 ? smooth(p / 0.35) : p > 0.85 ? smooth((1 - p) / 0.15) : 1.0;
            break;
        }

        case 7: {
            // Geometry OFF — frozen world drains into singularity.
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
            u_particleSpeed = 0.8 + ep * 2.0;
            u_freezeActive = 1.0;

            u_showBlackHole = smooth(p);
            u_bhPulse = u_audioLow * 0.6 + u_audioMid * 0.3 + u_audioHigh * 0.1;

            const warpOnset = clamp((p - 0.25) / 0.75);

            //u_bhWarp        = smooth(smooth(warpOnset));   // double-smooth for sharp finish

            u_bhWarp += u_audioLow * 0.2;

            u_overlayAlpha = 0.0;
            u_ro = [...arr_ro[4]];

            if (p < 0.25) {
                u_exposure *= 1.2;
            } else {
                u_exposure *= 1.0 - smooth((p - 0.25) / 0.75) * 0.8;
            }
            //      u_exposure      = 1.5 * (1.0 - smooth(p * 0.9));


            u_cornerAlpha = p < 0.20 ? smooth(p / 0.20) : p > 0.75 ? smooth((1 - p) / 0.25) : 1.0;
            break;
        }

        case 8: {
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

            u_bhWarp = 0.04;
            u_showBlackHole = smooth(clamp(1.0 - p * 2.5, 0.0, 1.0));
            u_bhPulse = 0.0;

            //u_exposure      = smooth(clamp(1.0 - p * 1.2, 0.0, 1.0)) * 0.4;

            u_exposure = smooth(clamp(1.0 - p * 1.2, 0.0, 1.0)) * 0.3;


            u_overlayAlpha = p < 0.10 ? smooth(p / 0.10) : 1.0;
            u_cornerAlpha = 0.0;
            u_ro = [...arr_ro[0]];

            if (p >= 0.45 && !greetingsShown) {
                greetingsShown = true;
                activateCard(cards.greetings, currentAudioMs);
            }
            break;
        }
    }
    const beat = u_audioLow * 0.7 + u_audioMid * 0.3;

    u_particleSpeed *= 1.0 + beat * 0.15;
    u_exposure *= 1.0 + beat * 0.1;
}



// ── Boot ────────────────────────────────────────────────────────────────────
const start = async () => {
    const app = await TinyShade.create("canvas");
    const audio = new WavAudioPlugin();
    await audio.load("assets/song.mp3");

    const TOTAL_LENGTH_MS = 127_494;
    const seq = new TSSequencer([], TOTAL_LENGTH_MS, BPM, 4);
    const L = TOTAL_LENGTH_MS;

    // Scene 5 shortened by 2 000 ms, scene 6 gains those 2 000 ms.
    // All other durations unchanged. Total still = 127 494 ms.
    seq.timeline = [
        [seq.getUnitsFromMs(23_928, L), 0x0001, 1],   // 0     – 23 928
        [seq.getUnitsFromMs(15_940, L), 0x0002, 2],   // 23 928 – 39 868
        [seq.getUnitsFromMs(23_905, L), 0x0004, 3],   // 39 868 – 63 773
        [seq.getUnitsFromMs(24_369, L), 0x00FF, 4],   // 63 773 – 88 142
        [seq.getUnitsFromMs(9_727, L), 0x0008, 5],   // 88 142 – 97 869  (was 11 727)
        [seq.getUnitsFromMs(6_214, L), 0x00FF, 6],   // 97 869 – 104 083 (was  4 214)
        [seq.getUnitsFromMs(7_964, L), 0x00FF, 7],   // 104 083 – 112 047
        [seq.getUnitsFromMs(15_447, L), 0x0000, 8],   // 112 047 – 127 494
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

    let u_sceneTint = [1.0, 1.0, 1.0];


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

        .addCommon(`
            const PI:  f32 = 3.141592654;
            const TAU: f32 = 6.283185307;

            fn noise3(p: vec3f) -> f32 {
                let ip = floor(p); var fp = p - ip;
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
                let g  = min(min(max(ql.x, ql.y), max(ql.x, ql.z)), max(ql.y, ql.z)) - 0.04;
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
                    let s1 = length(q + vec3f(0.0, 0.0, 2.5)) - 0.48;
                    if (s1 < d.x) { d = vec3f(s1, 0.9, 0.5); }
                    let s2 = length(q + vec3f(0.0, 0.0, 2.5)) - 0.425 - 0.09 * sin(43.0 * q.y);
                    if (s2 < d.x) { d = vec3f(s2, 1.0, 0.1); }
                }
                if (u.showLights > 0.05) {
                    let distort = 0.2 * noise3(10.0 * p);
                    const size  = 0.4;
                    let l1_size = size + u.audioLow * 0.35;
                    let l1 = max(abs(p.z + 2.0) - l1_size, abs(p.x + 2.0) - l1_size) - distort - 0.06;
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
            fn fftBin(bin: f32) -> f32 {
                return textureSample(fft, samp, vec2f((bin + 0.5) / 128.0, 0.5)).r;
            }
            fn curlNoise(p: vec3f, t: f32) -> vec3f {
                let e  = 0.1; let sc = 0.55; let scroll = t * 0.06;
                let nx_dy = noise3((p + vec3f(0.0,e,0.0)) * sc + vec3f(scroll,0.0,0.0));
                let nx_dz = noise3((p + vec3f(0.0,0.0,e)) * sc + vec3f(scroll,0.0,0.0));
                let ny_dx = noise3((p + vec3f(e,0.0,0.0)) * sc + vec3f(0.0,scroll,3.7));
                let ny_dz = noise3((p + vec3f(0.0,0.0,e)) * sc + vec3f(0.0,scroll,3.7));
                let nz_dx = noise3((p + vec3f(e,0.0,0.0)) * sc + vec3f(7.3,0.0,scroll));
                let nz_dy = noise3((p + vec3f(0.0,e,0.0)) * sc + vec3f(7.3,0.0,scroll));
                return normalize(vec3f(nz_dy - ny_dz, nx_dz - nz_dx, ny_dx - nx_dy));
            }
            fn vortexForce(pos: vec3f, axis: vec3f, center: vec3f, strength: f32) -> vec3f {
                let d    = pos - center; let axN = normalize(axis);
                let par  = dot(d, axN) * axN; let perp = d - par;
                let tang = cross(axN, perp); let r = length(perp);
                return -normalize(perp) * strength * 0.4 / (r + 0.3)
                      + normalize(tang)  * strength * 0.6 / (r + 0.3);
            }
            fn attractorForce(pos: vec3f, dest: vec3f, strength: f32) -> vec3f {
                let d = dest - pos; let r = length(d);
                return normalize(d) * strength / (r * r + 0.25);
            }

            // ── Accretion ring ───────────────────────────────────────────────
            fn bhBlob(U: vec2f, angle: f32) -> f32 {
                let c = 0.52 * vec2f(cos(angle), sin(angle));
                return exp(-10.0 * pow(length(U - c), 2.0));
            }
            fn blackHole(uv: vec2f, t: f32, pulse: f32) -> vec3f {
                let U    = (uv * 2.0 - 1.0) * vec2f(16.0/9.0, 1.0);
                let spin = t * 0.18;
                let ring = bhBlob(U, 0.65 + spin) + bhBlob(U, 1.60 + spin) + bhBlob(U, 2.80 + spin);
                let r       = length(U);
                let horizon = 1.0 - smoothstep(0.0, 0.12, r);
                let tc   = saturate(r / 0.8);
                let col  = mix(vec3f(0.1, 0.55, 1.0), vec3f(1.0, 0.65, 0.15), tc);
                let glow = exp(-8.0 * pow(r - 0.18, 2.0)) * (1.2 + pulse * 0.8);
                var out  = col * (0.7 + ring * (0.8 + pulse * 0.5)) + vec3f(0.9, 0.85, 0.5) * glow;
                out *= (1.0 - horizon);
                out *= 0.5 - 0.5 * cos(min(6.0 * r, 6.283));
                return out;
            }

            // ── Gravitational drain — singularity strength ───────────────────
            // No outer falloff: at warp=1 everything collapses to centre.
            // Spiral rotates two full turns at warp=1 (Kerr-like differential).
            fn gravitationalDrainUV(uv: vec2f, warp: f32) -> vec2f {
                let centre = vec2f(0.5, 0.5);
                let d   = (uv - centre) * vec2f(16.0/9.0, 1.0);
                let r   = length(d);
                let eps = mix(0.25, 0.001, warp);
                let pull = warp * warp / (r + eps);
                let angle = warp * TAU * 2.0 * max(0.0, 1.0 - r * 0.8);
                let cosA  = cos(angle); let sinA = sin(angle);
                let rotD  = vec2f(cosA * d.x - sinA * d.y, sinA * d.x + cosA * d.y);
                let warped = centre + (rotD * max(0.0, 1.0 - pull)) / vec2f(16.0/9.0, 1.0);
                return clamp(warped, vec2f(0.001), vec2f(0.999));
            }
        `)

        // ── Raymarcher ───────────────────────────────────────────────────────
        .addCompute("computeTex0", /*wgsl*/ `
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = u.resolution.xy;
                if (f32(id.x) >= res.x || f32(id.y) >= res.y) { return; }
                var seed      = pcg_hash(id.x + id.y * u32(res.x) + u32(u.time * 1000.0));
                let rot_time  = u.time * 0.2;
                let k         = vec2f(1.0, -1.0);
                let eps       = 0.001;
                let res_ratio = res.x / res.y;
                let ro = u.ro + vec3f(0.05*sin(u.time*0.3), 0.03*sin(u.time*0.4+1.0), 0.02*sin(u.time*0.5+2.0));
                let cam = getCameraAxes(ro);
                var total_radiance = vec3f(0.0); var first_t = 20.0;
                let samples = i32(u.samples);
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
                    for (var i = 0; i < 128; i++) {
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
                    let hp  = ro + rd * t;
                    let nor = normalize(
                        k.xyy * mapScene(hp + eps * k.xyy, rot_time).x +
                        k.yyx * mapScene(hp + eps * k.yyx, rot_time).x +
                        k.yxy * mapScene(hp + eps * k.yxy, rot_time).x +
                        k.xxx * mapScene(hp + eps * k.xxx, rot_time).x
                    );
                    let col1 = vec3f(1.0 - m.z, 1.0, 1.0 + m.z);
                    let rd2  = normalize(mix(reflect(rd, nor), hashHs(&seed), m.y));
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
                        let hp2  = hp + rd2 * t2;
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
                        let fogCol = mix(vec3f(0.1,0.12,0.18), vec3f(0.3,0.2,0.15), u.audioMid);
                        //  total_radiance = mix(total_radiance, vec3f(0.02, 0.02, 0.06), fog * u.showFog);
                        total_radiance = mix(total_radiance, fogCol, fog * u.showFog);

                    }
                }
                textureStore(outTex, id.xy, vec4f(total_radiance / f32(samples), first_t / 20.0));
            }
        `, 0)

        // ── Particle compute ─────────────────────────────────────────────────
        .addCompute("computeTex1", `
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = u.resolution.xy;
                if (f32(id.x) < res.x && f32(id.y) < res.y) { textureStore(outTex, id.xy, vec4f(0.0)); }
                let i = id.x;
                if (i >= u32(u.particleCount) || u.showParticles < 0.05) { return; }
                let scene = i32(u.sceneId); let prog = u.progress; let t = u.time;
                let ro = u.ro; let cam = getCameraAxes(ro); let b = i * 4u;
                var px = data[b]; var py = data[b+1u]; var pz = data[b+2u]; var pw = data[b+3u];
                let pos = vec3f(px, py, pz);
                var seed0   = pcg_hash(i + 1u);
                let p_phase = rand(&seed0);
                let p_mass  = 0.3 + rand(&seed0) * 0.7;
                let p_layer = rand(&seed0);
                var needsRespawn = (u.time < 0.1);
                if (scene == 1) { needsRespawn = needsRespawn || (length(pos) > 9.0); }
                else if (scene != 7) {
                    needsRespawn = needsRespawn || (length(pos) > 7.0) || (dot(pos - ro, cam[2]) < -1.5);
                }
                if (needsRespawn) {
                    if (scene == 1) {
                        let sAngle  = p_phase * TAU; let sElev = (p_layer - 0.5) * PI;
                        let sRadius = 2.5 + p_mass * 3.5;
                        px = cos(sAngle)*cos(sElev)*sRadius; py = sin(sElev)*sRadius*0.6;
                        pz = sin(sAngle)*cos(sElev)*sRadius - 2.0;
                    } else {
                        let angle  = p_phase * TAU + t * 0.15;
                        let radius = 0.3 + p_layer * 3.0;
                        px = cos(angle)*radius; py = (p_mass - 0.5)*4.0;
                        pz = sin(angle)*radius*0.6 - 1.5;
                    }
                    pw = p_mass;
                }
                var newPos = vec3f(px, py, pz);
                let spd    = u.particleSpeed;
                if (scene == 1) {
                    let gather     = smoothstep(0.25, 0.65, prog);
                    let breathe    = smoothstep(0.60, 0.90, prog);
                    let audioPulse = u.audioLow * 0.6 + u.audioMid * 0.3 + u.audioHigh * 0.1;
                    let curl = curlNoise(newPos, t);
                    var seed1 = pcg_hash(i * 3u + 7u);
                    let nDir = normalize(vec3f((rand(&seed1)-0.5),(rand(&seed1)-0.5)*0.4,-0.6-rand(&seed1)*0.4));
                    let neutrinoForce = nDir * (1.0 - gather) * 1.8;
                    let spiralCenter  = vec3f(0.3*sin(t*0.2+p_phase*TAU),0.2*cos(t*0.17+p_layer*TAU),-2.0);
                    let vAxis  = vec3f(0.2*sin(t*0.13), 1.0, 0.1*cos(t*0.11));
                    let spiral = vortexForce(newPos, vAxis, spiralCenter, gather * 1.4);
                    let breatheR = 1.2 + 0.5*sin(t*1.1+p_phase*TAU) + audioPulse*0.8;
                    let toC = spiralCenter - newPos; let distC = length(toC);
                    let breatheF = normalize(toC) * (distC - breatheR) * breathe * 2.5;
                    newPos += (neutrinoForce + curl*(0.4+gather*0.4) + spiral + breatheF) * spd * 0.009 * p_mass;
                } else if (scene == 3) {
                    // FIX: nodePull 0.4 → 0.15 to prevent clustering at lattice intersections.
                    // Per-particle phase offset on flow direction breaks the lock-step look.
                    let phaseOffset = p_phase * 0.3;
                    let flow = normalize(vec3f(0.6 + phaseOffset * 0.2, 0.2, -1.0)) * (0.6 + u.audioLow * 0.6);
                    let gridNode = floor(newPos + 0.5); let toNode = gridNode - newPos;
                    let nodePull = normalize(toNode) * smoothstep(1.2, 0.0, length(toNode)) * 0.15;
                    let curl = curlNoise(newPos * 0.8 + vec3f(t*0.2), t) * 0.30;
                    newPos += (flow * 1.2 + nodePull * (0.6 + u.audioMid) + curl) * spd * 0.020 * p_mass;
                } else if (scene == 6) {
                    let aT = u.audioLow*0.5 + u.audioMid + u.audioHigh*0.8;
                    let a1 = vec3f(1.5*sin(t*0.3), 0.8*cos(t*0.27), -1.5);
                    let a2 = vec3f(1.5*cos(t*0.23+2.09), 0.8*sin(t*0.31+2.09), -2.5);
                    newPos += (attractorForce(newPos,a1,0.4+aT*0.3) + attractorForce(newPos,a2,0.4+aT*0.3)
                               + curlNoise(newPos*0.7,t)) * spd * 0.028 * p_mass;
                } else if (scene == 7) {
                    let bhC   = vec3f(0.0, 0.0, -2.0);
                    let toS   = bhC - newPos; let dist = length(toS);
                    let grav  = normalize(toS) * (1.2 + u.bhPulse * 0.6) / (dist * dist + 0.08);
                    let tang  = normalize(cross(normalize(toS), vec3f(0.0, 1.0, 0.0)));
                    let orbit = tang * (0.5 / (dist + 0.3));
                    newPos   += (grav + orbit + curlNoise(newPos*1.4,t)*0.08) * spd * 0.028 * p_mass;
                } else {
                    newPos += curlNoise(newPos * 0.5, t) * spd * 0.01 * p_mass;
                }
                px = newPos.x; py = newPos.y; pz = newPos.z;
                data[b]=px; data[b+1u]=py; data[b+2u]=pz; data[b+3u]=pw;
                let rod  = u.ro + vec3f(0.05*sin(t*0.3),0.03*sin(t*0.4+1.0),0.02*sin(t*0.5+2.0));
                let cd   = getCameraAxes(rod);
                let prel = vec3f(px,py,pz) - rod;
                let pcam = vec3f(dot(prel,cd[0]),dot(prel,cd[1]),dot(prel,cd[2]));
                if (pcam.z <= 0.01) { return; }
                let sx = (pcam.x/(pcam.z*1.5))*0.5+0.5;
                let sy = (pcam.y/(pcam.z*1.5))*-0.5+0.5;
                let cx = i32(sx*res.x); let cy = i32(sy*res.y);
                if (cx<1||cx>=i32(res.x)-1||cy<1||cy>=i32(res.y)-1) { return; }
                if (scene == 7) {
                    let sc_d = (vec2f(sx, 1.0 - sy) - vec2f(0.5)) * vec2f(16.0/9.0, 1.0);
                    if (length(sc_d) < 0.12 + u.bhWarp * 0.08) { return; }
                }
                let sdn = textureLoad(computeTex0, vec2i(cx, i32(res.y)-cy), 0).a;
                if (pcam.z > sdn * 20.0 + 0.5) { return; }
                let tc   = saturate(length(vec3f(px,py,pz) - vec3f(0.0,0.0,-2.5)) / 4.0);
                var pcol = mix(vec3f(0.1, 0.6, 1.0), vec3f(1.0, 0.7, 0.2), tc);
                pcol *= 14.0 * u.showParticles;
                textureStore(outTex, vec2i(cx,cy), vec4f(pcol, 1.0));
            }
        `, 16_000 * 4 * 4)

        // ── pass_rt: temporal accumulation (audio-reactive blend) ────────────
        // FIX: u.accumBlend replaces hardcoded 0.75.
        // On strong bass transients accumBlend drops toward 0.35 in JS,
        // momentarily sharpening the image and giving a beat-reactive feel.
        .addPass("pass_rt", `
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let cur = textureSample(computeTex0, samp, in.uv).rgb;
                let his = textureSample(prev_pass_rt, samp, in.uv).rgb;
                return vec4f(mix(cur, his, u.accumBlend), 1.0);
            }
        `)

        // ── pass_freeze: locks when freezeActive = 1 ─────────────────────────
        .addPass("pass_freeze", /*wgsl*/  `
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let frozen = textureSample(prev_pass_freeze, samp, in.uv);
                if (u.freezeActive > 0.5) { return frozen; }
                let live = textureSample(pass_rt, samp, in.uv).rgb;
                return vec4f(mix(live, frozen.rgb, 0.05), 1.0);
            }
        `)

        // ── pass_bh_warp: singularity drain ──────────────────────────────────
        // For credits (scene 8) bhWarp = 0.04 — ghost shimmer only, no real pull.
        .addPass("pass_bh_warp", /*wgsl*/ `
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let fuv  = vec2f(in.uv.x, 1.0 - in.uv.y);
                let warp = u.bhWarp;
                if (warp < 0.003) {
                    return textureSample(pass_freeze, samp, in.uv);
                }
                let src_uv  = gravitationalDrainUV(fuv, warp);
                let samp_uv = vec2f(src_uv.x, 1.0 - src_uv.y);
                var col     = textureSample(pass_freeze, samp, samp_uv).rgb;
                let centre  = vec2f(0.5, 0.5);
                let d_uv    = (fuv - centre) * vec2f(16.0/9.0, 1.0);
                let r_sc    = length(d_uv);
                let redshift = warp * smoothstep(0.7, 0.0, r_sc) * 0.65;
                col = vec3f(
                    col.r + redshift * (1.0 - col.r),
                    col.g * (1.0 - redshift * 0.5),
                    col.b * (1.0 - redshift * 0.85)
                );
                let horizon_r = 0.08 + warp * warp * 1.2;
                let disc      = 1.0 - smoothstep(horizon_r * 0.7, horizon_r, r_sc);
                
                //col *= (1.0 - disc);

                let rim = smoothstep(horizon_r, horizon_r + 0.05, r_sc);
                col += vec3f(1.0, 0.6, 0.2) * rim * 0.4;
                
                return vec4f(col, 1.0);
            }
        `)

        // ── pass_fx: per-scene routing ────────────────────────────────────────
        .addPass("pass_fx",  /*wgsl*/ `
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                if (u.sceneId == 1.0) {
                    let fade      = 1.0 - smoothstep(0.92, 1.0, u.progress);
                    let zoom      = 1.0 + u.progress * 0.04 * fade + u.audioLow * 0.004 * fade;
                    let zoom_uv   = (in.uv - 0.5) * zoom + 0.5;
                    let shake_x   = (u.audioLow - u.audioMid)  * 0.004 * fade;
                    let shake_y   = (u.audioMid - u.audioHigh) * 0.002 * fade;
                    let suv       = zoom_uv + vec2f(shake_x, shake_y);
                    let wide_band = floor(suv.y / 0.10);
                    let wide_fft  = fftBin(clamp(wide_band * 6.0, 0.0, 60.0));
                    let wide_sign = select(-1.0, 1.0, fract(wide_band * 0.618) > 0.5);
                    let wide_off  = wide_fft * wide_sign * 0.022 * fade;
                    let fine_band = floor(suv.y / 0.025);
                    let fine_fft  = fftBin(clamp(50.0 + fract(fine_band * 0.381) * 40.0, 50.0, 90.0));
                    let fine_sign = select(-1.0, 1.0, fract(fine_band * 1.618) > 0.5);
                    let fine_off  = fine_fft * fine_sign * 0.005 * fade;
                    let duv = vec2f(
                        clamp(suv.x + wide_off + fine_off, 0.001, 0.999),
                        clamp(suv.y, 0.001, 0.999)
                    );
                    var col = textureSample(pass_rt, samp, duv).rgb;
                    if (u.overlayAlpha > 0.01) {
                        let tx = textureSample(overlay, samp, vec2f(duv.x, 1.0 - duv.y));
                        col = mix(col, tx.rgb, tx.a * u.overlayAlpha);
                    }
                    return vec4f(col, 1.0);
                }
                if (u.sceneId >= 7.0) {
                    return textureSample(pass_bh_warp, samp, in.uv);
                }
                return textureSample(pass_rt, samp, in.uv);
            }
        `)

        // ── pass_particles ────────────────────────────────────────────────────
        .addPass("pass_particles", /*wgsl*/ `
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let dots = textureSample(computeTex1, samp, in.uv).rgb;
                let old  = textureSample(prev_pass_particles, samp, in.uv).rgb;
                return vec4f(dots + old * 0.6, 1.0);
            }
        `)

        // ── main composite ────────────────────────────────────────────────────
        .main(/*wgsl*/`
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

                col *= (0.6 + u.exposure * 0.6);

                if (u.showFilmic > 0.05) {
                    col = mix(pow(max(col,vec3f(0.0)),vec3f(0.4545)), filmic(col), u.showFilmic);
                } else {
                    col = pow(max(col, vec3f(0.0)), vec3f(0.4545));
                }

                if (u.showParticles > 0.05) {
                    let p = textureSample(pass_particles, samp, fuv).rgb;
                    col = 1.0 - (1.0 - col) * (1.0 - p * 0.6);
                }

                if (u.showBlackHole > 0.01) {
                    let bh = blackHole(fuv, u.time, u.bhPulse);
                    col = 1.0 - (1.0 - col) * (1.0 - bh * u.showBlackHole);
                }

                if (u.showVignette > 0.5) {
                    let uvc = fuv - 0.5;
                    col *= clamp(1.0 - dot(uvc,uvc)*2.2, 0.0, 1.0);
                }

                if (u.sceneId != 1.0 && u.overlayAlpha > 0.01) {
                    let tx = textureSample(overlay, samp, in.uv);
                    col = mix(col, tx.rgb, tx.a * u.overlayAlpha);
                }

                // ── Corner overlay — resolution-independent ────────────────────
                {
                    let cx0 = 1.0 - u.cornerFracW - u.cornerMarginX;
                    let cy0 = 1.0 - u.cornerFracH - u.cornerMarginY;
                    let cx1 = cx0 + u.cornerFracW;
                    let cy1 = cy0 + u.cornerFracH;
                    let mask = step(cx0, fuv.x) * step(fuv.x, cx1)
                             * step(cy0, fuv.y) * step(fuv.y, cy1);
                    let cuv = vec2f(
                        (fuv.x - cx0) / u.cornerFracW,
                        1.0 - (fuv.y - cy0) / u.cornerFracH
                    );
                    let ctx = textureSample(corner, samp, cuv);
                    col = mix(col, ctx.rgb, ctx.a * u.cornerAlpha * mask);
                }

                return vec4f(col, 1.0);
            }
        `);



    mountStartButton(async () => {
        createTimelineDebug(seq, TOTAL_LENGTH_MS, (ms) => {
 
    });
    
        await pipeline.run();
        
    });


    

};

start();