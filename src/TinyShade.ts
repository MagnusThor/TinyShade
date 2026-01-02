import { IAudioPlugin } from "./plugins/IAudioPlugin";
import { WebGPUTiming } from "./plugins/WebGPUTiming";
import { UniformLayout } from "./UniformLayout";


const Buffer = {
    write(device: GPUDevice, buffer: GPUBuffer, data: ArrayBufferView, offset = 0): GPUBuffer {
        device.queue.writeBuffer(buffer, offset, data.buffer, data.byteOffset, data.byteLength);
        return buffer;
    }
};

const largestPowerOf2LessThan = (n: number): number => {
    let power = 1;
    while (power * 2 <= n) power *= 2;
    return power;
};

const getWorkgroupSize = (limits: GPUSupportedLimits) => {
    const x = Math.min(16, largestPowerOf2LessThan(limits.maxComputeWorkgroupSizeX));
    const y = Math.min(16, largestPowerOf2LessThan(limits.maxComputeWorkgroupSizeY));
    return { x, y, z: 1, str: `@workgroup_size(${x}, ${y}, 1)` };
};



export interface IPass {
    name: string;
    type: 'compute' | 'fragment';
    shader: string;
    textures: GPUTexture[];
    pipelines: (GPURenderPipeline | GPUComputePipeline)[];
    storageBuffer?: GPUBuffer;
    isAtomic?: boolean;
    isMain?: boolean;
}

/**
 * TinyShade - A WebGPU-based shader rendering framework
 * 
 * A flexible shader renderer that supports multiple render passes, compute shaders,
 * textures, and audio synchronization. Provides a fluent API for composing complex
 * GPU pipelines with automatic uniform management and bind group generation.
 * 
 * @example
 * ```typescript
 * const shade = await TinyShade.create('canvas-id');
 * 
 * shade
 *   .addTexture('myTexture', 'path/to/image.png')
 *   .setUniforms((layout) => layout.setUniform('myUniform', 1.0))
 *   .addCommon('fn myHelper() { ... }')
 *   .addCompute('computePass', 'compute shader code')
 *   .addPass('renderPass', 'fragment shader code')
 *   .main('main fragment shader')
 *   .run();
 * ```
 * 
 * @class TinyShade
 * @property {GPUDevice} device - The WebGPU device instance
 * @property {number} frameCounter - Current frame number
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

    private globalTextures: Map<string, GPUTexture> = new Map();
    private commonWGSL: string = "";
    private passes: IPass[] = [];
    private passLayouts: GPUBindGroupLayout[] = [];

    private mainPassShader: string = "";
    private mainPipeline!: GPURenderPipeline;
    private isCompiled = false;
    private startedAudio = false;

    private workgroupSize = { x: 8, y: 8, z: 1, str: "@workgroup_size(8, 8, 1)" };

    private constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const dpr = window.devicePixelRatio || 1;
        this.uniforms = new UniformLayout([this.canvas.width*dpr, this.canvas.height*dpr, dpr]);
    
    }


    /**
     * Creates and initializes a new TinyShade instance with WebGPU support.
     * @param canvasId - The HTML element ID of the canvas to bind to the renderer
     * @returns A promise that resolves to an initialized TinyShade instance
     * @throws If the canvas element with the specified ID is not found
     * @throws If WebGPU initialization fails
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

        this.workgroupSize = getWorkgroupSize(adapter.limits);

        this.context = this.canvas.getContext("webgpu")!;
        this.context.configure({
            device: this.device,
            format: navigator.gpu.getPreferredCanvasFormat(),
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });

        this.startTime = performance.now();
    }


    /**
     * Adds an audio plugin to the shader instance.
     * @param plugin - The audio plugin to be added.
     * @returns The current instance for method chaining.
     */
    addAudio(plugin: IAudioPlugin): this {
        this.audioPlugin = plugin;
        console.log(this.audioPlugin);
        return this;
    }

    /**
     * Adds common WGSL code to the shader.
     * @param wgsl - The WGSL code string to add to the common section.
     * @returns The current instance for method chaining.
     */
    addCommon(wgsl: string): this {
        this.commonWGSL += `\n${wgsl}\n`;
        return this;
    }

    /**
     * Adds a texture to the shader with the specified name.
     * @param name - The name to associate with the texture
     * @param src - The texture source, either a URL string, HTMLImageElement, or HTMLCanvasElement
     * @returns A promise that resolves to this instance for method chaining
     * @throws Will throw if the image fails to load or decode
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
     * Sets up the uniform buffer and optionally applies a callback to the uniform layout.
     * @param callback - Optional callback function that receives the uniform layout for configuration.
     * @returns The current instance for method chaining.
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
     * Adds a compute shader pass to the rendering pipeline.
     * @param name - The name identifier for this compute pass.
     * @param wgsl - The WGSL shader code to execute.
     * @param size - Optional size of the storage buffer in units (default: 0). If greater than 0, a storage buffer of size * 4 bytes will be created.
     * @returns The current instance for method chaining.
     */
    addCompute(name: string, wgsl: string, size: number = 0): this {
        const tex = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: "rgba8unorm",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
        });
        let buf;
        if (size > 0) buf = this.device.createBuffer({ size: size * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.passes.push({ name: name, type: 'compute', shader: wgsl, textures: [tex], storageBuffer: buf, pipelines: [] });
        return this;
    }

    /**
     * Adds an atomic compute shader pass to the renderer.
     * @param name - The name identifier for this compute pass
     * @param wgsl - The WGSL shader code for the compute shader
     * @param bufferSize - The number of u32 elements in the storage buffer
     * @returns This instance for method chaining
     */
    addAtomicCompute(name: string, wgsl: string, bufferSize: number): this {
        const buf = this.device.createBuffer({
            size: bufferSize * 4, // 4 bytes for u32
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
        });

      this.passes.push({
            name,
            type: 'compute',
            shader: wgsl,
            storageBuffer: buf,
            isAtomic: true, 
            pipelines: [],
            textures: []
        });
        return this;
    }

    /**
     * Adds a render pass to the shader pipeline.
     * @param name - The name identifier for the pass
     * @param wgsl - The WGSL shader code for the fragment stage
     * @returns The current instance for method chaining
     */
    addPass(name: string, wgsl: string): this {
        const createTex = () => this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: "bgra8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.passes.push({ name: name, type: 'fragment', shader: wgsl, textures: [createTex(), createTex()], pipelines: [] });
        return this;
    }

    /**
     * Sets the main pass shader and compiles it.
     * @param wgsl - The WGSL shader code to set as the main pass shader.
     * @returns A promise that resolves to this instance for method chaining.
     */
    async main(wgsl: string): Promise<this> {
        this.mainPassShader = wgsl;
        this.compile();
        return this;
    }



    private compile() {
        if (!this.uniformBuffer) this.setUniforms();

        const vertCode = `
        struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
        @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
            var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
            return VSOut(vec4f(p[i], 0.0, 1.0), vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5));
        }
    `;

        const allStages = [...this.passes, {
            name: "main",
            type: 'fragment',
            shader: this.mainPassShader,
            isMain: true,
            textures: [],
            pipelines: []
        } as IPass];

        allStages.forEach((currentPass, stageIdx) => {
            let b = 1; // Binding 0 is always Uniforms
            const layoutEntries: GPUBindGroupLayoutEntry[] = [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: { type: 'uniform' }
            }];

            let header = `${this.uniforms.wgslStruct}\n@group(0) @binding(0) var<uniform> u: Uniforms;\n`;

            // Global Textures
            this.globalTextures.forEach((_, name) => {
                header += `@group(0) @binding(${b}) var ${name}: texture_2d<f32>;\n`;
                layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} });
            });

            // Global Sampler
            header += `@group(0) @binding(${b}) var samp: sampler;\n`;
            layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, sampler: {} });

            // Pass-specific Resources
            this.passes.forEach((p) => {
                if (p.type === 'compute') {
                    // 1. Storage Textures (Only if the pass has one)
                    if (p.textures.length > 0) {
                        if (currentPass === p) {
                            header += `@group(0) @binding(${b}) var outTex: texture_storage_2d<rgba8unorm, write>;\n`;
                            layoutEntries.push({ binding: b++, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba8unorm', access: 'write-only' } });
                        } else {
                            header += `@group(0) @binding(${b}) var ${p.name}: texture_2d<f32>;\n`;
                            layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} });
                        }
                    }

                    // 2. Storage Buffers (Atomic or Standard)
                    if (p.storageBuffer) {
                        const isOwner = (currentPass === p);
                        const arrayType = p.isAtomic ? "array<atomic<u32>>" : "array<f32>";
                        const bufName = isOwner ? "data" : `${p.name}_data`;

                        header += `@group(0) @binding(${b}) var<storage, read_write> ${bufName}: ${arrayType};\n`;
                        layoutEntries.push({
                            binding: b++,
                            visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                            buffer: { type: 'storage' }
                        });
                    }
                } else {
                    // Fragment Pass Textures (Ping-Pong)
                    header += `@group(0) @binding(${b}) var ${p.name}: texture_2d<f32>;\n`;
                    layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} });
                    header += `@group(0) @binding(${b}) var prev_${p.name}: texture_2d<f32>;\n`;
                    layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} });
                }
            });

            const layout = this.device.createBindGroupLayout({ entries: layoutEntries });
            this.passLayouts[stageIdx] = layout;

            const code = (currentPass.type === 'fragment' ? vertCode : "") +
                header +
                this.commonWGSL +
                (currentPass.type === 'compute'
                    ? currentPass.shader.replace("##WORKGROUP_SIZE", `@compute ${this.workgroupSize.str}`)
                    : currentPass.shader);

            const mod = this.device.createShaderModule({ code });
            const pipeLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });

            if (currentPass.type === 'compute') {
                currentPass.pipelines[0] = this.device.createComputePipeline({
                    layout: pipeLayout,
                    compute: { module: mod, entryPoint: 'main' }
                });
            } else {
                currentPass.pipelines[0] = this.device.createRenderPipeline({
                    layout: pipeLayout,
                    vertex: { module: mod, entryPoint: 'vs' },
                    fragment: {
                        module: mod,
                        entryPoint: 'main',
                        targets: [{ format: currentPass.isMain ? navigator.gpu.getPreferredCanvasFormat() : "bgra8unorm" }]
                    }
                });
                if (currentPass.isMain) this.mainPipeline = currentPass.pipelines[0] as GPURenderPipeline;
            }
        });
        this.isCompiled = true;
    }


    private createBindGroup(stageIdx: number, writeIdx: number): GPUBindGroup {
        const readIdx = 1 - writeIdx;
        const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }];
        let b = 1;

        // Global Textures
        this.globalTextures.forEach(tex => entries.push({ binding: b++, resource: tex.createView() }));

        // Global Sampler
        entries.push({
            binding: b++,
            resource: this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
        });

        // Pass-specific Resources
        this.passes.forEach((p, i) => {
            if (p.type === 'compute') {
                // 1. Texture View
                if (p.textures.length > 0) {
                    // If it's a storage texture being written to, use standard view. 
                    // WebGPU automatically handles the usage based on the Layout.
                    entries.push({ binding: b++, resource: p.textures[0].createView() });
                }

                // 2. Storage Buffer
                if (p.storageBuffer) {
                    entries.push({ binding: b++, resource: { buffer: p.storageBuffer } });
                }
            } else {
                // Fragment Pass Ping-Pong views
                if (i === stageIdx) {
                    // Currently writing to writeIdx, so we read from readIdx
                    entries.push({ binding: b++, resource: p.textures[readIdx].createView() });
                    entries.push({ binding: b++, resource: p.textures[readIdx].createView() });
                } else {
                    // For other stages, just provide the most recent complete data
                    entries.push({ binding: b++, resource: p.textures[writeIdx].createView() });
                    entries.push({ binding: b++, resource: p.textures[readIdx].createView() });
                }
            }
        });

        return this.device.createBindGroup({ layout: this.passLayouts[stageIdx], entries });
    }


    /**
     * Starts the rendering loop and begins frame rendering.
     * 
     * @param timer - Optional WebGPU timing utility for performance measurement of render passes
     * @returns Returns `this` for method chaining
     * 
     * @remarks
     * This method initiates a continuous animation loop using `requestAnimationFrame`.
     * For each frame, it:
     * - Manages audio plugin playback if available
     * - Updates uniforms based on elapsed time or audio time
     * - Executes all render/compute passes with optional timing queries
     * - Renders the final output to the canvas
     * - Submits all commands to the GPU queue
     * 
     * The method alternates between two texture buffers using a ping-pong pattern
     * to allow passes to read from and write to textures without conflicts.
     * 
     * @example
     * ```typescript
     * const shader = new TinyShade();
     * shader.compile();
     * const timer = new WebGPUTiming(device);
     * shader.run(timer);
     * ```
     */
    run(timer?: WebGPUTiming): this {
        const frame = (now: number) => {
            if (!this.isCompiled) return;

            if (this.audioPlugin && !this.startedAudio) {
                this.audioPlugin.play();
                this.startedAudio = true;
            }

            const useAudioTime = this.audioPlugin && this.audioPlugin.isPlaying;
            const time = useAudioTime
                ? this.audioPlugin!.getTime()
                : (now - this.startTime) / 1000;

            const writeIdx = (this.frameCounter % 2);

            this.uniforms.update(time);
            Buffer.write(this.device, this.uniformBuffer, this.uniforms.float32Array);

            const enc = this.device.createCommandEncoder();
            const passTimings: { name: string, start: number, end: number }[] = [];
            if (timer) timer.reset();

            this.passes.forEach((p, i) => {
                if (p.isAtomic && p.storageBuffer) {
                    enc.clearBuffer(p.storageBuffer);
                }
                const bg = this.createBindGroup(i, writeIdx);
                let tw: GPURenderPassTimestampWrites | undefined;

                if (timer) {
                    const idx = timer.allocateIndices();
                    if (idx) {
                        tw = {
                            querySet: timer.querySet!,
                            beginningOfPassWriteIndex: idx.start,
                            endOfPassWriteIndex: idx.end
                        };
                        passTimings.push({ name: p.name, ...idx });
                    }
                }

                if (p.type === 'compute') {
                    const cp = enc.beginComputePass({ timestampWrites: tw as any });
                    cp.setPipeline(p.pipelines[0] as GPUComputePipeline);
                    cp.setBindGroup(0, bg);


                    cp.dispatchWorkgroups(
                        Math.ceil(this.canvas.width / this.workgroupSize.x),
                        Math.ceil(this.canvas.height / this.workgroupSize.y),
                        1
                    );

                    cp.end();
                } else {
                    const rp = enc.beginRenderPass({
                        colorAttachments: [{
                            view: p.textures[writeIdx].createView(),
                            loadOp: "clear",
                            storeOp: "store",
                            clearValue: [0, 0, 0, 1]
                        }],
                        timestampWrites: tw
                    });
                    rp.setPipeline(p.pipelines[0] as GPURenderPipeline);
                    rp.setBindGroup(0, bg);
                    rp.draw(3);
                    rp.end();
                }
            });


            let mtw: GPURenderPassTimestampWrites | undefined;
            if (timer) {
                const idx = timer.allocateIndices();
                if (idx) {
                    mtw = {
                        querySet: timer.querySet!,
                        beginningOfPassWriteIndex: idx.start,
                        endOfPassWriteIndex: idx.end
                    };
                    passTimings.push({ name: "main", ...idx });
                }
            }

            const mp = enc.beginRenderPass({
                colorAttachments: [{
                    view: this.context.getCurrentTexture().createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: [0, 0, 0, 1]
                }],
                timestampWrites: mtw
            });
            mp.setPipeline(this.mainPipeline);
            mp.setBindGroup(0, this.createBindGroup(this.passes.length, writeIdx));
            mp.draw(3);
            mp.end();

            this.device.queue.submit([enc.finish()]);

            if (timer) timer.resolve(passTimings);

            this.frameCounter++;
            requestAnimationFrame(frame);
        };

        requestAnimationFrame(frame);
        return this;
    }

}