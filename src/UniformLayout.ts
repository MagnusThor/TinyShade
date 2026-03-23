/**
 * Interfaces for the Uniform System
 */
export type UniformFunction = (time: number, frame: number) => number | number[];
export type UniformValue = number | number[] | UniformFunction;

export interface UniformEntry {
    name: string;
    type: string;
    size: number;
    align: number;
    offset: number;
    value: UniformValue;
}



/**
 * Manages memory-aligned WebGPU Uniform Buffers.
 * Handles the strict 16-byte alignment and O(1) update performance.
 */
export class UniformLayout {
    private entries: UniformEntry[] = [];
    private buffer!: ArrayBuffer;
    private floatView!: Float32Array;

    private setters: Map<string, (val: any) => void> = new Map();
    private dynamicUpdates: Array<() => void> = [];

    private isBuilt = false;
    private _currentOffset = 0;

    public frameCount = 0;
    public currentTime = 0;
    public previousTime: number = 0

    get uniformEntries() { return this.entries; }

    constructor(initialResolution: number[]) {
        this.addUniform({ name: "resolution", value: initialResolution });
        this.addUniform({ name: "time", value: 0 });
        this.addUniform({ name: "deltaTime", value: 0 });
        this.addUniform({ name: "sceneId", value: 0 });
        this.addUniform({ name: "progress", value: 0 });
        this.addUniform({ name: "flags", value: 0 });
        this.addUniform({ name: "frame", value: 0 });

    }

    /**
     * Step 1: Register the structure of your uniforms.
     * This handles the complex WGSL alignment logic.
     */
    addUniform({ name, value }: { name: string; value: UniformValue }): this {
        if (this.isBuilt) throw new Error("Cannot add uniforms after build()");

        const { type, size, align } = this.inferType(value);

        this._currentOffset = Math.ceil(this._currentOffset / align) * align;

        this.entries.push({
            name,
            type,
            size,
            align,
            offset: this._currentOffset,
            value
        });

        this._currentOffset += size;
        return this;
    }

    /**
     * Step 2: Bake the memory buffer and create O(1) setters.
     */
    build() {
        if (this.isBuilt) return;

        const totalSize = Math.ceil(this._currentOffset / 16) * 16;
        this.buffer = new ArrayBuffer(totalSize);
        this.floatView = new Float32Array(this.buffer);

        for (const e of this.entries) {
            const idx = e.offset / 4;

            const setter = (val: any) => {
                const resolved = typeof val === "function" ? val(this.currentTime, this.frameCount) : val;
                if (typeof resolved === "number") {
                    this.floatView[idx] = resolved;
                } else {
                    this.floatView.set(resolved, idx);
                }
            };

            this.setters.set(e.name, setter);

            if (typeof e.value === "function") {
                this.dynamicUpdates.push(() => setter(e.value));
            } else {

                setter(e.value);
            }
        }

        this.isBuilt = true;
    }

    /**
     * Updates globals and runs all dynamic uniform functions.
     */
    update(time: number) {
        if (!this.isBuilt) this.build();
        this.currentTime = time;
        this.frameCount++;

        const dt = time - this.previousTime;
        this.previousTime = time;

        this.setters.get("time")?.(time);
        this.setters.get("deltaTime")?.(dt);
        this.setters.get("frame")?.(this.frameCount);


        for (const update of this.dynamicUpdates) {
            update();

        }
    }

    /**
     * Sequencer-specific update for scene management.
     */
    updateSequencer(sceneId: number, progress: number, flags: number) {
        if (!this.isBuilt) this.build();

        const setId = this.setters.get("sceneId");
        const setProg = this.setters.get("progress");
        const setFlags = this.setters.get("flags");

        if (setId) setId(sceneId);
        if (setProg) setProg(progress);
        if (setFlags) setFlags(flags);

      

    }


    get byteSize(): number {
        if (!this.isBuilt) this.build();
        return this.buffer.byteLength;
    }

    get float32Array(): Float32Array {
        if (!this.isBuilt) this.build();
        return this.floatView;
    }

    get wgslStruct(): string {
        const lines = this.entries.map(e => `    ${e.name}: ${e.type},`);
        return `struct Uniforms {\n${lines.join("\n")}\n};`;
    }

    /**
     * Resolves WGSL types based on the input data format.
     */
    private inferType(value: UniformValue) {
        const sample = typeof value === "function" ? value(0, 0) : value;

        if (typeof sample === "number") {
            return { type: "f32", size: 4, align: 4 };
        }

        if (Array.isArray(sample)) {
            const len = sample.length;
            switch (len) {
                case 2: return { type: "vec2f", size: 8, align: 8 };
                case 3: return { type: "vec3f", size: 12, align: 16 };
                case 4: return { type: "vec4f", size: 16, align: 16 };
            }
        }

        throw new Error(`Unsupported uniform value type: ${typeof sample}`);
    }

}


export class UniformState {
    private values: Record<string, any> = {};

    set(name: string, value: any) {
        this.values[name] = value;
    }

    get(name: string) {
        return this.values[name];
    }

    apply(obj: Record<string, any>) {
        for (const k in obj) this.values[k] = obj[k];
    }

    getAll() {
        return this.values;
    }
}


export function bindUniforms(l: any, state: UniformState, names: string[]) {
    names.forEach(name => {
        l.addUniform({
            name,
            value: () => state.get(name)
        });
    });
}

type Entry = [number, number, number, Record<string, any>?];

export function createSequenceDSL(seq: any) {

    const timeline: Entry[] = [];

    function make(durationUnits: number) {
        let flags = 0;
        let sceneId = 0;
        const params: Record<string, any> = {};

        const api = {

            fx(f: number) {
                flags |= f;
                return api;
            },

            scene(id: number) {
                sceneId = id;
                return api;
            },

            // 🔥 GENERIC UNIFORM SET
            set(name: string, value: any) {
                params[name] = value;
                return api;
            },

            // 🔥 MULTI SET
            setMany(obj: Record<string, any>) {
                Object.assign(params, obj);
                return api;
            },

            done() {
                timeline.push([
                    durationUnits,
                    flags,
                    sceneId,
                    Object.keys(params).length ? params : undefined
                ]);
                return api;
            }
        };

        return api;
    }

    function S(ms: number) {
        return make(seq.getUnitsFromMs(ms, seq.L));
    }

    S.bars = (bars: number) =>
        make(seq.getUnitsFromBars(bars, seq.L));

    function build() {
        timeline.push([255, 0, 0]);
        return timeline;
    }

    return { S, build };
}