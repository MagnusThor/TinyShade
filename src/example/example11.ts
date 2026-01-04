import { minifyJS } from "../helpers/minifyJS";
import { GPUSynth } from "../plugins/GPUSynth";
import { TinyShade } from "../TinyShade";
import { TinyShadeBake } from "../TinyShadeBake";
import { TinyShadeRunner } from "../TinyShaderRunner";
import { EPIC_LONG_WGSL_MIN } from "./music/PCrushSongs/EPIC_LONG_WGSL";

import shader from './wgsl/example11-compute0.min.wgsl';


document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade.create("canvas");


    const audio = new GPUSynth(app.device,EPIC_LONG_WGSL_MIN);

    document.querySelector("canvas")!.addEventListener("click", async () => {
        
          const minifiedRunnerCode = await minifyJS(TinyShadeRunner.toString());
                        
                console.info(`Runner size ${minifiedRunnerCode.code!.length} bytes (${(minifiedRunnerCode.code!.length / 1024).toFixed(2)} KB)`)
        
                await TinyShadeBake.downloadSelfContained(app, "demo.html", minifiedRunnerCode.code!,
                    {
                        code: (await minifyJS(GPUSynth.toString())).code!,
                        data: EPIC_LONG_WGSL_MIN,
                        activator: []
                    }
                );
        

    });

    (await 
        app.addAudio(audio).
        setUniforms()
        /**
         * COMPUTE PASS: Fractal Orbit Trap
         */
        .addCompute("C",shader)
        /**
         * MAIN: Final Post-Process
         */
        .main(`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv;
            let f= textureSample(C, samp, uv).rgb;            
            let v = smoothstep(1.5, 0.3, length(uv - 0.5));
            let color = pow(f * v, vec3f(1.1));
            return vec4f(color, 1.0);
        }
    `));
    //.run();

      const startButton = document.querySelector("button");
    startButton!.addEventListener('click', () => {
        startButton!.classList.add('d-none');
        app.run();
    }, { once: true });


});