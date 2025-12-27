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
 * Handles compute pipelines, multi-pass rendering, and global texture assets.
 */
export class TinyShade {
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private canvas: HTMLCanvasElement;
    private uniforms: UniformLayout;
    private uniformBuffer!: GPUBuffer;
    private startTime = 0;
    public frameCounter = 0;
    private workgroupLimits!: { str: string };

    /** Global common WGSL library code. */
    private commonWGSL: string = "";

    /** Map of texture names to their GPUTexture instances. */
    private globalTextures: Map<string, GPUTexture> = new Map();

    private computePipeline: GPUComputePipeline | null = null;
    private computeBindGroup: GPUBindGroup | null = null;
    private storageBuffer: GPUBuffer | null = null;
    private storageTexture!: GPUTexture;

    private passes: {
        shader: string;
        textures: GPUTexture[];
        pipelines: GPURenderPipeline[];
        bindGroups: GPUBindGroup[];
        interceptors?: PassInterceptors;
    }[] = [];

    private mainPassShader: string = "";
    private mainPipeline!: GPURenderPipeline;
    private mainBindGroupLayout!: GPUBindGroupLayout;
    private mainInterceptors?: PassInterceptors;

    private constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.uniforms = new UniformLayout([this.canvas.width, this.canvas.height, window.devicePixelRatio]);
    }

    /**
     * Creates a new TinyShade instance.
     * @param canvasId - The ID of the canvas element.
     */
    static async create(canvasId: string): Promise<TinyShade> {
        const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        const ts = new TinyShade(canvas);
        await ts.initWebGPU();
        return ts;
    }

    private async initWebGPU() {
        const adapter = await navigator.gpu.requestAdapter();
        const hasTimestamp = adapter?.features.has("timestamp-query");
        this.device = await adapter!.requestDevice({
            requiredFeatures: hasTimestamp ? ["timestamp-query"] as GPUFeatureName[] : []
        });

        this.workgroupLimits = { str: `@workgroup_size(8, 8, 1)` };
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
     * Adds a global texture asset from a URL or Element.
     * @param name - The variable name to use in WGSL (e.g., 'myTex').
     * @param src - URL string, Image, or Canvas element.
     */
    async addTexture(name: string, src: string | HTMLImageElement | HTMLCanvasElement): Promise<this> {
        let source: ImageBitmap | HTMLCanvasElement | HTMLImageElement;
        if (typeof src === 'string') {
            const img = new Image();
            img.src = src;
            await img.decode();
            source = await createImageBitmap(img);
        } else {
            source = src;
        }

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
     * Adds common WGSL logic shared across all stages.
     */
    addCommon(wgsl: string): this {
        this.commonWGSL += `\n${wgsl}\n`;
        return this;
    }

    setUniforms(callback?: (layout: UniformLayout) => void): this {
        if (callback) callback(this.uniforms);
        this.uniformBuffer = this.device.createBuffer({
            size: this.uniforms.byteSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        return this;
    }

    /**
     * Internal helper to generate WGSL header for all textures and common code.
     */
    private getHeader(startBinding: number): { wgsl: string, nextBinding: number } {
        let wgsl = "";
        let b = startBinding;
        this.globalTextures.forEach((_, name) => {
            wgsl += `@group(0) @binding(${b++}) var ${name}: texture_2d<f32>;\n`;
        });
        return { wgsl: wgsl + this.commonWGSL, nextBinding: b };
    }

    addCompute(size: number, wgsl: string): this {
        if (size > 0) {
            this.storageBuffer = this.device.createBuffer({ size: size * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        }
        const dataBinding = size > 0 ? `@group(0) @binding(1) var<storage, read_write> data: array<f32>;` : "";
        const header = this.getHeader(3);

        const code = `
            ${this.uniforms.wgslStruct}
            @group(0) @binding(0) var<uniform> u: Uniforms;
            ${dataBinding}
            @group(0) @binding(2) var outTex: texture_storage_2d<rgba8unorm, write>;
            ${header.wgsl}
            ${wgsl.replace("##WORKGROUP_SIZE", `@compute ${this.workgroupLimits.str}`)}
        `;

        const mod = this.device.createShaderModule({ code });
        this.computePipeline = this.device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
        
        const entries: GPUBindGroupEntry[] = [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 2, resource: this.storageTexture.createView() }
        ];
        if (size > 0 && this.storageBuffer) entries.push({ binding: 1, resource: { buffer: this.storageBuffer } });
        
        let b = 3;
        this.globalTextures.forEach(tex => entries.push({ binding: b++, resource: tex.createView() }));

        this.computeBindGroup = this.device.createBindGroup({ layout: this.computePipeline.getBindGroupLayout(0), entries });
        return this;
    }

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
     * Sets main shader and triggers compilation.
     */
    async main(wgsl: string, interceptors?: PassInterceptors): Promise<this> {
        this.mainPassShader = wgsl;
        this.mainInterceptors = interceptors;
        this.compile();
        return this;
    }

    private compile() {
        const vert = `struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
        @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
            var p = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
            return VSOut(vec4f(p[i],0,1), p[i]*0.5+0.5);
        }`;
        const sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        [...this.passes, { shader: this.mainPassShader, isMain: true }].forEach((p: any, i) => {
            const isMain = p.isMain;
            const numPasses = isMain ? this.passes.length : i + 1;
            let bindings = `${this.uniforms.wgslStruct}\n@group(0) @binding(0) var<uniform> u: Uniforms;\n@group(0) @binding(1) var samp: sampler;\n`;
            
            for (let j = 0; j < numPasses; j++) {
                bindings += `@group(0) @binding(${2 + j * 2}) var pass${j}: texture_2d<f32>;\n@group(0) @binding(${2 + j * 2 + 1}) var prevPass${j}: texture_2d<f32>;\n`;
            }
            const computeBindPos = 2 + this.passes.length * 2;
            bindings += `@group(0) @binding(${computeBindPos}) var computeTex: texture_2d<f32>;\n`;

            const header = this.getHeader(computeBindPos + 1);
            const code = `${vert}${bindings}${header.wgsl}${p.shader}`;
            const mod = this.device.createShaderModule({ code });

            const layoutEntries: GPUBindGroupLayoutEntry[] = [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
            ];
            for (let j = 0; j < numPasses; j++) {
                layoutEntries.push(
                    { binding: 2 + j * 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                    { binding: 2 + j * 2 + 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
                );
            }
            layoutEntries.push({ binding: computeBindPos, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
            
            let b = computeBindPos + 1;
            this.globalTextures.forEach(() => {
                layoutEntries.push({ binding: b++, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
            });

            const layout = this.device.createBindGroupLayout({ entries: layoutEntries });
            const pipe = this.device.createRenderPipeline({
                layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
                vertex: { module: mod, entryPoint: 'vs' },
                fragment: { module: mod, entryPoint: 'main', targets: [{ format: isMain ? navigator.gpu.getPreferredCanvasFormat() : "bgra8unorm" }] }
            });

            const createBG = (writeIdx: number) => {
                const readIdx = 1 - writeIdx;
                const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 1, resource: sampler }];
                for (let j = 0; j < numPasses; j++) {
                    entries.push(
                        { binding: 2 + j * 2, resource: this.passes[j].textures[readIdx].createView() },
                        { binding: 2 + j * 2 + 1, resource: this.passes[j].textures[readIdx].createView() }
                    );
                }
                entries.push({ binding: computeBindPos, resource: this.storageTexture.createView() });
                let gb = computeBindPos + 1;
                this.globalTextures.forEach(tex => entries.push({ binding: gb++, resource: tex.createView() }));
                return this.device.createBindGroup({ layout, entries });
            };

            if (isMain) { this.mainPipeline = pipe; this.mainBindGroupLayout = layout; } 
            else { p.pipelines = [pipe, pipe]; p.bindGroups = [createBG(0), createBG(1)]; }
        });
    }

    run(gpuTimer?: any): this{
        const sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        const frame = (now: number) => {
            this.frameCounter++;
            const writeIdx = this.frameCounter % 2;
            const readIdx = 1 - writeIdx;

            this.uniforms.update((now - this.startTime) / 1000);
            Buffer.write(this.device, this.uniformBuffer, this.uniforms.float32Array);

            const enc = this.device.createCommandEncoder();
            
            // Clear storage
            enc.beginRenderPass({ colorAttachments: [{ view: this.storageTexture.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] }).end();

            if (this.computePipeline) {
                const cp = enc.beginComputePass();
                cp.setPipeline(this.computePipeline);
                cp.setBindGroup(0, this.computeBindGroup!);
                cp.dispatchWorkgroups(Math.ceil(this.canvas.width / 8), Math.ceil(this.canvas.height / 8), 1);
                cp.end();
            }

            this.passes.forEach(p => {
                const res = p.interceptors?.onBefore?.(this.uniforms) as PassResponse;
                if (res?.uniforms) Buffer.write(this.device, this.uniformBuffer, res.uniforms instanceof Float32Array ? res.uniforms : new Float32Array(res.uniforms));

                const rp = enc.beginRenderPass({
                    colorAttachments: [{ view: p.textures[writeIdx].createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
                    ...(res?.descriptor || {})
                });
                rp.setPipeline(p.pipelines[writeIdx]);
                rp.setBindGroup(0, p.bindGroups[writeIdx]);
                rp.draw(3);
                rp.end();
            });

            const mainRes = this.mainInterceptors?.onBefore?.(this.uniforms) as PassResponse;
            if (mainRes?.uniforms) Buffer.write(this.device, this.uniformBuffer, mainRes.uniforms instanceof Float32Array ? mainRes.uniforms : new Float32Array(mainRes.uniforms));

            // Dynamic Main Bind Group creation
            const mainEntries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 1, resource: sampler }];
            for (let j = 0; j < this.passes.length; j++) {
                mainEntries.push(
                    { binding: 2 + j * 2, resource: this.passes[j].textures[writeIdx].createView() },
                    { binding: 2 + j * 2 + 1, resource: this.passes[j].textures[readIdx].createView() }
                );
            }
            const cPos = 2 + this.passes.length * 2;
            mainEntries.push({ binding: cPos, resource: this.storageTexture.createView() });
            let gb = cPos + 1;
            this.globalTextures.forEach(tex => mainEntries.push({ binding: gb++, resource: tex.createView() }));

            const dynamicMainBG = this.device.createBindGroup({ layout: this.mainBindGroupLayout, entries: mainEntries });

            const mp = enc.beginRenderPass({
                colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
                ...(mainRes?.descriptor || {})
            });
            mp.setPipeline(this.mainPipeline);
            mp.setBindGroup(0, dynamicMainBG);
            mp.draw(3);
            mp.end();

            this.device.queue.submit([enc.finish()]);

            const frameId = this.frameCounter;
            this.device.queue.onSubmittedWorkDone().then(() => {
                this.passes.forEach(p => p.interceptors?.onAfter?.({ frame: frameId, timeMS: 0 }));
                this.mainInterceptors?.onAfter?.({ frame: frameId, timeMS: 0 });
            });

            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        return this;
    }
}