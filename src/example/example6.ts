import { TinyShade } from "../TinyShade";

/**
 * Utility: Creates an 800x450 transparent canvas with centered text
 */
const createTextCanvas = (text: string): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 450;
    const ctx = canvas.getContext("2d")!;

    ctx.clearRect(0, 0, 800, 450);
    ctx.font = "bold 80px Inter, system-ui, sans-serif";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    
    // Add a subtle glow for the "Obsidian" aesthetic
    ctx.shadowColor = "rgba(0, 160, 255, 0.5)";
    ctx.shadowBlur = 20;
    ctx.fillText(text, 400, 225);

    return canvas;
};

const runExample = async () => {
    const app = await TinyShade.create("canvas");
    const uiCanvas = createTextCanvas("TINYSHADE");

    await app.addTexture("photo", "assets/texture.jpg");
    await app.addTexture("ui", uiCanvas) ;

    (await app
        
        .setUniforms(l => {
            l.addUniform({ name: "plasmaSpeed",value: 1.5});
        })

        .addPass("pass0",/*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let uv = (in.uv * 2.0 - 1.0) * vec2f(u.resolution.z, 1.0);
                
                // --- 1. Procedural Plasma Logic ---
                var v = 0.0;
                v += sin(uv.x * 10.0 + u.time * u.plasmaSpeed);
                v += sin((uv.y * 10.0 + u.time) * 0.5);
                v += sin((uv.x * 10.0 + uv.y * 10.0 + u.time) * 0.5);
                
                let cx = uv.x + 0.5 * sin(u.time / 5.0);
                let cy = uv.y + 0.5 * cos(u.time / 3.0);
                v += sin(sqrt(100.0 * (cx*cx + cy*cy) + 1.0) + u.time);
                
                let col = vec3f(
                    0.5 + 0.5 * sin(v), 
                    0.5 + 0.5 * sin(v + 2.0), 
                    0.5 + 0.5 * sin(v + 4.0)
                ) * 0.3; // Dim the plasma for contrast

                // --- 2. Texture Compositing ---
                let photo = textureSample(photo, samp, in.uv).rgb;
                let textLayer = textureSample(ui, samp, in.uv); // RGBA
                
                // Screen-blend the photo over plasma, then Alpha-composite the text
                var fin = mix(col, photo, 0.5);
                fin = mix(fin, textLayer.rgb, textLayer.a);
                
                return vec4f(fin, 1.0);
            }
        `)
        .main(/*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                return vec4f(textureSample(pass0, samp, in.uv).rgb, 1.0);
            }
        `)
    ).run();
};

runExample();