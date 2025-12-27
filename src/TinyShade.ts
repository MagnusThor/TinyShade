import { UniformLayout } from "./UniformLayout";

/**
 * Utility object for buffer operations.
 */
export const Buffer = {
  /**
   * Writes data to a GPU buffer.
   * @param device - The GPU device.
   * @param buffer - The target GPU buffer.
   * @param data - The data to write.
   * @param offset - The offset in the buffer to start writing at.
   * @returns The buffer that was written to.
   */
  write(
    device: GPUDevice,
    buffer: GPUBuffer,
    data: ArrayBufferView,
    offset = 0
  ): GPUBuffer {
    device.queue.writeBuffer(
      buffer,
      offset,
      data.buffer,
      data.byteOffset,
      data.byteLength
    );
    return buffer;
  }
};

/**
 * Response object for pass interceptors.
 */
export interface PassResponse {
    /** Optional render pass descriptor overrides. */
    descriptor?: Partial<GPURenderPassDescriptor>;
    /** Optional uniforms data. */
    uniforms?: Float32Array | number[];
}

/**
 * Interceptors for pass execution.
 */
export interface PassInterceptors {
    /** Called before the pass executes. */
    onBefore?: (uniforms: UniformLayout) => PassResponse | void;
    /** Called after the pass executes. */
    onAfter?: (result: { frame: number; timeMS: number }) => void;
}

/**
 * TinyShade - A WebGPU-based shader rendering engine for canvas graphics.
 * 
 * This class provides a high-level API for creating and managing GPU compute and render pipelines.
 * It supports multiple render passes, custom shader code injection, and frame-based animation.
  * @remarks
 * - Requires WebGPU support in the browser
 * - Manages GPU device, pipelines, and bind groups automatically
 * - Supports frame-synchronized rendering with optional GPU timing
 * - Passes are rendered in order before the final main pass
 * - Passes can access outputs from previous passes via texture bindings
 * 
 * @class
 */
export class TinyShade {
    /** The GPU device. */
    private device!: GPUDevice;
    /** The GPU canvas context. */
    private context!: GPUCanvasContext;
    /** The HTML canvas element. */
    private canvas: HTMLCanvasElement;
    /** The uniform layout manager. */
    private uniforms: UniformLayout;
    /** The uniform buffer. */
    private uniformBuffer!: GPUBuffer;
    /** The start time of the application. */
    private startTime = 0;
    /** The current frame counter. */
    public  frameCounter = 0;
    /** Workgroup size limits. */
    private workgroupLimits!: { str: string };

    /** Global common WGSL library code. */
    private commonWGSL: string = "";

    /** The compute pipeline. */
    private computePipeline: GPUComputePipeline | null = null;
    /** The compute bind group. */
    private computeBindGroup: GPUBindGroup | null = null;
    /** The storage buffer for compute. */
    private storageBuffer: GPUBuffer | null = null;
    /** The storage texture. */
    private storageTexture!: GPUTexture;

    /** Array of render passes. */
    private passes: {
        /** The WGSL shader code for the pass. */
        shader: string;
        /** Textures for the pass. */
        textures: GPUTexture[];
        /** Pipelines for the pass. */
        pipelines: GPURenderPipeline[];
        /** Bind groups for the pass. */
        bindGroups: GPUBindGroup[];
        /** Optional interceptors for the pass. */
        interceptors?: PassInterceptors;
    }[] = [];

    /** The main pass shader code. */
    private mainPassShader: string = "";
    /** The main render pipeline. */
    private mainPipeline!: GPURenderPipeline;
    /** The main bind group layout. */
    private mainBindGroupLayout!: GPUBindGroupLayout;
    /** Optional interceptors for the main pass. */
    private mainInterceptors?: PassInterceptors;

    /**
     * Private constructor to initialize TinyShade with a canvas.
     * @param canvas - The HTML canvas element.
     */
    private constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.uniforms = new UniformLayout([this.canvas.width, this.canvas.height, window.devicePixelRatio]);
    }

    /**
     * Creates a new TinyShade instance.
     * @param canvasId - The ID of the canvas element.
     * @returns A promise that resolves to the TinyShade instance.
     */
    static async create(canvasId: string): Promise<TinyShade> {
        const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        const ts = new TinyShade(canvas);
        await ts.initWebGPU();
        return ts;
    }

    /**
     * Initializes WebGPU by requesting an adapter and device, configuring the canvas context,
     * and creating a storage texture for rendering operations.
     * 
     * @remarks
     * - Requests a GPU adapter and device with optional timestamp-query feature support
     * - Sets up a workgroup size of 8x1x1 for compute shaders
     * - Configures the WebGPU canvas context with the preferred format
     * - Creates an RGBA8 storage texture matching the canvas dimensions for rendering and storage binding
     * - Records the initialization start time for performance tracking
     * 
     * @returns {Promise<void>}
     * 
     * @throws {Error} If GPU is not available or device creation fails
     */
    private async initWebGPU() {
        const adapter = await navigator.gpu.requestAdapter();
        const hasTimestamp = adapter?.features.has("timestamp-query");
        this.device = await adapter!.requestDevice({
            requiredFeatures: hasTimestamp ? ["timestamp-query"] as GPUFeatureName[] : []
        });

        const x = 8;
        this.workgroupLimits = { str: `@workgroup_size(${x}, 1, 1)` };
        this.context = this.canvas.getContext("webgpu")!;
        this.context.configure({ device: this.device, format: navigator.gpu.getPreferredCanvasFormat() });

        this.storageTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: "rgba8unorm",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });

        this.startTime = performance.now();
    }

    /**
     * Adds common WGSL code that will be shared across all shaders.
     * @param wgsl - The WGSL code string to add to the common section.
     * @returns The current instance for method chaining.
     */
    addCommon(wgsl: string): this {
        this.commonWGSL += `\n${wgsl}\n`;
        return this;
    }

    /**
     * Sets up the uniform buffer and optionally allows customization of the uniform layout.
     * @param callback - Optional callback function that receives the uniform layout for configuration
     * @returns The current instance for method chaining
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
     * Adds a compute shader to the renderer.
     * @param size - The size of the storage buffer in elements (f32). If 0, no storage buffer is created.
     * @param wgsl - The WebGPL Shading Language source code for the compute shader. 
     *               Use `##WORKGROUP_SIZE` placeholder for the workgroup size attribute.
     * @returns This instance for method chaining.
     * @remarks
     * - Creates a GPU storage buffer if size > 0
     * - Automatically injects uniform buffer, storage buffer binding, output texture, and common WGSL code
     * - The compute shader entry point must be named 'main'
     * - Bindings: 0 = uniforms, 1 = storage buffer (optional), 2 = output texture
     */
    addCompute(size: number, wgsl: string): this {
        if (size > 0) {
            this.storageBuffer = this.device.createBuffer({ size: size * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        }
        const dataBinding = size > 0 ? `@group(0) @binding(1) var<storage, read_write> data: array<f32>;` : "";
        const workgroupFullAttribute = `@compute ${this.workgroupLimits.str}`;
        
        // --- UPDATED: Injected commonWGSL before the user source ---
        const code = `
            ${this.uniforms.wgslStruct}
            @group(0) @binding(0) var<uniform> u: Uniforms;
            ${dataBinding}
            @group(0) @binding(2) var outTex: texture_storage_2d<rgba8unorm, write>;
            ${this.commonWGSL}
            ${wgsl.replace("##WORKGROUP_SIZE", workgroupFullAttribute)}
        `;

        const mod = this.device.createShaderModule({ code });
        this.computePipeline = this.device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
        const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 2, resource: this.storageTexture.createView() }];
        if (size > 0 && this.storageBuffer) entries.push({ binding: 1, resource: { buffer: this.storageBuffer } });
        this.computeBindGroup = this.device.createBindGroup({ layout: this.computePipeline.getBindGroupLayout(0), entries });
        return this;
    }

    /**
     * Adds a new render pass to the pipeline.
     * @param wgsl - The WebGPU Shading Language (WGSL) shader code for the pass
     * @param interceptors - Optional interceptors to hook into the pass lifecycle
     * @returns The current instance for method chaining
     */
    addPass(wgsl: string, interceptors?: PassInterceptors): this {
        const createTex = () => this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: "bgra8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.passes.push({ shader: wgsl, textures: [createTex(), createTex()], pipelines: [], bindGroups: [], interceptors });
        return this;
    }

    /**
     * Sets the main shader code and optional interceptors, then compiles the shader.
     * @param wgsl - The WGSL shader code for the main pass.
     * @param interceptors - Optional interceptors to apply to the main pass.
     * @returns This instance for method chaining.
     */
    main(wgsl: string, interceptors?: PassInterceptors): this {
        this.mainPassShader = wgsl;
        this.mainInterceptors = interceptors;
        this.compile();
        return this;
    }

    /**
     * Compiles shader modules and creates render pipelines for all rendering passes.
     * 
     * Sets up WebGPU render pipelines by:
     * - Creating a vertex shader that renders a full-screen triangle
     * - Building bind group layouts with uniforms, samplers, and texture bindings for each pass
     * - Compiling WGSL shader code that combines vertex, bindings, common utilities, and fragment shaders
     * - Generating render pipelines for each pass and the main output
     * - Creating bind groups with alternating read/write texture indices for ping-pong rendering
     * 
     * The main pass uses the canvas format, while intermediate passes use BGRA8unorm format.
     * Bind groups are created with ping-pong texture swapping (indices 0 and 1) for efficient multi-pass rendering.
     * 
     * @private
     */
    private compile() {
        const vert = `struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
        @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
            var p = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
            return VSOut(vec4f(p[i],0,1), p[i]*0.5+0.5);
        }`;
        const sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        [...this.passes, { shader: this.mainPassShader, isMain: true }].forEach((p: any, i) => {
            const isMain = p.isMain;
            const numPassesAvailable = isMain ? this.passes.length : i + 1;
            let passBindings = `${this.uniforms.wgslStruct}\n@group(0) @binding(0) var<uniform> u: Uniforms;\n@group(0) @binding(1) var samp: sampler;\n`;
            for (let j = 0; j < numPassesAvailable; j++) {
                passBindings += `@group(0) @binding(${2 + j * 2}) var pass${j}: texture_2d<f32>;\n@group(0) @binding(${2 + j * 2 + 1}) var prevPass${j}: texture_2d<f32>;\n`;
            }
            passBindings += `@group(0) @binding(${2 + this.passes.length * 2}) var computeTex: texture_2d<f32>;`;

            // --- UPDATED: Injected commonWGSL before the stage shader source ---
            const code = `${vert}${passBindings}${this.commonWGSL}${p.shader}`;
            
            const mod = this.device.createShaderModule({ code });
            const layoutEntries: GPUBindGroupLayoutEntry[] = [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }];
            for (let j = 0; j < numPassesAvailable; j++) {
                layoutEntries.push({ binding: 2 + j * 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, { binding: 2 + j * 2 + 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
            }
            layoutEntries.push({ binding: 2 + this.passes.length * 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
            const layout = this.device.createBindGroupLayout({ entries: layoutEntries });
            const pipe = this.device.createRenderPipeline({
                layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
                vertex: { module: mod, entryPoint: 'vs' },
                fragment: { module: mod, entryPoint: 'main', targets: [{ format: isMain ? navigator.gpu.getPreferredCanvasFormat() : "bgra8unorm" }] }
            });
            const createBG = (writeIdx: number) => {
                const readIdx = 1 - writeIdx;
                const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 1, resource: sampler }];
                for (let j = 0; j < numPassesAvailable; j++) {
                    entries.push({ binding: 2 + j * 2, resource: this.passes[j].textures[readIdx].createView() }, { binding: 2 + j * 2 + 1, resource: this.passes[j].textures[readIdx].createView() });
                }
                entries.push({ binding: 2 + this.passes.length * 2, resource: this.storageTexture.createView() });
                return this.device.createBindGroup({ layout, entries });
            };
            if (isMain) { this.mainPipeline = pipe; this.mainBindGroupLayout = layout; } 
            else { p.pipelines = [pipe, pipe]; p.bindGroups = [createBG(0), createBG(1)]; }
        });
    }

    /**
     * Starts the rendering loop for the shader.
     * 
     * This method initializes and runs a continuous animation frame loop that:
     * - Updates uniforms based on elapsed time
     * - Executes the compute pipeline if available
     * - Runs all registered render passes with their interceptors
     * - Renders the final output to the canvas
     * - Handles GPU timer queries for performance monitoring
     * - Invokes pass interceptor callbacks before and after rendering
     * 
     * @param gpuTimer - Optional GPU timer object for performance profiling. Should contain:
     *                   - supportsTimeStampQuery: boolean indicating timestamp support
     *                   - querySet: GPUQuerySet for timestamp queries
     *                   - resolveBuffer: GPUBuffer to resolve query results
     *                   - readBuffer: GPUBuffer to read resolved timestamps
     *                   - maxQueries: optional maximum number of queries (default: 20)
     * 
     * @remarks
     * - Uses double-buffering for render pass textures (writeIdx/readIdx pattern)
     * - Automatically handles bind group creation and pipeline management
     * - Continues indefinitely until page unload or explicit termination
     */
    run(gpuTimer?: any) {
        const sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        const frame = (now: number) => {
            this.frameCounter++;
            const writeIdx = this.frameCounter % 2;
            const readIdx = 1 - writeIdx;

            this.uniforms.update((now - this.startTime) / 1000);
            Buffer.write(this.device, this.uniformBuffer, this.uniforms.float32Array);

            const enc = this.device.createCommandEncoder();
            
            const clearRP = enc.beginRenderPass({ colorAttachments: [{ view: this.storageTexture.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
            clearRP.end();

            if (this.computePipeline) {
                const cp = enc.beginComputePass();
                cp.setPipeline(this.computePipeline);
                cp.setBindGroup(0, this.computeBindGroup!);
                cp.dispatchWorkgroups(Math.ceil(this.canvas.width / 8), Math.ceil(this.canvas.height / 8), 1);
                cp.end();
            }

            this.passes.forEach(p => {
                const res = p.interceptors?.onBefore?.(this.uniforms) as PassResponse;
                
                if (res?.uniforms) {
                    const data = res.uniforms instanceof Float32Array ? res.uniforms : new Float32Array(res.uniforms);
                    Buffer.write(this.device, this.uniformBuffer, data);
                }

                const descriptor: GPURenderPassDescriptor = {
                    colorAttachments: [{ view: p.textures[writeIdx].createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
                    ...(res?.descriptor || {})
                };
                
                const rp = enc.beginRenderPass(descriptor);
                rp.setPipeline(p.pipelines[writeIdx]);
                rp.setBindGroup(0, p.bindGroups[writeIdx]);
                rp.draw(3);
                rp.end();
            });

            const mainRes = this.mainInterceptors?.onBefore?.(this.uniforms) as PassResponse;
            if (mainRes?.uniforms) {
                const data = mainRes.uniforms instanceof Float32Array ? mainRes.uniforms : new Float32Array(mainRes.uniforms);
                Buffer.write(this.device, this.uniformBuffer, data);
            }

            const mainEntries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 1, resource: sampler }];
            for (let j = 0; j < this.passes.length; j++) {
                mainEntries.push({ binding: 2 + j * 2, resource: this.passes[j].textures[writeIdx].createView() }, { binding: 2 + j * 2 + 1, resource: this.passes[j].textures[readIdx].createView() });
            }
            mainEntries.push({ binding: 2 + this.passes.length * 2, resource: this.storageTexture.createView() });
            const dynamicMainBG = this.device.createBindGroup({ layout: this.mainBindGroupLayout, entries: mainEntries });

            const mp = enc.beginRenderPass({
                colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
                ...(mainRes?.descriptor || {})
            });
            mp.setPipeline(this.mainPipeline);
            mp.setBindGroup(0, dynamicMainBG);
            mp.draw(3);
            mp.end();

            if (gpuTimer?.supportsTimeStampQuery && gpuTimer.querySet) {
                enc.resolveQuerySet(gpuTimer.querySet, 0, gpuTimer.maxQueries || 20, gpuTimer.resolveBuffer!, 0);
                enc.copyBufferToBuffer(gpuTimer.resolveBuffer!, 0, gpuTimer.readBuffer!, 0, gpuTimer.resolveBuffer!.size);
            }

            this.device.queue.submit([enc.finish()]);

            const frameId = this.frameCounter;
            this.device.queue.onSubmittedWorkDone().then(() => {
                this.passes.forEach(p => p.interceptors?.onAfter?.({ frame: frameId, timeMS: 0 }));
                this.mainInterceptors?.onAfter?.({ frame: frameId, timeMS: 0 });
            });

            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }
}