import { IAudioPlugin } from "./plugins/IAudioPlugin";
import { TinyShade, IPass } from "./TinyShade";


export interface ITinyShadeGraph {
    canvasSize: { width: number, height: number },
    uniforms: { byteSize: number, struct: string },
    textures: { name: string, data: string }[],
    passes: {
        name: string,
        type: 'compute' | 'fragment',
        shader: string,
        storageBufferSize?: number,
        isAtomic?: boolean,
        isMain?: boolean
    }[],
    workgroupSize: string,
    common: string
    audio?: IBakeAudio
}

export interface IBakeAudio {

    code: string,
    activator: unknown[], // ? ctor(a,b)
    data: any

}

/**
 * TinyShadeBake handles the serialization and distribution of a TinyShade application.
 * It provides methods to export the live shader graph as a minified JSON file or 
 * as a self-contained, pixel-packed HTML application. */

export class TinyShadeBake {
    /**
     * Captures the current TinyShade state and triggers a download of a self-executing HTML file.
     * The application logic is packed into a PNG image and decoded at runtime via an <img> onload handler.
     * * @param app - The active TinyShade instance.
     * @param filename - The name of the output HTML file (e.g., "scene.html").
     * @param runnerSource - The stringified source of the TinyShadeRunner class. 
     * If null, it attempts to fetch the source from 'assets/runnerCode.js'.
     */
    static async downloadSelfContained(app: TinyShade, filename: string = "demo.html", runnerSource?: string,
        audio?: IBakeAudio


    ) {
        const baker = new TinyShadeBake();
        const graph = await baker.collectGraphData(app);

        if (audio) {
            graph.audio = audio;

        }

        if (!runnerSource) {
            runnerSource = await fetch("assets/runnerCode.js").then(r => r.text());
            console.log("Using default runner code")
        } else {
            runnerSource = runnerSource.trim();
            console.log("Using custom runner code");
        }

        let cleanRunner = runnerSource!;

        if (cleanRunner.startsWith("class")) {
            cleanRunner = "const TinyShadeRunner = " + cleanRunner;
        }
        cleanRunner = cleanRunner.replace(/^export\s+/, "");

        const g = JSON.parse(JSON.stringify(graph));
        g.passes.forEach((p: any) => p.shader = baker.minify(p.shader));
        const hasAudio = !!g.audio;

        const js = `(async()=>{
const g=${JSON.stringify(g)};
${cleanRunner};

const c=document.createElement('canvas');
c.width=${g.canvasSize.width};
c.height=${g.canvasSize.height};
c.style='width:100vw;height:100vh;display:block;';
document.body.appendChild(c);

const r=new TinyShadeRunner(c,g);
await r.init();

        ${hasAudio ? `
        const b=document.createElement('button');
        b.textContent='RUN';
        b.style='position:fixed;inset:0;margin:auto;font-size:4vmin;border:0';
        document.body.appendChild(b);
        b.onclick=()=>{b.remove();r.run()};
        ` : `r.run()`}
        })()`;

        const payload = new TextEncoder().encode(js);
        const pngBase64 = await baker.generatePNG(payload);

        const html = `<html><body style="margin:0;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;">
            <img src="${pngBase64}" style="display:none" onload="
                (function(i){
                    var c=document.createElement('canvas'),
                    w=c.width=i.width,h=c.height=i.height,
                    x=c.getContext('2d');
                    x.drawImage(i,0,0);
                    var d=x.getImageData(0,0,w,h).data,b='',j=0;
                    for(;j<d.length;j++)if(j%4!=3&&d[j])b+=String.fromCharCode(d[j]);
                    (0,eval)(b);
                })(this);
            "></body></html>`;

        baker.triggerDownload(new Blob([html], { type: "text/html" }), filename);


    }

    /**
     * Exports the current shader graph, including all passes, uniforms, and textures, 
     * as a minified JSON file. Useful for debugging or for use with a custom loader.
     * * @param app - The active TinyShade instance.
     * @param filename - The name of the JSON file (e.g., "graph.json").
     */
    static async downloadGraph(app: TinyShade, filename: string = "graph.json") {
        const baker = new TinyShadeBake();
        const graph = await baker.collectGraphData(app);

        // Minify shaders before export
        graph.passes.forEach((p: any) => p.shader = baker.minify(p.shader));
        if (graph.common) graph.common = baker.minify(graph.common);


        const json = JSON.stringify(graph);
        baker.triggerDownload(new Blob([json], { type: "application/json" }), filename);
    }

    private triggerDownload(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }

    static async getGraphData(app: TinyShade): Promise<ITinyShadeGraph> {
        return new TinyShadeBake().collectGraphData(app);
    }

    private async collectGraphData(app: TinyShade): Promise<ITinyShadeGraph> {
        const internalApp = app as any;
        const bakedTextures = [];
        const sources = internalApp.textureSources;

        if (sources) {
            for (const [name, source] of sources) {
                bakedTextures.push({ name, data: this.toBase64(source) });
            }
        }

        const allPasses = [...internalApp.passes];
        allPasses.push({
            name: "main", type: 'fragment', isMain: true,
            shader: internalApp.mainPassShader, textures: []
        });

        const bakedPasses = await Promise.all(allPasses.map(async (p) => ({
            name: p.name,
            type: p.type,
            shader: await this.assembleShader(app, p),
            storageBufferSize: p.storageBuffer?.size,
            isAtomic: p.isAtomic,
            isMain: p.isMain
        })));

        return {
            canvasSize: { width: app.canvas.width, height: app.canvas.height },
            uniforms: { byteSize: internalApp.uniforms.byteSize, struct: internalApp.uniforms.wgslStruct },
            textures: bakedTextures,
            passes: bakedPasses,
            workgroupSize: internalApp.workgroupSize.str,
            common: internalApp.commonWGSL
        };
    }

    /**
     * Encodes an arbitrary byte payload into a PNG image and returns it as a
     * Base64 data URL (`data:image/png;base64,...`).
     *
     * The PNG is constructed manually (no Canvas usage) to ensure:
     *  - deterministic output
     *  - predictable scanline layout
     *  - real DEFLATE compression of IDAT data
     *  - browser-only operation without external libraries (e.g. pako)
     *
     * Payload bytes are packed sequentially into RGB pixels (8-bit, truecolor).
     * If the payload length is not divisible by 3, zero padding is appended.
     *
     * The image dimensions are chosen as the smallest square capable of holding
     * the full payload. Unused pixels remain zeroed.
     *
     * PNG details:
     *  - Color type: 2 (RGB)
     *  - Bit depth: 8
     *  - Filter: 0 (None) per scanline
     *  - Compression: zlib/DEFLATE via CompressionStream
     *
     * This function is intended for demoscene-style asset baking where the PNG
     * acts as a compressed container, not a visual image.
     *
     * @param payload Arbitrary binary data to embed in the PNG.
     * @returns A Base64-encoded PNG data URL suitable for use in <img src>.
     */
    private async generatePNG(payload: Uint8Array): Promise<string> {

        while (payload.length % 3) {
            payload = this.concat(payload, new Uint8Array([0]));
        }

        const side = Math.ceil(Math.sqrt(payload.length / 3));
        const rgb = new Uint8Array(side * side * 3);
        rgb.set(payload);

        // PNG scanlines (filter 0)
        const scan = new Uint8Array(side * (side * 3 + 1));
        for (let y = 0; y < side; y++) {
            scan[y * (side * 3 + 1)] = 0;
            scan.set(
                rgb.subarray(y * side * 3, (y + 1) * side * 3),
                y * (side * 3 + 1) + 1
            );
        }

        const compressed = await this.deflate(scan);

        const png = this.concat(
            this.pngSig(),
            this.chunk("IHDR", this.IHDR(side)),
            this.chunk("IDAT", compressed),
            this.chunk("IEND", new Uint8Array())
        );

        return "data:image/png;base64," + this.toBase64PNG(png);

    }

    private toBase64PNG(data: Uint8Array): string {
        let s = "";
        for (let i = 0; i < data.length; i++) {
            s += String.fromCharCode(data[i]);
        }
        return btoa(s);
    }




    private async assembleShader(app: TinyShade, currentPass: IPass): Promise<string> {
        const internalApp = app as any;
        const body = currentPass.shader;
        let b = 0;
        let header = `${internalApp.uniforms.wgslStruct}\n@group(0) @binding(${b++}) var<uniform> u: Uniforms;\n`;

        internalApp.globalTextures.forEach((_: any, name: string) => {
            if (body.includes(name)) header += `@group(0) @binding(${b++}) var ${name}: texture_2d<f32>;\n`;
        });

        if (body.includes("samp")) header += `@group(0) @binding(${b++}) var samp: sampler;\n`;

        internalApp.passes.forEach((p: IPass) => {
            if (p.isMain) return;
            if (p.type === 'compute') {
                if (currentPass === p && body.includes("outTex"))
                    header += `@group(0) @binding(${b++}) var outTex: texture_storage_2d<rgba8unorm, write>;\n`;
                else if (body.includes(p.name))
                    header += `@group(0) @binding(${b++}) var ${p.name}: texture_2d<f32>;\n`;
            } else {
                if (body.includes(p.name)) header += `@group(0) @binding(${b++}) var ${p.name}: texture_2d<f32>;\n`;
                if (body.includes(`prev_${p.name}`)) header += `@group(0) @binding(${b++}) var prev_${p.name}: texture_2d<f32>;\n`;
            }
        });

        const vert = `struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return VSOut(vec4f(p[i], 0.0, 1.0), vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5));
}\n`;

        let final = (currentPass.type === 'fragment' ? vert : "") + header + internalApp.commonWGSL + body;
        return currentPass.type === 'compute' ? final.replace("##WORKGROUP_SIZE", `@compute ${internalApp.workgroupSize.str}`) : final;
    }

    private minify(code: string): string {
        return code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').replace(/\s+/g, ' ').trim();
    }

    private toBase64(src: any): string {
        const c = document.createElement('canvas');
        c.width = src.width; c.height = src.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(src, 0, 0);
        return c.toDataURL('image/png');
    }

    private pngSig() {
        return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    }

    private IHDR(s: number) {
        return this.concat(
            this.u32(s), this.u32(s),
            new Uint8Array([8, 2, 0, 0, 0])
        );
    }
    private async deflate(data: Uint8Array): Promise<Uint8Array> {
        const cs = new CompressionStream("deflate");
        const writer = cs.writable.getWriter();
        writer.write(data as any);
        writer.close();
        return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    }

    private u32(n: number): Uint8Array {
        return new Uint8Array([
            (n >>> 24) & 255,
            (n >>> 16) & 255,
            (n >>> 8) & 255,
            n & 255
        ]);
    }

    private concat(...arrs: Uint8Array[]): Uint8Array {
        const len = arrs.reduce((s, a) => s + a.length, 0);
        const out = new Uint8Array(len);
        let o = 0;
        for (const a of arrs) {
            out.set(a, o);
            o += a.length;
        }
        return out;
    }

    private crc32(buf: Uint8Array): number {
        let c = ~0;
        for (let i = 0; i < buf.length; i++) {
            c ^= buf[i];
            for (let k = 0; k < 8; k++) {
                c = (c & 1)
                    ? (0xEDB88320 ^ (c >>> 1))
                    : (c >>> 1);
            }
        }
        return ~c >>> 0;
    }

    private chunk(type: string, data: Uint8Array): Uint8Array {
        const t = new TextEncoder().encode(type);
        return this.concat(
            this.u32(data.length),
            t,
            data,
            this.u32(this.crc32(this.concat(t, data)))
        );
    }


}