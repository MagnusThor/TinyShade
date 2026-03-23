/**
 * ──────────────────────────────────────────────────────────────────────────
 *  TSSequencerDSL
 *  A tiny fluent DSL that sits on top of TSSequencer.
 *
 *  Responsibilities:
 *    1. UniformState  — single mutable store for all GPU-bound values.
 *    2. SceneDefaults — per-scene base uniform map (progress-aware).
 *    3. SequenceBuilder (S / S.bars) — fluent timeline builder.
 *    4. connectSequencer — wires onUpdate: reset → defaults → DSL overrides
 *                          → audio reactivity → optional custom hook.
 *    5. bindUniforms  — auto-registers names from UniformState into a
 *                       UniformLayout in one call.
 *
 *  Timeline tuple produced: [units, flags, sceneId, overrides?]
 *  The sequencer only reads [0..2]; overrides slot [3] is consumed by
 *  connectSequencer and never forwarded to the GPU raw.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { TSSequencer } from "../TSSequencer";
import { UniformLayout } from "../UniformLayout";


export class UniformState {
    private _v: Record<string, any> = {};

    /** Set a single value. */
    set(name: string, value: any): this {
        this._v[name] = value;
        return this;
    }

    /** Get a single value (returns undefined if not set). */
    get(name: string): any {
        return this._v[name];
    }

    /**
     * Merge an object into state.
     * Values that are functions are called with no args and stored as their
     * result — this lets you pass computed values lazily from applySceneDefaults.
     */
    apply(obj: Record<string, any>): this {
        for (const k in obj) {
            const v = obj[k];
            this._v[k] = typeof v === "function" ? v() : v;
        }
        return this;
    }

    /**
     * Zero out every feature-toggle uniform.
     * Call once on scene entry so each scene only writes what it needs.
     */
    reset(names: string[]): this {
        for (const n of names) this._v[n] = 0;
        return this;
    }

    getAll(): Record<string, any> { return this._v; }
}


export type SceneDefaultsFn = (sceneId: number, p: number) => Record<string, any>;

/**
 * Built-in defaults for Lattice of Light.
 * Swap this out or extend it for other productions.
 */
export const latticeSceneDefaults: SceneDefaultsFn = (sceneId, p) => {

    const clamp  = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
    const smooth = (t: number) => { const c = clamp(t); return c * c * (3 - 2 * c); };
    const ease   = (t: number) => { const c = clamp(t); return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c; };
    const ep     = ease(p);


    switch (sceneId) {

        case 1: return {
            showFloor:      1.0,
            showFog:        0.4,
            showParticles:  1.0,
            particleCount:  1_200,
            particleSpeed:  0.2,
            exposure:       0.9 + 0.1 * Math.sin(Date.now() * 0.002),
            overlayAlpha:   p < 0.08 ? smooth(p / 0.08) : p > 0.92 ? smooth((1 - p) / 0.08) : 1.0,
        };

        case 2: return {
            showFog:        1.0,
            showParticles:  1.0,
            particleCount:  5_000,
            particleSpeed:  0.5 + ease(p) * 0.4,
            showFloor:      smooth(p * 2.0),
            showLattice:    smooth(clamp((p - 0.1) / 0.9)),
            exposure:       0.6 + ep * 0.7,
            cornerAlpha:    p < 0.30 ? smooth(p / 0.30) : p > 0.85 ? smooth((1 - p) / 0.15) : 1.0,
        };

        case 3: return {
            showFloor:      1.0,
            showLattice:    1.0,
            showFog:        0.5 + smooth(p) * 0.3,
            showParticles:  1.0,
            particleCount:  6_000,
            particleSpeed:  0.5 + ep * 0.3,
            showSphere:     smooth(p * 2.0),
            showLights:     smooth(clamp((p - 0.2) / 0.8)),
            showFilmic:     smooth(clamp((p - 0.35) / 0.65)),
            exposure:       1.1 + ep * 0.5,
            cornerAlpha:    p < 0.25 ? smooth(p / 0.25) : p > 0.85 ? smooth((1 - p) / 0.15) : 1.0,
        };

        case 4: return {
            showFloor:      1.0,
            showLattice:    1.0,
            showSphere:     1.0,
            showLights:     1.0,
            showFilmic:     1.0,
            showParticles:  1.0,
            particleCount:  15_000,
            showTwist:      1.2,
            showChroma:     smooth(clamp((p - 0.45) / 0.55)),
            particleSpeed:  0.8 + ep * 0.9,
            exposure:       1.2 + ep * 0.3,
            cornerAlpha:    p < 0.35 ? smooth(p / 0.35) : p > 0.80 ? smooth((1 - p) / 0.20) : 1.0,
        };

        case 5: return {
            showFloor:      1.0,
            showLattice:    1.0,
            showSphere:     1.0,
            showLights:     1.0,
            showFilmic:     1.0,
            showParticles:  1.0,
            particleCount:  6_000,
            showFog:        smooth(clamp((p - 0.5) / 0.5)) * 0.8,
            showTwist:      1.0 - smooth(p),
            showChroma:     smooth(clamp(1.0 - p * 1.3, 0.0, 1.0)),
            particleSpeed:  1.4 - ep * 0.6,
            exposure:       0.85,
            cornerAlpha:    p < 0.30 ? smooth(p / 0.30) : p > 0.80 ? smooth((1 - p) / 0.20) : 1.0,
        };

        case 6: return {
            showFloor:      1.0,
            showLattice:    1.0,
            showSphere:     1.0,
            showLights:     1.0,
            showFilmic:     1.0,
            showChroma:     1.0,
            showParticles:  1.0,
            particleCount:  18_000,
            showTwist:      0.8,
            particleSpeed:  1.2 + ep * 0.6,
            exposure:       1.0 + 0.3 * Math.sin(p * Math.PI),
            cornerAlpha:    p < 0.35 ? smooth(p / 0.35) : p > 0.85 ? smooth((1 - p) / 0.15) : 1.0,
        };

        case 7: return {
            showFilmic:     1.0,
            showParticles:  smooth(clamp(1.0 - p * 2.0, 0.0, 1.0)),
            particleCount:  6_000,
            particleSpeed:  0.8 + ep * 2.0,
            freezeActive:   1.0,
            showBlackHole:  smooth(p),
            exposure:       p < 0.25 ? 1.2 : 1.0 - smooth((p - 0.25) / 0.75) * 0.8,
            cornerAlpha:    p < 0.20 ? smooth(p / 0.20) : p > 0.75 ? smooth((1 - p) / 0.25) : 1.0,
        };

        case 8: return {
            showFilmic:     1.0,
            showVignette:   0.0,
            particleCount:  0,
            freezeActive:   1.0,
            bhWarp:         0.04,
            showBlackHole:  smooth(clamp(1.0 - p * 2.5, 0.0, 1.0)),
            exposure:       smooth(clamp(1.0 - p * 1.2, 0.0, 1.0)) * 0.3,
            overlayAlpha:   p < 0.10 ? smooth(p / 0.10) : 1.0,
            cornerAlpha:    0.0,
        };

        default: return {};
    }
};



/** A single timeline entry as understood by TSSequencer + connectSequencer. */
export type TimelineEntry = [
    units:     number,
    flags:     number,
    sceneId:   number,
    overrides?: Record<string, any>
];

export interface SceneBuilder {
    /** Set the sceneId for this entry. */
    scene(id: number): this;
    /** OR a feature flag into this entry's flag word. */
    fx(f: number): this;
    /** Override a single uniform for this scene. */
    set(name: string, value: any): this;
    /** Override multiple uniforms at once. */
    setMany(obj: Record<string, any>): this;
    /** Finalise and push into the timeline. Returns the builder for chaining. */
    done(): SequenceBuilder;
}

export interface SequenceBuilder {
    /** Duration in milliseconds. */
    ms(duration: number): SceneBuilder;
    /** Duration in musical bars (uses sequencer BPM + beatsPerBar). */
    bars(count: number): SceneBuilder;
    /** Finalise: appends the sentinel [255, 0, 0] and returns the array. */
    build(): TimelineEntry[];
}

export function createSequenceDSL(seq: TSSequencer): SequenceBuilder {

    const timeline: TimelineEntry[] = [];

    function makeEntry(units: number): SceneBuilder & { done(): SequenceBuilder } {
        let _flags    = 0;
        let _scene    = 0;
        const _params: Record<string, any> = {};

        const builder: SceneBuilder & { done(): SequenceBuilder } = {

            scene(id: number) { _scene = id; return this; },

            fx(f: number) { _flags |= f; return this; },

            set(name: string, value: any) { _params[name] = value; return this; },

            setMany(obj: Record<string, any>) { Object.assign(_params, obj); return this; },

            done(): SequenceBuilder {
                timeline.push([
                    units,
                    _flags,
                    _scene,
                    Object.keys(_params).length ? { ..._params } : undefined
                ]);
                return dsl;
            }
        };

        return builder;
    }

    const dsl: SequenceBuilder = {

        ms(duration: number) {
            return makeEntry(seq.getUnitsFromMs(duration, seq.L));
        },

        bars(count: number) {
            return makeEntry(seq.getUnitsFromBars(count, seq.L));
        },

        build(): TimelineEntry[] {
            timeline.push([255, 0, 0]);
            return timeline;
        }
    };

    return dsl;
}



/** Names that are reset to 0 on every scene entry. */
const RESET_NAMES = [
    "showLattice", "showSphere", "showLights", "showFloor",
    "showFog",     "showChroma", "showTwist",  "showFilmic",
    "showVignette","showParticles","particleCount","particleSpeed",
    "overlayAlpha","cornerAlpha", "showBlackHole","bhPulse",
    "bhWarp",      "freezeActive","exposure",
] as const;

export interface ConnectOptions {
    /** Override or extend the built-in scene defaults. */
    sceneDefaults?: SceneDefaultsFn;
    /** Called after all uniform writes — use for camera, card logic, etc. */
    onTick?: (sceneId: number, progress: number, flags: number, state: UniformState) => void;
    /** Audio plugin — if provided, audioLow/Mid/High are written each frame. */
    audio?: any;
}

export function connectSequencer(
    seq:   TSSequencer,
    state: UniformState,
    opts:  ConnectOptions = {}
): void {

    const defaults = opts.sceneDefaults ?? latticeSceneDefaults;
    let lastSceneId = -1;

    seq.onUpdate = ({ sceneId, progress, flags }) => {

        if (sceneId !== lastSceneId) {
            lastSceneId = sceneId;
            state.reset([...RESET_NAMES]);
            state.set("showVignette", 1);
        }

        state.apply(defaults(sceneId, progress));

        const entry     = seq.timeline[seq.timeline.findIndex(e => e[2] === sceneId)];
        const overrides = entry?.[3] as Record<string, any> | undefined;
        if (overrides) state.apply(overrides);

        if (opts.audio) {
            const fd = opts.audio.getFrequencyData?.() ?? { low: 0, mid: 0, high: 0 };
            state.set("audioLow",  (state.get("audioLow")  ?? 0) * 0.7 + fd.low  * 0.3);
            state.set("audioMid",  (state.get("audioMid")  ?? 0) * 0.7 + fd.mid  * 0.3);
            state.set("audioHigh", (state.get("audioHigh") ?? 0) * 0.7 + fd.high * 0.3);

            if (flags & 0x0008) {
                const beat = state.get("audioLow") * 0.7 + state.get("audioMid") * 0.3;
                state.set("particleSpeed", (state.get("particleSpeed") ?? 0) * (1.0 + beat * 0.15));
                state.set("exposure",      (state.get("exposure")      ?? 1) * (1.0 + beat * 0.10));
            }

            const aLow = state.get("audioLow") ?? 0;
            state.set("accumBlend", Math.max(0.25, Math.min(0.6, 0.6 - aLow * 0.25)));
        }

        opts.onTick?.(sceneId, progress, flags, state);
    };
}


export function bindUniforms(
    layout: UniformLayout,
    state:  UniformState,
    names:  string[]
): void {
    for (const name of names) {
        layout.addUniform({ name, value: () => state.get(name) });
    }
}