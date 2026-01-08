import { TinyShade } from "../TinyShade";


import commonWGSL from './wgsl/common.wgsl';

import skyFragWGSL from './wgsl/skyFrag.wgsl';
import worldFragWGSL from './wgsl/worldFrag.wgsl';
import finalFragWGSL from './wgsl/finalFrag.wgsl';
import mainFragWGSL from './wgsl/mainFrag.wgsl';


import meteorsComputeWGSL from './wgsl/meteorsCompute.wgsl';
import meteorsFragWGSL from './wgsl/meteorsFrag.wgsl';
import crater_mapWGSL from './wgsl/cratersAtomic.wgsl';

import particlesWGSL from './wgsl/particlesCompute.wgsl';
import particleTrailsFragWGSL from './wgsl/particleTrailsFrag.wgsl';


import volcanoCompute from './wgsl/volcanoCompute.wgsl'; 
import volcanoAtomicWGSL from './wgsl/volcanoAtomic.wgsl'; 
import volcanoFragWGSL from './wgsl/volcanoFrag.wgsl';
import flashCompute from './wgsl/flashCompute.wgsl';



import { TinyShadeBake } from "../TinyShadeBake";
import RunnerSource from "../TinyShaderRunner.ts?raw";

import { minifyJS } from "../helpers/minifyJS";
import { RollingAverage, WebGPUTiming } from "../plugins/WebGPUTiming";

const start = async () => {
    const app = await TinyShade.create("canvas");

    const PARTICLE_COUNT = 4_000;
    const PARTICLE_STORAGE_SIZE = PARTICLE_COUNT * 4;

    const ASTEROID_COUNT = 32; 
    const PHYSICS_STORAGE_SIZE = ASTEROID_COUNT * 4; 
    const ATOMIC_BUFFER_SIZE = app.canvas.width * app.canvas.height

   

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
        .addUniform({name:"asteroids",value: 10})
        )
        .addCommon(commonWGSL)
        .addCompute("physics",meteorsComputeWGSL, PHYSICS_STORAGE_SIZE )
        .addAtomicCompute("crater_map", crater_mapWGSL, ATOMIC_BUFFER_SIZE ,false)
        
        .addCompute("particles", particlesWGSL, PARTICLE_STORAGE_SIZE)
        .addPass("particleTrails", particleTrailsFragWGSL)
        
        .addCompute("volcano",volcanoCompute, 1000 * 4)
        
        .addAtomicCompute("volcano_map",volcanoAtomicWGSL, (app.canvas.width * app.canvas.height)*4 ,true)

        .addPass("sky", skyFragWGSL)

        .addPass("volcanoFrag",volcanoFragWGSL) // accum visuals for volcano & heatmap
        
        .addPass("world", worldFragWGSL)

        .addPass("meteors", meteorsFragWGSL)
        .addCompute("flash",flashCompute,4,[])
        .addPass("fin", finalFragWGSL)
     
        .main(mainFragWGSL)


    ).run(timing);
};

start();

