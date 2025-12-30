/**
 * Represents a function that computes uniform values based on time and frame information.
 * @param time - The elapsed time in seconds
 * @param frame - The current frame number
 * @returns A numeric value or an array of numeric values to be used as uniform data
 */
export type UniformFunction = (time: number, frame: number) => number | number[];
/**
 * Represents a uniform value that can be used in shader programs.
 * Can be a single number, an array of numbers, or a function that returns uniform data.
 */
export type UniformValue = number | number[] | UniformFunction;

/**
 * Represents a single uniform entry in a shader uniform layout.
 * 
 * @property {string} name - The name of the uniform variable.
 * @property {string} type - The WGSL type of the uniform (e.g., "f32", "vec3f", "mat4x4f").
 * @property {number} size - The size of the uniform in bytes.
 * @property {number} align - The alignment requirement of the uniform in bytes.
 * @property {number} offset - The byte offset of the uniform within the buffer.
 * @property {UniformValue} value - The current value of the uniform.
 */
export interface UniformEntry {
    name: string;
    type: string;
    size: number;
    align: number;
    offset: number;
    value: UniformValue;
}

/**
 * Manages uniform buffer layout and data for WebGPU shaders.
 * 
 * Handles the organization, alignment, and serialization of uniform values
 * according to WGSL specifications. Automatically manages buffer size,
 * proper alignment (including the 16-byte requirement for WebGPU uniform buffers),
 * and provides real-time updates for time-based and function-driven uniforms.
 * 
 * @example
 * ```typescript
 * const layout = new UniformLayout([800, 600]);
 * layout.addUniform("color", [1.0, 0.0, 0.0, 1.0]);
 * layout.addUniform("speed", (time) => Math.sin(time));
 * layout.update(performance.now() / 1000);
 * const buffer = layout.float32Array;
 * ```
 */
export class UniformLayout {
    private entries: UniformEntry[] = [];
    private size = 0;
    private _cache: Float32Array | null = null;
    private frameCount = 0;
    private currentTime = 0;

    constructor(initialResolution: number[]) {
        // We initialize with standard global uniforms
        this.addUniform({ name: "resolution", value: initialResolution });
        this.addUniform({ name: "time", value: 0 });
    }

    /**
     * Adds a uniform to the layout with proper WGSL alignment.
     * @param options - The uniform configuration
     * @param options.name - The name of the uniform
     * @param options.value - The value of the uniform
     * @returns This instance for method chaining
     */
    addUniform({ name, value }: { name: string; value: UniformValue; }): this {
        const { type, size, align } = this.inferType(value);
        // Standard WGSL alignment: offset must be a multiple of 'align'
        const offset = Math.ceil(this.size / align) * align;
        
        this.entries.push({ name, type, size, align, offset, value });
        this.size = offset + size;
        this._cache = null; // Reset cache so it grows to fit new size
        return this;
    }

    // This is the critical fix for your animation issue
    /**
     * Updates the uniform layout with the current time and increments the frame counter.
     * @param time - The current time value to update the uniform layout with.
     */
    update(time: number) {
        this.currentTime = time;
        this.frameCount++;
    }

    /**
     * Gets the byte size of the uniform layout, rounded up to the nearest multiple of 16.
     * 
     * @remarks
     * WebGPU requires uniform buffers to be aligned to 16-byte boundaries.
     * 
     * @returns The size in bytes, guaranteed to be a multiple of 16.
     */
    get byteSize(): number { 
        // Uniform buffers must be multiples of 16 bytes in WebGPU
        return Math.ceil(this.size / 16) * 16; 
    }

    /**
     * Generates a WGSL struct definition string for the uniform layout.
     * 
     * @returns {string} A WGSL struct named "Uniforms" containing all entries
     * with their respective names and types, formatted as a valid WGSL struct declaration.
     * 
     * @example
     * // Returns: "struct Uniforms {\n  position: vec3,\n  color: vec4,\n};"
     * const structDef = uniformLayout.wgslStruct;
     */
    get wgslStruct(): string {
        return `struct Uniforms {\n${this.entries.map(e => `  ${e.name}: ${e.type},`).join("\n")}\n};`;
    }

    /**
     * Gets a Float32Array representation of the uniform layout data.
     * 
     * Lazily initializes and caches a Float32Array buffer sized to accommodate all uniform entries.
     * Iterates through each entry, resolving its value (from time, a function, or a static value),
     * and writes the resolved value(s) into the appropriate offset in the cache.
     * 
     * @returns {Float32Array} The cached Float32Array containing all uniform values in binary format.
     */
    get float32Array(): Float32Array {
        if (!this._cache) this._cache = new Float32Array(this.byteSize / 4);
        
        for (const e of this.entries) {
            let val: number | number[];

            // Determine the value based on the entry name or function
            if (e.name === "time") {
                val = this.currentTime;
            } else if (typeof e.value === "function") {
                val = (e.value as UniformFunction)(this.currentTime, this.frameCount);
            } else {
                val = e.value as number | number[];
            }

            const startIndex = e.offset / 4;
            if (typeof val === "number") {
                this._cache[startIndex] = val;
            } else {
                for (let i = 0; i < val.length; i++) {
                    this._cache[startIndex + i] = val[i];
                }
            }
        }
        return this._cache;
    }

    /**
     * Infers the WGSL type and memory layout information for a uniform value.
     * @param value - The uniform value to infer the type for. Can be a number, array of numbers, or a function that returns one of these.
     * @returns An object containing the WGSL type name, size in bytes, and alignment requirement in bytes.
     * @throws {Error} If the uniform array length is not 2, 3, or 4.
     */
    private inferType(value: UniformValue) {
        const sample = typeof value === "function" ? (value as UniformFunction)(0, 0) : value;
        if (typeof sample === "number") return { type: "f32", size: 4, align: 4 };        
        const len = (sample as number[]).length;
        switch (len) {
            case 2: return { type: "vec2f", size: 8, align: 8 };
            case 3: return { type: "vec3f", size: 12, align: 16 }; // Note: vec3 aligns to 16
            case 4: return { type: "vec4f", size: 16, align: 16 };
            default: throw new Error(`Uniform array length ${len} not supported.`);
        }
    }
}