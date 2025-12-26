"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UniformLayout = void 0;
class UniformLayout {
    entries = [];
    size = 0;
    _cache = null;
    frameCount = 0;
    currentTime = 0;
    constructor(initialResolution) {
        // We initialize with standard global uniforms
        this.addUniform("resolution", initialResolution);
        this.addUniform("time", 0);
    }
    addUniform(name, value) {
        const { type, size, align } = this.inferType(value);
        // Standard WGSL alignment: offset must be a multiple of 'align'
        const offset = Math.ceil(this.size / align) * align;
        this.entries.push({ name, type, size, align, offset, value });
        this.size = offset + size;
        this._cache = null; // Reset cache so it grows to fit new size
        return this;
    }
    // This is the critical fix for your animation issue
    update(time) {
        this.currentTime = time;
        this.frameCount++;
    }
    get byteSize() {
        // Uniform buffers must be multiples of 16 bytes in WebGPU
        return Math.ceil(this.size / 16) * 16;
    }
    get wgslStruct() {
        return `struct Uniforms {\n${this.entries.map(e => `  ${e.name}: ${e.type},`).join("\n")}\n};`;
    }
    get float32Array() {
        if (!this._cache)
            this._cache = new Float32Array(this.byteSize / 4);
        for (const e of this.entries) {
            let val;
            // Determine the value based on the entry name or function
            if (e.name === "time") {
                val = this.currentTime;
            }
            else if (typeof e.value === "function") {
                val = e.value(this.currentTime, this.frameCount);
            }
            else {
                val = e.value;
            }
            const startIndex = e.offset / 4;
            if (typeof val === "number") {
                this._cache[startIndex] = val;
            }
            else {
                for (let i = 0; i < val.length; i++) {
                    this._cache[startIndex + i] = val[i];
                }
            }
        }
        return this._cache;
    }
    inferType(value) {
        const sample = typeof value === "function" ? value(0, 0) : value;
        if (typeof sample === "number")
            return { type: "f32", size: 4, align: 4 };
        const len = sample.length;
        switch (len) {
            case 2: return { type: "vec2f", size: 8, align: 8 };
            case 3: return { type: "vec3f", size: 12, align: 16 }; // Note: vec3 aligns to 16
            case 4: return { type: "vec4f", size: 16, align: 16 };
            default: throw new Error(`Uniform array length ${len} not supported.`);
        }
    }
}
exports.UniformLayout = UniformLayout;
