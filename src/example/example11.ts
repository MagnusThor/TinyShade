import { TinyShade } from "../TinyShade";


import commonWGSL from './wgsl/common.wgsl';

import skyFragWGSL from './wgsl/skyFrag.wgsl';
import worldFragWGSL from './wgsl/worldFrag.wgsl';
import finalFragWGSL from './wgsl/finalFrag.wgsl';
import mainFragWGSL from './wgsl/mainFrag.wgsl';


import particlesWGSL from './wgsl/particlesCompute.wgsl';
import particleTrailsFragWGSL from './wgsl/particleTrailsFrag.wgsl';
import flashCompute from './wgsl/flashCompute.wgsl';

import meteor_physicsWGSL from './wgsl/meteor_physics.wgsl'


import { RollingAverage, WebGPUTiming } from "../plugins/WebGPUTiming";

const start = async () => {
    const app = await TinyShade.create("canvas");

    const PARTICLE_COUNT = 4_000;
    const PARTICLE_STORAGE_SIZE = PARTICLE_COUNT * 4;

    const MAP_RES = 1024;
    const MAP_SIZE = MAP_RES * MAP_RES
    const METEOR_COUNT = 2;



    const stats = document.createElement("div");
    stats.style.cssText = "position:absolute;top:10px;left:10px;color:#0f0;font-family:monospace;background:rgba(0,0,0,0.8);padding:10px;border-radius:5px;pointer-events:none;z-index:100;line-height:1.4;font-size:12px;border:1px solid #333;";
    document.body.appendChild(stats);
    const avg = new RollingAverage(60);
    const timing = new WebGPUTiming(app.device, (results) => {
        let displayStr = "";
        let totalFrameTime = 0;
        results.forEach(res => {
            displayStr += `${res.name.padEnd(12)} : ${res.ms.toFixed(3)} ms\n`;
            totalFrameTime += res.ms;
        });
        avg.add(totalFrameTime);
        displayStr += `---------------------------\n`;
        displayStr += `${"Total GPU".padEnd(12)} : ${avg.get().toFixed(3)} ms`;
        stats.innerText = displayStr;
    });


    (await app
        .setUniforms((l) => l.addUniform({ name: "count", value: PARTICLE_COUNT })
            .addUniform({ name: "meteorites", value: 2 })
        )
        .addCommon(commonWGSL) // shared code 

        .addCompute("particles", particlesWGSL, PARTICLE_STORAGE_SIZE) // we dont need to consider this pass
        .addPass("particleTrails", particleTrailsFragWGSL)  // we dont need to consider this pass


        .addCompute("meteor_physics", meteor_physicsWGSL,
            METEOR_COUNT * 4)
        .addAtomicCompute("paint_buffer", /*wgsl*/`
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let idx = id.x;
                if (idx >= ${MAP_SIZE}u) { return; }

                let val = atomicLoad(&data[idx]);
                if (val > 0u) {
                    // Decay by 2 units per frame. 
                    // Since we added 800u, it takes ~400 frames (6 seconds) to fade.
                    atomicSub(&data[idx], 8u); 
                }
            }
        `, MAP_SIZE, false)



        .addPass("sky", skyFragWGSL) // render bg , planet and stars etc, so i guess we can skip consider this


        .addPass("world", worldFragWGSL, ["sky","meteor_physics", "paint_buffer"])

        .addCompute("flash", flashCompute, 4, []) // just a "flash" , we can skip consider this

        .addPass("fin", finalFragWGSL) // compose prior passes 

        .main(mainFragWGSL) // output "texture", with some postprocessing


    ).run(timing);
};

start();

