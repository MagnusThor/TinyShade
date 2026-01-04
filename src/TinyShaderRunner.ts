import { IAudioPlugin } from "./plugins/IAudioPlugin";
import { TSSequencer } from "./TSSequencer";

/**
 * TinyShadeRunner
 * Handles the execution of a baked TinyShade graph.
 */
export class TinyShadeRunner {
    private d!: GPUDevice;
    private c!: GPUCanvasContext;
    private u!: GPUBuffer;
    private p = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    private l = new Map<string, GPUBindGroupLayout>();
    private t = new Map<string, GPUTexture[]>();
    private s!: GPUSampler;
    private a: IAudioPlugin | undefined;

    private q: TSSequencer | undefined;


    constructor(private h: HTMLCanvasElement, private g: any) { }

    async init() {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("WebGPU adapter not available");

        this.d = await adapter.requestDevice();
        this.c = this.h.getContext("webgpu")!;

        const dpr = window.devicePixelRatio || 1;
        this.h.width = this.h.width * dpr;
        this.h.height = this.h.height * dpr;

        if (this.g.audio) {
            const { code, data, activator } = this.g.audio;
            const AudioClass = new Function(`${code}; return GPUSynth;`)();
            this.a = new AudioClass(this.d, data, ...(activator ?? [])) as IAudioPlugin;
        }

        if (this.g.sequencer) {
            const { code, data, activator } = this.g.sequencer;
            const SeqClass = new Function(`${code}; return TSSequencer;`)();
            this.q = new SeqClass(data.timeline, data.L, data.bpm, data.rowsPerBeat, ...(activator ?? []));
        }

        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.c.configure({
            device: this.d,
            format: presentationFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });

        this.s = this.d.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        this.u = this.d.createBuffer({
            size: this.g.uniforms.byteSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        for (const p of this.g.passes) {
            const size = [this.g.canvasSize.width, this.g.canvasSize.height];

            if (!p.isMain) {
                if (p.type === 'compute') {
                    this.t.set(p.name, [
                        this.d.createTexture({
                            size,
                            format: 'rgba8unorm',
                            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
                        })
                    ]);
                } else {
                    const create = () =>
                        this.d.createTexture({
                            size,
                            format: "bgra8unorm",
                            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
                        });
                    this.t.set(p.name, [create(), create()]);
                }
            }

            const layoutEntries: GPUBindGroupLayoutEntry[] = [];
            const bindingRegex = /@binding\s*\(\s*(\d+)\s*\)\s+var\s*(?:<([^>]+)>)?\s*([\w\d_]+)/g;
            let match;
            const visibility = p.type === 'compute' ? GPUShaderStage.COMPUTE : GPUShaderStage.FRAGMENT;

            while ((match = bindingRegex.exec(p.shader)) !== null) {
                const binding = parseInt(match[1]);
                const typeInfo = match[2] || "";
                const varName = match[3];

                if (typeInfo.includes("uniform")) {
                    layoutEntries.push({ binding, visibility, buffer: { type: 'uniform' } });
                } else if (varName === "outTex") {
                    layoutEntries.push({
                        binding,
                        visibility,
                        storageTexture: { format: 'rgba8unorm', access: 'write-only' }
                    });
                } else if (typeInfo.includes("storage")) {
                    layoutEntries.push({ binding, visibility, buffer: { type: 'storage' } });
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
                    layout: pipelineLayout,
                    compute: { module: mod, entryPoint: 'main' }
                }));
            } else {
                this.p.set(p.name, this.d.createRenderPipeline({
                    layout: pipelineLayout,
                    vertex: { module: mod, entryPoint: 'vs' },
                    fragment: {
                        module: mod,
                        entryPoint: 'main',
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

        for (const p of this.g.passes) {
            if (p.isMain) continue;
            const texs = this.t.get(p.name)!;

            if (p.type === 'compute') {
                if (p.name === pass.name) {
                    resources.set("outTex", texs[0].createView());
                }
                resources.set(p.name, texs[0].createView());
            } else {
                resources.set(p.name, texs[readIdx].createView());
                resources.set(`prev_${p.name}`, texs[readIdx].createView());
            }
        }

        const entries: GPUBindGroupEntry[] = [];
        const bindingRegex = /@binding\s*\(\s*(\d+)\s*\)\s+var\s*(?:<([^>]+)>)?\s*([\w\d_]+)/g;

        bindingRegex.lastIndex = 0;

        let match;
        while ((match = bindingRegex.exec(pass.shader)) !== null) {
            const binding = parseInt(match[1]);
            const varName = match[3];
            const res = resources.get(varName);

            if (res) {
                entries.push({ binding, resource: res });
            } else {
                console.error(`Missing resource for @binding(${binding}) var ${varName}`);
            }
        }

        return this.d.createBindGroup({ layout, entries });
    }

    run() {
        const audioPlugin = this.a;
        let frame = 0;
        if (audioPlugin) audioPlugin.play();

        const render = (now: number) => {
            frame++;
            const writeIdx = frame % 2;
            const time = (audioPlugin && audioPlugin.isPlaying) ? audioPlugin.getTime() : now / 1000;

            // Update Sequencer State
            let sId = 0, sProg = 0, sFlags = 0;
            if (this.q) {
                const state = this.q.update(time);
                sId = state.sceneId;
                sProg = state.progress;
                sFlags = state.flags;
            }

            const uData = new Float32Array([
                this.h.width,
                this.h.height,
                window.devicePixelRatio || 1,
                time ,
                sId,
                sProg,
                sFlags
            ]);
          
            this.d.queue.writeBuffer(this.u, 0, uData);

            const enc = this.d.createCommandEncoder();

            for (const p of this.g.passes) {
                const bg = this.createBindGroup(p, writeIdx);

                if (p.type === 'compute') {
                    const passEnc = enc.beginComputePass();
                    passEnc.setPipeline(this.p.get(p.name) as GPUComputePipeline);
                    passEnc.setBindGroup(0, bg);
                    passEnc.dispatchWorkgroups(Math.ceil(this.h.width / 16), Math.ceil(this.h.height / 16));
                    passEnc.end();
                } else {
                    const view = p.isMain
                        ? this.c.getCurrentTexture().createView()
                        : this.t.get(p.name)![writeIdx].createView();

                    const passEnc = enc.beginRenderPass({
                        colorAttachments: [{
                            view,
                            loadOp: 'clear',
                            storeOp: 'store',
                            clearValue: [0, 0, 0, 1]
                        }]
                    });
                    passEnc.setPipeline(this.p.get(p.name) as GPURenderPipeline);
                    passEnc.setBindGroup(0, bg);
                    passEnc.draw(3);
                    passEnc.end();
                }
            }

            this.d.queue.submit([enc.finish()]);
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }
}