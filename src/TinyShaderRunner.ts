import { IAudioPlugin } from "./plugins/IAudioPlugin";
import { ITinyShadeGraph } from "./TinyShadeBake";

/**
 * TinyShadeRunner
 *
 * Orchestrates execution of a TinyShade shader graph using WebGPU.
 * Responsible for:
 * - WebGPU device & canvas setup
 * - Pipeline and bind group layout creation
 * - Ping-pong texture management
 * - Uniform updates (resolution, aspect, time)
 * - Optional audio-driven time source
 * - Driving the render / compute loop
 */
export class TinyShadeRunner {
    /** WebGPU logical device */
    private d!: GPUDevice;

    /** WebGPU canvas context */
    private c!: GPUCanvasContext;

    /** Global uniform buffer shared across all passes */
    private u!: GPUBuffer;

    /** Pipelines indexed by pass name */
    private p = new Map<string, GPURenderPipeline | GPUComputePipeline>();

    /** Bind group layouts indexed by pass name */
    private l = new Map<string, GPUBindGroupLayout>();

    /**
     * Ping-pong textures per pass.
     * - Compute passes typically use a single texture
     * - Render passes use two textures for feedback
     */
    private t = new Map<string, GPUTexture[]>();

    /** Shared linear sampler for all texture sampling */
    private s!: GPUSampler;

    /** Optional audio plugin driving time and sound synthesis */
    private a: IAudioPlugin | undefined;

    /**
     * @param h Target HTML canvas for rendering
     * @param g Parsed TinyShade shader graph definition
     */
    constructor(private h: HTMLCanvasElement, private g: ITinyShadeGraph) { }

    /**
     * Initializes WebGPU, audio (if present), pipelines, textures,
     * bind group layouts, and shared GPU resources.
     *
     * Must be awaited before calling {@link run}.
     */
    async init() {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("WebGPU adapter not available");

        this.d = await adapter.requestDevice();
        this.c = this.h.getContext("webgpu")!;

        // Handle high-DPI displays
        const dpr = window.devicePixelRatio || 1;
        this.h.width = this.h.width * dpr;
        this.h.height = this.h.height * dpr;

        /**
         * Optional audio plugin initialization.
         * Audio code is dynamically evaluated and expected
         * to expose a GPUSynth-compatible class.
         */
        if (this.g.audio) {
            const { code, data, activator } = this.g.audio;

            const AudioClass = new Function(
                `${code}; return GPUSynth;`
            )();

            this.a = new AudioClass(
                this.d,
                data,
                ...(activator ?? [])
            ) as IAudioPlugin;
        }

        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.c.configure({
            device: this.d,
            format: presentationFormat,
            usage: 16 // GPUTextureUsage.RENDER_ATTACHMENT
        });

        // Shared sampler for all shader passes
        this.s = this.d.createSampler({
            magFilter: 'linear',
            minFilter: 'linear'
        });

        // Global uniform buffer (resolution, aspect, time)
        this.u = this.d.createBuffer({
            size: this.g.uniforms.byteSize,
            usage: 72 // UNIFORM | COPY_DST
        });

        /**
         * Build textures, bind group layouts, and pipelines for each pass.
         */
        for (const p of this.g.passes) {
            const size = [this.g.canvasSize.width, this.g.canvasSize.height];

            // Allocate intermediate textures for non-main passes
            if (p.type === 'compute' && !p.isMain) {
                this.t.set(p.name, [
                    this.d.createTexture({
                        size,
                        format: 'rgba8unorm',
                        usage: 12 // STORAGE_BINDING | TEXTURE_BINDING
                    })
                ]);
            } else if (!p.isMain) {
                const create = () =>
                    this.d.createTexture({
                        size,
                        format: "bgra8unorm",
                        usage: 20 // RENDER_ATTACHMENT | TEXTURE_BINDING
                    });

                this.t.set(p.name, [create(), create()]);
            }

            /**
             * Parse WGSL bindings to auto-generate bind group layouts.
             * This avoids manual reflection metadata.
             */
            const layoutEntries: GPUBindGroupLayoutEntry[] = [];
            const bindingRegex =
                /@binding\s*\(\s*(\d+)\s*\)\s+var\s*(?:<([^>]+)>)?\s*([\w\d_]+)/g;

            let match;
            const visibility = p.type === 'compute' ? 4 : 2; // COMPUTE | FRAGMENT

            while ((match = bindingRegex.exec(p.shader)) !== null) {
                const binding = parseInt(match[1]);
                const typeInfo = match[2] || "";
                const varName = match[3];

                if (typeInfo.includes("uniform")) {
                    layoutEntries.push({
                        binding,
                        visibility,
                        buffer: { type: 'uniform' }
                    });
                } else if (typeInfo.includes("storage") || varName === "outTex") {
                    layoutEntries.push({
                        binding,
                        visibility,
                        storageTexture: {
                            format: 'rgba8unorm',
                            access: 'write-only'
                        }
                    });
                } else if (varName === "samp") {
                    layoutEntries.push({
                        binding,
                        visibility,
                        sampler: { type: 'filtering' }
                    });
                } else {
                    layoutEntries.push({
                        binding,
                        visibility,
                        texture: { sampleType: 'float' }
                    });
                }
            }

            const layout = this.d.createBindGroupLayout({ entries: layoutEntries });
            this.l.set(p.name, layout);

            const mod = this.d.createShaderModule({ code: p.shader });
            const pipelineLayout =
                this.d.createPipelineLayout({ bindGroupLayouts: [layout] });

            // Create compute or render pipeline
            if (p.type === 'compute') {
                this.p.set(
                    p.name,
                    this.d.createComputePipeline({
                        layout: pipelineLayout,
                        compute: { module: mod, entryPoint: 'main' }
                    })
                );
            } else {
                this.p.set(
                    p.name,
                    this.d.createRenderPipeline({
                        layout: pipelineLayout,
                        vertex: { module: mod, entryPoint: 'vs' },
                        fragment: {
                            module: mod,
                            entryPoint: 'main',
                            targets: [{
                                format: p.isMain
                                    ? presentationFormat
                                    : "bgra8unorm"
                            }]
                        }
                    })
                );
            }
        }
    }

    /**
     * Creates a bind group for a specific pass and frame index.
     *
     * Handles:
     * - Ping-pong texture selection
     * - Cross-pass texture dependencies
     * - Uniform and sampler bindings
     *
     * @param pass Shader graph pass definition
     * @param writeIdx Current frame ping-pong index
     */
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
                if (p.name === pass.name)
                    resources.set("outTex", texs[0].createView());

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

        // Match bindings based on WGSL source
        const entries: GPUBindGroupEntry[] = [];
        const bindingRegex =
            /@binding\s*\(\s*(\d+)\s*\)\s+var\s*(?:<([^>]+)>)?\s*([\w\d_]+)/g;

        let match;
        while ((match = bindingRegex.exec(pass.shader)) !== null) {
            const binding = parseInt(match[1]);
            const res = resources.get(match[3]);
            if (res) entries.push({ binding, resource: res });
        }

        return this.d.createBindGroup({ layout, entries });
    }

    /**
     * Starts the render loop.
     *
     * Uses:
     * - Audio-driven time if available and playing
     * - requestAnimationFrame otherwise
     *
     * This method does not return.
     */
    run() {
        const audioPlugin = this.a;
        let frame = 0;

        if (audioPlugin) audioPlugin.play();

        const render = (now: number) => {
            frame++;
            const writeIdx = frame % 2;

            const useAudioTime =
                audioPlugin && audioPlugin.isPlaying;

            const time = useAudioTime
                ? audioPlugin!.getTime()
                : now / 1000;

            // [width, height, aspect, time]
            const uData = new Float32Array([
                this.h.width,
                this.h.height,
                this.h.width / this.h.height,
                time
            ]);

            this.d.queue.writeBuffer(this.u, 0, uData);

            const enc = this.d.createCommandEncoder();

            for (const p of this.g.passes) {
                const bg = this.createBindGroup(p, writeIdx);

                if (p.type === 'compute') {
                    const passEnc = enc.beginComputePass();
                    passEnc.setPipeline(
                        this.p.get(p.name) as GPUComputePipeline
                    );
                    passEnc.setBindGroup(0, bg);
                    passEnc.dispatchWorkgroups(
                        Math.ceil(this.h.width / 16),
                        Math.ceil(this.h.height / 16)
                    );
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

                    passEnc.setPipeline(
                        this.p.get(p.name) as GPURenderPipeline
                    );
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
