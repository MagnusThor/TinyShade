import { Buffer } from "./Buffer";
import { UniformLayout } from "./UniformLayout";

export interface PassResponse {
    descriptor?: Partial<GPURenderPassDescriptor>;
    uniforms?: Float32Array | number[];
}

export interface PassInterceptors {
    onBefore?: (uniforms: UniformLayout) => PassResponse | void;
    onAfter?: (result: { frame: number; timeMS: number }) => void;
}

export class TinyShade {
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private canvas: HTMLCanvasElement;
    private uniforms: UniformLayout;
    private uniformBuffer!: GPUBuffer;
    private startTime = 0;
    public  frameCounter = 0;
    private workgroupLimits!: { str: string };

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

    setUniforms(callback?: (layout: UniformLayout) => void): this {
        if (callback) callback(this.uniforms);
        this.uniformBuffer = this.device.createBuffer({
            size: this.uniforms.byteSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        return this;
    }

    addCompute(size: number, wgsl: string): this {
        if (size > 0) {
            this.storageBuffer = this.device.createBuffer({ size: size * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        }
        const dataBinding = size > 0 ? `@group(0) @binding(1) var<storage, read_write> data: array<f32>;` : "";
        const workgroupFullAttribute = `@compute ${this.workgroupLimits.str}`;
        const code = `${this.uniforms.wgslStruct}\n@group(0) @binding(0) var<uniform> u: Uniforms;\n${dataBinding}\n@group(0) @binding(2) var outTex: texture_storage_2d<rgba8unorm, write>;\n${wgsl.replace("##WORKGROUP_SIZE", workgroupFullAttribute)}`;
        const mod = this.device.createShaderModule({ code });
        this.computePipeline = this.device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
        const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 2, resource: this.storageTexture.createView() }];
        if (size > 0 && this.storageBuffer) entries.push({ binding: 1, resource: { buffer: this.storageBuffer } });
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

    main(wgsl: string, interceptors?: PassInterceptors): this {
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
            const numPassesAvailable = isMain ? this.passes.length : i + 1;
            let passBindings = `${this.uniforms.wgslStruct}\n@group(0) @binding(0) var<uniform> u: Uniforms;\n@group(0) @binding(1) var samp: sampler;\n`;
            for (let j = 0; j < numPassesAvailable; j++) {
                passBindings += `@group(0) @binding(${2 + j * 2}) var pass${j}: texture_2d<f32>;\n@group(0) @binding(${2 + j * 2 + 1}) var prevPass${j}: texture_2d<f32>;\n`;
            }
            passBindings += `@group(0) @binding(${2 + this.passes.length * 2}) var computeTex: texture_2d<f32>;`;
            const code = `${vert}${passBindings}${p.shader}`;
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