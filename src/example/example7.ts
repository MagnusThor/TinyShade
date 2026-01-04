
import { GPUSynth } from "../plugins/GPUSynth";
;
import { TinyShade } from "../TinyShade";
import { TinyShadeBake } from "../TinyShadeBake";
import { minifyJS } from "../helpers/minifyJS";
import { TinyShadeRunner } from "../TinyShaderRunner";
import { DARKNESS_END_OF_TIME_WGSL } from "./music/PCrushSongs/DARKNESS_END_OF_TIME_WGSL";
import { ALCHEMIST_LAB_WGSL } from "./music/PCrushSongs/ALCHEMIST_LAB_WGSL";
import { THE_SHORES_WGSL } from "./music/PCrushSongs/THE_SHORES_WGSL";
import { DEEP_HORIZON_WGSL } from "./music/PCrushSongs/DEEP_HORIZON_WGSL";
import { SLICE_ME_NICE_WGSL } from "./music/PCrushSongs/SLICE_ME_NICE_WGSL";

const start = async () => {
    const app = await TinyShade.create("canvas");
    const audio = new GPUSynth(app.device,SLICE_ME_NICE_WGSL);

    app.canvas.addEventListener("click", async () => {


        const minifiedRunnerCode = await minifyJS(TinyShadeRunner.toString());
                
        console.info(`Runner size ${minifiedRunnerCode.code!.length} bytes (${(minifiedRunnerCode.code!.length / 1024).toFixed(2)} KB)`)

        await TinyShadeBake.downloadSelfContained(app, "demo.html", minifiedRunnerCode.code!,
            {
                code: GPUSynth.toString(),
                data: SLICE_ME_NICE_WGSL,
                activator: []
            }
        );
    }
    );

    (await app
        .addAudio(audio)
        .setUniforms()
        .addCommon(/*wgsl*/`
            const MAT_GROUND = 1.0;
            const MAT_TORUS = 2.0;
            const MAT_SPHERE = 3.0;

            fn rot(a: f32) -> mat2x2f {
                let s = sin(a); let c = cos(a);
                return mat2x2f(c, -s, s, c);
            }

            fn sdfScene(p: vec3f) -> vec2f {
                let ground = p.y + 1.5;
                
                // FIXED: No LHS swizzling. Reconstruct vector for rotation.
                let rotatedXZ = rot(u.time * 0.5) * p.xz;
                let tp = vec3f(rotatedXZ.x, p.y, rotatedXZ.y);
                
                let q = vec2f(length(tp.xz) - 4.5, tp.y);
                let torus = length(q) - 0.2;
                
                let sPos = vec3f(0.0, 0.5 + sin(u.time * 1.5) * 0.5, 0.0);
                let sphere = length(p - sPos) - (1.2 + sin(u.time * 4.0) * 0.05);
                
                var res = vec2f(ground, MAT_GROUND);
                if (torus < res.x) { res = vec2f(torus, MAT_TORUS); }
                if (sphere < res.x) { res = vec2f(sphere, MAT_SPHERE); }
                return res;
            }

            // High-quality Sky with a distinct "Sun Dot" as the main source
            fn getSky(rd: vec3f, lightDir: vec3f) -> vec3f {
                let sun = max(dot(rd, lightDir), 0.0);
                // Deep atmosphere gradient
                var col = mix(vec3f(0.005, 0.01, 0.03), vec3f(0.1, 0.25, 0.5), pow(1.0 - max(rd.y, 0.0), 3.0));
                // Sun Disk (Intense core)
                col += vec3f(1.0, 0.9, 0.7) * pow(sun, 1024.0) * 20.0; 
                // Sun Halo (Soft glow)
                col += vec3f(0.8, 0.4, 0.2) * pow(sun, 32.0) * 0.6; 
                return col;
            }

            // Soft shadows for depth
            fn getShadow(ro: vec3f, rd: vec3f) -> f32 {
                var res = 1.0;
                var t = 0.02;
                for(var i=0; i<32; i++) {
                    let h = sdfScene(ro + rd * t).x;
                    res = min(res, 12.0 * h / t); // 12.0 is the softness factor
                    t += clamp(h, 0.01, 0.2);
                    if(res < 0.001 || t > 15.0) { break; }
                }
                return clamp(res, 0.0, 1.0);
            }
        `)
        .addPass("pass0",/*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let uv = vec2f(in.uv.x * 2.0 - 1.0, (1.0 - in.uv.y) * 2.0 - 1.0);
                let p_uv = vec2f(uv.x * u.resolution.z, uv.y);

                // Camera Logic
                let camTime = u.time * 0.2;
                let ro = vec3f(cos(camTime) * 12.0, 4.0, sin(camTime) * 12.0);
                let tar = vec3f(0.0, 0.0, 0.0);
                let ww = normalize(tar - ro);
                let uu = normalize(cross(ww, vec3f(0.0, 1.0, 0.0)));
                let vv = normalize(cross(uu, ww));
                let rd = normalize(p_uv.x * uu + p_uv.y * vv + 1.8 * ww);
                
                // Main Sun Direction
                let lightDir = normalize(vec3f(0.7, 0.7, 0.3)); 
                
                var t = 0.0; var m = -1.0;
                for(var i=0; i<100; i++) {
                    let h = sdfScene(ro + rd * t);
                    if(h.x < 0.001 || t > 50.0) { break; }
                    t += h.x; m = h.y;
                }

                var col: vec3f;
                if(t > 50.0) {
                    col = getSky(rd, lightDir);
                } else {
                    let p = ro + rd * t;
                    let e = vec2f(0.001, 0.0);
                    let n = normalize(vec3f(
                        sdfScene(p + e.xyy).x - sdfScene(p - e.xyy).x,
                        sdfScene(p + e.yxy).x - sdfScene(p - e.yxy).x,
                        sdfScene(p + e.yyx).x - sdfScene(p - e.yyx).x
                    ));
                    
                    let shadow = getShadow(p, lightDir);
                    let diff = max(dot(n, lightDir), 0.0) * shadow;
                    let amb = 0.05 * (n.y * 0.5 + 0.5); // Ambient sky light
                    
                    var baseCol = vec3f(0.5);
                    if (m == MAT_GROUND) {
                         let grid = smoothstep(-0.1, 0.1, sin(p.x * 1.5) * sin(p.z * 1.5));
                         baseCol = mix(vec3f(0.01), vec3f(0.04), grid);
                    } else if (m == MAT_TORUS) { 
                        baseCol = vec3f(0.9, 0.05, 0.1); 
                    } else if (m == MAT_SPHERE) { 
                        baseCol = vec3f(0.05, 0.5, 1.0); 
                    }

                    // Specular Highlight
                    let reflectDir = reflect(rd, n);
                    let spec = pow(max(dot(reflectDir, lightDir), 0.0), 128.0) * shadow;
                    
                    // Fresnel rim lighting
                    let fre = pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 5.0);
                    
                    col = baseCol * (diff + amb) + spec + (fre * 0.5 * getSky(reflectDir, lightDir));
                }

                // Smooth exponential fog
                col = mix(col, getSky(rd, lightDir), 1.0 - exp(-0.0001 * t * t * t));
                return vec4f(col, 1.0);
            }
        `)
        .main(/*wgsl*/`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let scene = textureSample(pass0, samp, in.uv).rgb;
                
                // Filmic Bloom: Only glow the brightest highlights
                var bloom = vec3f(0.0);
                let samples = 8;
                for(var i=0; i<samples; i++) {
                    let angle = f32(i) * 6.28 / f32(samples);
                    let off = vec2f(cos(angle), sin(angle)) * 0.005;
                    bloom += max(textureSample(pass0, samp, in.uv + off).rgb - 0.7, vec3f(0.0));
                }
                bloom /= f32(samples);

                // Chromatic Aberration
                let offset = length(in.uv - 0.5) * 0.004;
                let r = textureSample(pass0, samp, in.uv + vec2f(offset, 0.0)).r;
                let g = scene.g;
                let b = textureSample(pass0, samp, in.uv - vec2f(offset, 0.0)).b;
                
                let fin = vec3f(r, g, b) + bloom * 2.0;
                
                // ACES-ish Tonemapping and Gamma
                let mapped = fin / (fin + 1.0);
                return vec4f(pow(mapped, vec3f(0.4545)), 1.0);
            }
        `)
    );

    const startButton = document.querySelector("button");
    startButton!.addEventListener('click', () => {
        startButton!.classList.add('d-none');
        app.run();
    }, { once: true });
};
start();