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

    // Fast-access maps to avoid string searching in the render loop
    private setters: Map<string, (val: any) => void> = new Map();
    private dynamicUpdates: Array<() => void> = [];

    private isBuilt = false;
    private _currentOffset = 0;
    private frameCount = 0;
    private currentTime = 0;

    constructor(initialResolution: number[]) {
        // Register standard demoscene globals
        this.addUniform({ name: "resolution", value: initialResolution });
        this.addUniform({ name: "time", value: 0 });
        this.addUniform({ name: "sceneId", value: 0 });
        this.addUniform({ name: "progress", value: 0 });
        this.addUniform({ name: "flags", value: 0 });
    }

    /**
     * Step 1: Register the structure of your uniforms.
     * This handles the complex WGSL alignment logic.
     */
    addUniform({ name, value }: { name: string; value: UniformValue }): this {
        if (this.isBuilt) throw new Error("Cannot add uniforms after build()");

        const { type, size, align } = this.inferType(value);

        // WGSL Alignment Rule: The offset must be a multiple of the alignment
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

        // Final buffer size must be a multiple of 16 bytes
        const totalSize = Math.ceil(this._currentOffset / 16) * 16;
        this.buffer = new ArrayBuffer(totalSize);
        this.floatView = new Float32Array(this.buffer);

        for (const e of this.entries) {
            const idx = e.offset / 4;

            // Create a specialized closure for setting this specific memory slot
            const setter = (val: any) => {
                const resolved = typeof val === "function" ? val(this.currentTime, this.frameCount) : val;
                if (typeof resolved === "number") {
                    this.floatView[idx] = resolved;
                } else {
                    // Optimized set for vec2, vec3, vec4
                    this.floatView.set(resolved, idx);
                }
            };

            this.setters.set(e.name, setter);

            // If it's a dynamic function, queue it for the update loop
            if (typeof e.value === "function") {
                this.dynamicUpdates.push(() => setter(e.value));
            } else {
                setter(e.value); // Initial value
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

        // This actually writes the new time into the floatView/ArrayBuffer
        this.setters.get("time")?.(time);

        for (const update of this.dynamicUpdates) {
            update();
        }
    }

    /**
     * Sequencer-specific update for scene management.
     */
  updateSequencer(sceneId: number, progress: number, flags: number) {
    if (!this.isBuilt) this.build();
    
    // Get the pre-compiled setter functions and execute them
    const setId = this.setters.get("sceneId");
    const setProg = this.setters.get("progress");
    const setFlags = this.setters.get("flags");

    if (setId) setId(sceneId);
    if (setProg) setProg(progress);
    if (setFlags) setFlags(flags);
    
    if(this.entries){

        
    //console.log("Buffer SceneId Index:", this.entries.find(e => e.name === 'sceneId')?.offset / 4);

    console.log("Value in Buffer:", this.floatView[this.entries.find(e => e.name === 'sceneId')!.offset / 4]);
    }
}

    // --- Getters ---

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
        // If it's a function, run it once with 0 to see what it returns
        const sample = typeof value === "function" ? value(0, 0) : value;

        if (typeof sample === "number") {
            return { type: "f32", size: 4, align: 4 };
        }

        if (Array.isArray(sample)) {
            const len = sample.length;
            switch (len) {
                case 2: return { type: "vec2f", size: 8, align: 8 };
                case 3: return { type: "vec3f", size: 12, align: 16 }; // Vec3 requires 16-byte alignment
                case 4: return { type: "vec4f", size: 16, align: 16 };
            }
        }

        throw new Error(`Unsupported uniform value type: ${typeof sample}`);
    }
}