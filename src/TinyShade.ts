import { IAudioPlugin } from "./plugins/IAudioPlugin";
import { WebGPUTiming } from "./plugins/WebGPUTiming";
import { TSSequencer } from "./TSSequencer";
import { UniformLayout } from "./UniformLayout";

/**
 * Utility for writing data to GPU Buffers.
 */
const Buffer = {
    /**
     * Writes an ArrayBufferView to a GPUBuffer.
     * @param device The active GPUDevice.
     * @param buffer The target GPUBuffer.
     * @param data The data to write.
     * @param offset Byte offset in the buffer.
     */
    write(device: GPUDevice, buffer: GPUBuffer, data: ArrayBufferView, offset = 0): GPUBuffer {
        device.queue.writeBuffer(buffer, offset, data.buffer, data.byteOffset, data.byteLength);
        return buffer;
    }
};

/**
 * Calculates the largest power of two less than or equal to n.
 * Useful for optimizing workgroup sizes.
 */
const largestPowerOf2LessThan = (n: number): number => {
    let power = 1;
    while (power * 2 <= n) power *= 2;
    return power;
};

/**
 * Determines optimal workgroup sizes based on hardware limits.
 */
const getWorkgroupSize = (limits: GPUSupportedLimits) => {
    const x = Math.min(16, largestPowerOf2LessThan(limits.maxComputeWorkgroupSizeX));
    const y = Math.min(16, largestPowerOf2LessThan(limits.maxComputeWorkgroupSizeY));
    return { x, y, z: 1, str: `@workgroup_size(${x}, ${y}, 1)` };
};

/**
 * Represents a single stage in the rendering pipeline.
 */
export interface IPass {
    /** Unique name used for dependency injection in shaders. */
    name: string;
    /** 'compute' for GPGPU tasks, 'fragment' for full-screen effects. */
    type: 'compute' | 'fragment';
    /** The WGSL source code. */
    shader: string;
    /** Resultant textures. Fragment passes automatically create 2 for ping-ponging. */
    textures: GPUTexture[];
    /** Compiled GPU Pipelines. */
    pipelines: (GPURenderPipeline | GPUComputePipeline)[];
    /** Optional GPUBuffer for data storage/atomics. */
    storageBuffer?: GPUBuffer;
    /** If true, the storage buffer uses atomic<u32>. */
    isAtomic?: boolean;
    /** Internal flag identifying the final output pass. */
    isMain?: boolean;
    /** List of pass names whose results this pass needs to read. */
    dependencies?: string[];
}

/**
 * TinyShade: A minimal, high-performance WebGPU framework for 
 * multi-pass fragment and compute shaders.
 */
export class TinyShade {
    public device!: GPUDevice;
    private context!: GPUCanvasContext;
    public canvas: HTMLCanvasElement;
    private uniforms: UniformLayout;
    private uniformBuffer!: GPUBuffer;
    private audioPlugin?: IAudioPlugin;
    private startTime = 0;
    public frameCounter = 0;

    private sequencer?: TSSequencer;

    private globalTextures: Map<string, GPUTexture> = new Map();
    private commonWGSL: string = "";
    private passes: IPass[] = [];
    private passLayouts: GPUBindGroupLayout[] = [];
    private bgCache: GPUBindGroup[][] = [];

    private mainPassShader: string = "";
    private mainPipeline!: GPURenderPipeline;
    private isCompiled = false;
    private startedAudio = false;
    private _mainDeps: string[] | undefined = undefined;

    private workgroupSize = { x: 8, y: 8, z: 1, str: "@workgroup_size(8, 8, 1)" };
    private globalSampler: GPUSampler | undefined;

    private constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const dpr = window.devicePixelRatio || 1;
        this.uniforms = new UniformLayout([this.canvas.width * dpr, this.canvas.height * dpr, dpr]);
    }

    /**
     * Initializes the WebGPU context and creates a TinyShade instance.
     * @param canvasId The ID of the HTML canvas element.
     */
    static async create(canvasId: string): Promise<TinyShade> {
        const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        const ts = new TinyShade(canvas);
        await ts.initWebGPU();
        return ts;
    }

    private async initWebGPU() {
        const adapter = await navigator.gpu?.requestAdapter();
        if (!adapter) throw "WebGPU not supported";
        const features: GPUFeatureName[] = [];
        if (adapter.features.has('bgra8unorm-storage')) features.push('bgra8unorm-storage');
        if (adapter.features.has('timestamp-query')) features.push('timestamp-query');

        this.device = await adapter.requestDevice({ requiredFeatures: features });
        this.globalSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.workgroupSize = getWorkgroupSize(adapter.limits);

        this.context = this.canvas.getContext("webgpu")!;
        this.context.configure({
            device: this.device,
            format: navigator.gpu.getPreferredCanvasFormat(),
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.startTime = performance.now();
    }

    private getRelevantPasses(currentPass: IPass): IPass[] {
        const base = currentPass.dependencies
            ? this.passes.filter(p => currentPass.dependencies!.includes(p.name))
            : this.passes;

        const resultSet = new Set(base);
        if (!currentPass.isMain) resultSet.add(currentPass);

        return Array.from(resultSet);
    }

    /**
     * Connects an audio plugin to synchronize uniforms with audio data.
     */
    addAudio(plugin: IAudioPlugin): this { this.audioPlugin = plugin; return this; }


    /**
     * Attaches a sequencer to the engine to drive sceneId, progress, and flags.
     */
    addSequencer(sequencer: TSSequencer): this {
        this.sequencer = sequencer;
        return this;
    }

    /**
     * Adds WGSL code that will be prepended to all subsequent pass shaders.
     * Useful for shared structs and constants.
     */
    addCommon(wgsl: string): this { this.commonWGSL += `\n${wgsl}\n`; return this; }

    /**
     * Loads an image into a global texture accessible by all passes.
     * @param name Name of the variable in WGSL (e.g., 'var tex: texture_2d<f32>').
     * @param src URL or image element source.
     */
    async addTexture(name: string, src: string | HTMLImageElement | HTMLCanvasElement): Promise<this> {
        let source: ImageBitmap | HTMLCanvasElement | HTMLImageElement;
        if (typeof src === 'string') {
            const img = new Image();
            img.src = src;
            await img.decode();
            source = await createImageBitmap(img);
        } else { source = src; }

        const texture = this.device.createTexture({
            size: [source.width, source.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.device.queue.copyExternalImageToTexture({ source }, { texture }, [source.width, source.height]);
        this.globalTextures.set(name, texture);
        return this;
    }

    /**
     * configures the global uniform layout.
     * @param callback Use this to add custom uniforms via layout.add().
     */
    setUniforms(callback?: (layout: UniformLayout) => void): this {
        if (callback) callback(this.uniforms);
        this.uniformBuffer = this.device.createBuffer({
            size: this.uniforms.byteSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        return this;
    }

    /**
     * Adds a GPGPU compute pass.
     * @param name Used to reference this pass result in others.
     * @param wgsl Compute shader code. Use '##WORKGROUP_SIZE' for auto-optimization.
     * @param size Optional size for a storage buffer (array<f32>).
     * @param deps List of pass names to read from.
     */
    addCompute(name: string, wgsl: string, size: number = 0, deps?: string[]): this {
        const tex = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: "rgba8unorm",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
        });
        let buf;
        if (size > 0) buf = this.device.createBuffer({ size: size * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.passes.push({ name, type: 'compute', shader: wgsl, textures: [tex], storageBuffer: buf, pipelines: [], dependencies: deps });
        return this;
    }

    /**
     * Adds a compute pass optimized for atomic operations (e.g., histograms, particle counters).
     */
    addAtomicCompute(name: string, wgsl: string, bufferSize: number, deps?: string[]): this {
        const buf = this.device.createBuffer({
            size: bufferSize * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
        });
        this.passes.push({ name, type: 'compute', shader: wgsl, storageBuffer: buf, isAtomic: true, pipelines: [], textures: [], dependencies: deps });
        return this;
    }

    /**
     * Adds a full-screen fragment pass.
     * This automatically manages two textures for feedback loops (ping-ponging).
     * @param name Name of the texture variable in WGSL.
     * @param wgsl Fragment shader code.
     * @param deps List of pass names to read from.
     */
    addPass(name: string, wgsl: string, deps?: string[]): this {
        const createTex = () => this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: "bgra8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.passes.push({ name, type: 'fragment', shader: wgsl, textures: [createTex(), createTex()], pipelines: [], dependencies: deps });
        return this;
    }

    /**
     * The final output pass that renders to the canvas.
     * Calling this triggers the shader compilation process.
     * @param wgsl Final fragment shader code.
     * @param deps Pass names to be sampled in the final output.
     */
    async main(wgsl: string, deps?: string[]): Promise<this> {
        this.mainPassShader = wgsl;
        this._mainDeps = deps;
        this.compile(deps);
        return this;
    }

    private compile(mainDeps?: string[]) {
        if (!this.uniformBuffer) this.setUniforms();

        const vertCode = `
            struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
            @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
                var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
                return VSOut(vec4f(p[i], 0.0, 1.0), vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5));
            }
        `;

        const allStages = [...this.passes, {
            name: "main", type: 'fragment', shader: this.mainPassShader,
            isMain: true, textures: [], pipelines: [], dependencies: mainDeps
        } as IPass];

        allStages.forEach((currentPass, stageIdx) => {
            let b = 0;
            const layoutEntries: GPUBindGroupLayoutEntry[] = [];
            let header = `${this.uniforms.wgslStruct}\n@group(0) @binding(${b}) var<uniform> u: Uniforms;\n`;
            layoutEntries.push({ binding: b++, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } });

            this.globalTextures.forEach((_, name) => {
                header += `@group(0) @binding(${b}) var ${name}: texture_2d<f32>;\n`;
                layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} });
            });

            header += `@group(0) @binding(${b}) var samp: sampler;\n`;
            layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, sampler: {} });

            this.getRelevantPasses(currentPass).forEach((p) => {
                const isSelf = (currentPass === p);
                if (p.type === 'compute') {
                    if (p.textures.length > 0) {
                        if (isSelf) {
                            header += `@group(0) @binding(${b}) var outTex: texture_storage_2d<rgba8unorm, write>;\n`;
                            layoutEntries.push({ binding: b++, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba8unorm', access: 'write-only' } });
                        } else {
                            header += `@group(0) @binding(${b}) var ${p.name}: texture_2d<f32>;\n`;
                            layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} });
                        }
                    }
                    if (p.storageBuffer) {
                        const bufName = isSelf ? "data" : `${p.name}_data`;
                        header += `@group(0) @binding(${b}) var<storage, read_write> ${bufName}: ${p.isAtomic ? "array<atomic<u32>>" : "array<f32>"};\n`;
                        layoutEntries.push({ binding: b++, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } });
                    }
                } else {
                    header += `@group(0) @binding(${b}) var ${p.name}: texture_2d<f32>;\n`;
                    layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} });
                    header += `@group(0) @binding(${b}) var prev_${p.name}: texture_2d<f32>;\n`;
                    layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} });
                }
            });

            const layout = this.device.createBindGroupLayout({ entries: layoutEntries });
            this.passLayouts[stageIdx] = layout;

            const code = (currentPass.type === 'fragment' ? vertCode : "") + header + this.commonWGSL +
                (currentPass.type === 'compute' ? currentPass.shader.replace("##WORKGROUP_SIZE", `@compute ${this.workgroupSize.str}`) : currentPass.shader);

            const mod = this.device.createShaderModule({ code });
            const pipeLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });

            if (currentPass.type === 'compute') {
                currentPass.pipelines[0] = this.device.createComputePipeline({ layout: pipeLayout, compute: { module: mod, entryPoint: 'main' } });
            } else {
                currentPass.pipelines[0] = this.device.createRenderPipeline({
                    layout: pipeLayout, vertex: { module: mod, entryPoint: 'vs' },
                    fragment: { module: mod, entryPoint: 'main', targets: [{ format: currentPass.isMain ? navigator.gpu.getPreferredCanvasFormat() : "bgra8unorm" }] }
                });
                if (currentPass.isMain) this.mainPipeline = currentPass.pipelines[0] as GPURenderPipeline;
            }
        });
        this.isCompiled = true;
    }

    private createBindGroup(stageIdx: number, writeIdx: number): GPUBindGroup {
        const readIdx = 1 - writeIdx;
        const isMainPass = stageIdx === this.passes.length;
        const currentPass = isMainPass
            ? { name: 'main', isMain: true, dependencies: this._mainDeps } as IPass
            : this.passes[stageIdx];

        const entries: GPUBindGroupEntry[] = [];
        let b = 0;

        entries.push({ binding: b++, resource: { buffer: this.uniformBuffer } });
        this.globalTextures.forEach(tex => entries.push({ binding: b++, resource: tex.createView() }));
        entries.push({ binding: b++, resource: this.globalSampler! });

        this.getRelevantPasses(currentPass).forEach((p) => {
            const isSelf = (currentPass === p);
            if (p.type === 'compute') {
                if (p.textures.length > 0) entries.push({ binding: b++, resource: p.textures[0].createView() });
                if (p.storageBuffer) entries.push({ binding: b++, resource: { buffer: p.storageBuffer } });
            } else {
                if (isSelf) {
                    entries.push({ binding: b++, resource: p.textures[readIdx].createView() });
                    entries.push({ binding: b++, resource: p.textures[readIdx].createView() });
                } else {
                    entries.push({ binding: b++, resource: p.textures[writeIdx].createView() });
                    entries.push({ binding: b++, resource: p.textures[readIdx].createView() });
                }
            }
        });

        return this.device.createBindGroup({ layout: this.passLayouts[stageIdx], entries });
    }

    /**
     * Starts the render loop.
     * @param timer Optional WebGPUTiming plugin for profiling.
     */
    run(timer?: WebGPUTiming): this {
        const frame = (now: number) => {
            if (!this.isCompiled) return;
            if (this.audioPlugin && !this.startedAudio) { this.audioPlugin.play(); this.startedAudio = true; }

            const time = (this.audioPlugin?.isPlaying) ? this.audioPlugin!.getTime() : (now - this.startTime) / 1000;
            const writeIdx = (this.frameCounter % 2);

            let sId = 0, sProg = 0, sFlags = 0;
            if (this.sequencer) {
                const state = this.sequencer.update(time);
                sId = state.sceneId;
                sProg = state.progress;
                sFlags = state.flags;
                this.uniforms.updateSequencer(sId, sProg, sFlags);
               
           
            }
            this.uniforms.update(time);

        
            
           // Buffer.write(this.device, this.uniformBuffer, this.uniforms.float32Array);

            this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms.float32Array as GPUAllowSharedBufferSource)

       

            const enc = this.device.createCommandEncoder();
            this.passes.forEach((p, i) => {
                if (p.isAtomic && p.storageBuffer) enc.clearBuffer(p.storageBuffer);
                const bg = this.createBindGroup(i, writeIdx);

                if (p.type === 'compute') {
                    const cp = enc.beginComputePass();
                    cp.setPipeline(p.pipelines[0] as GPUComputePipeline);
                    cp.setBindGroup(0, bg);
                    cp.dispatchWorkgroups(Math.ceil(this.canvas.width / this.workgroupSize.x), Math.ceil(this.canvas.height / this.workgroupSize.y), 1);
                    cp.end();
                } else {
                    const rp = enc.beginRenderPass({
                        colorAttachments: [{ view: p.textures[writeIdx].createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }]
                    });
                    rp.setPipeline(p.pipelines[0] as GPURenderPipeline);
                    rp.setBindGroup(0, bg);
                    rp.draw(3);
                    rp.end();
                }
            });

            const mainBG = this.createBindGroup(this.passes.length, writeIdx);
            const mp = enc.beginRenderPass({
                colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }]
            });
            mp.setPipeline(this.mainPipeline);
            mp.setBindGroup(0, mainBG);
            mp.draw(3);
            mp.end();

            this.device.queue.submit([enc.finish()]);
            this.frameCounter++;
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        return this;
    }
}