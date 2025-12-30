/**
 * A WebGPU-based shader runner for executing WGSL compute and render passes.
 * * Manages the initialization and execution of a shader graph consisting of multiple
 * compute and render passes. Handles GPU resource allocation, pipeline creation,
 * bind group management, and frame rendering with texture ping-ponging for
 * inter-pass communication.
 * * @example
 * ```typescript
 * const canvas = document.querySelector('canvas') as HTMLCanvasElement;
 * const runner = new TinyShadeRunner(canvas, shaderGraph);
 * await runner.init();
 * runner.run();
 * ```
 * * @class TinyShadeRunner
 * @property {GPUDevice} device - The WebGPU device
 * @property {GPUCanvasContext} context - The canvas WebGPU context
 * @property {GPUBuffer} uniformBuffer - Buffer for shader uniforms (canvas size, time)
 * @property {Map<string, GPURenderPipeline | GPUComputePipeline>} pipelines - Cached GPU pipelines by pass name
 * @property {Map<string, GPUBindGroupLayout>} layouts - Cached bind group layouts by pass name
 * @property {Map<string, GPUTexture[]>} passTextures - Ping-pong textures for each pass [read, write]
 * @property {GPUSampler} sampler - Linear filtering sampler for texture sampling
 */
export class TinyShadeRunner {
    private d!: GPUDevice; // device
    private c!: GPUCanvasContext; // context
    private u!: GPUBuffer; // uniformBuffer
    private p = new Map<string, GPURenderPipeline | GPUComputePipeline>(); // piplelines
    private l = new Map<string, GPUBindGroupLayout>(); //layouts
    private t = new Map<string, GPUTexture[]>(); // textures
    private s!: GPUSampler; //sampler

    constructor(private canvas: HTMLCanvasElement, private graph: any) {}

    async init() {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("");
        this.d = await adapter.requestDevice();
        this.c = this.canvas.getContext("webgpu")!;

        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.c.configure({
            device: this.d,
            format: presentationFormat,
            usage: 16 // GPUTextureUsage.RENDER_ATTACHMENT
        });

        this.s = this.d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.u = this.d.createBuffer({
            size: this.graph.uniforms.byteSize,
            usage: 72 // GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        for (const p of this.graph.passes) {
            const size = [this.graph.canvasSize.width, this.graph.canvasSize.height];

            if (p.type === 'compute' && !p.isMain) {
                this.t.set(p.name, [this.d.createTexture({
                    size, format: 'rgba8unorm',
                    usage: 12 // GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
                })]);
            } else if (!p.isMain) {
                const create = () => this.d.createTexture({
                    size, format: "bgra8unorm",
                    usage: 20 // GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
                });
                this.t.set(p.name, [create(), create()]);
            }

            const layoutEntries: GPUBindGroupLayoutEntry[] = [];
            const bindingRegex = /@binding\s*\(\s*(\d+)\s*\)\s+var\s*(?:<([^>]+)>)?\s*([\w\d_]+)/g;
            let match;
            const visibility = p.type === 'compute' ? 4 : 2; // GPUShaderStage.COMPUTE : GPUShaderStage.FRAGMENT

            while ((match = bindingRegex.exec(p.shader)) !== null) {
                const binding = parseInt(match[1]);
                const typeInfo = match[2] || "";
                const varName = match[3];

                if (typeInfo.includes("uniform")) {
                    layoutEntries.push({ binding, visibility, buffer: { type: 'uniform' } });
                } else if (typeInfo.includes("storage") || varName === "outTex") {
                    layoutEntries.push({ 
                        binding, visibility, 
                        storageTexture: { format: 'rgba8unorm', access: 'write-only' } 
                    });
                } else if (varName === "samp") {
                    layoutEntries.push({ binding, visibility, sampler: { type: 'filtering' } });
                } else {
                    layoutEntries.push({ binding, visibility, texture: { sampleType: 'float' } });
                }
            }

            const layout = this.d.createBindGroupLayout({ entries: layoutEntries });
            this.l.set(p.name, layout);

            const mod = this.d.createShaderModule({ code: p.shader });
            const pipelineLayout = this.d.createPipelineLayout({ bindGroupLayouts: [layout] });

            if (p.type === 'compute') {
                this.p.set(p.name, this.d.createComputePipeline({
                    layout: pipelineLayout, compute: { module: mod, entryPoint: 'main' }
                }));
            } else {
                this.p.set(p.name, this.d.createRenderPipeline({
                    layout: pipelineLayout,
                    vertex: { module: mod, entryPoint: 'vs' },
                    fragment: {
                        module: mod, entryPoint: 'main',
                        targets: [{ format: p.isMain ? presentationFormat : "bgra8unorm" }]
                    }
                }));
            }
        }
    }

    private createBindGroup(pass: any, writeIdx: number) {
        const layout = this.l.get(pass.name)!;
        const readIdx = 1 - writeIdx;
        const resources = new Map<string, GPUBindingResource>();

        resources.set("u", { buffer: this.u });
        resources.set("samp", this.s);

        for (const p of this.graph.passes) {
            if (p.isMain) continue;
            const texs = this.t.get(p.name)!;

            if (p.type === 'compute') {
                if (p.name === pass.name) resources.set("outTex", texs[0].createView());
                resources.set(p.name, texs[0].createView());
            } else {
                if (p.name === pass.name) {
                    resources.set(p.name, texs[readIdx].createView());
                    resources.set(`prev_${p.name}`, texs[readIdx].createView());
                } else {
                    resources.set(p.name, texs[writeIdx].createView());
                }
            }
        }

        const entries: GPUBindGroupEntry[] = [];
        const bindingRegex = /@binding\s*\(\s*(\d+)\s*\)\s+var\s*(?:<([^>]+)>)?\s*([\w\d_]+)/g;
        let match;
        while ((match = bindingRegex.exec(pass.shader)) !== null) {
            const binding = parseInt(match[1]);
            const res = resources.get(match[3]);
            if (res) entries.push({ binding, resource: res });
        }

        return this.d.createBindGroup({ layout, entries });
    }

    run() {
        let frame = 0;
        const render = (now: number) => {
            frame++;
            const writeIdx = frame % 2;
            const uData = new Float32Array([this.canvas.width, this.canvas.height, 0, now / 1000]);
            this.d.queue.writeBuffer(this.u, 0, uData);
            
            const enc = this.d.createCommandEncoder();

            for (const p of this.graph.passes) {
                const bg = this.createBindGroup(p, writeIdx);
                
                if (p.type === 'compute') {
                    const pass = enc.beginComputePass();
                    pass.setPipeline(this.p.get(p.name) as GPUComputePipeline);
                    pass.setBindGroup(0, bg);
                    pass.dispatchWorkgroups(Math.ceil(this.canvas.width / 16), Math.ceil(this.canvas.height / 16));
                    pass.end();
                } else {
                    const view = p.isMain 
                        ? this.c.getCurrentTexture().createView() 
                        : this.t.get(p.name)![writeIdx].createView();

                    const pass = enc.beginRenderPass({ 
                        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] 
                    });
                    pass.setPipeline(this.p.get(p.name) as GPURenderPipeline);
                    pass.setBindGroup(0, bg);
                    pass.draw(3);
                    pass.end();
                }
            }
            this.d.queue.submit([enc.finish()]);
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }
}