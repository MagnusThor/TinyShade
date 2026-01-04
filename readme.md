# 🌑 TinyShade

[![API Docs](https://img.shields.io/badge/API_Docs-TypeDoc-blue)](https://magnusthor.github.io/TinyShade/public/doc/)

A minimalist, zero-boilerplate WebGPU framework designed for rapid prototyping of compute-driven visuals, simulations, and multi-pass post-process effects.

TinyShade simplifies the complex WebGPU binding model into a chainable API. It handles **Ping-Ponging** (feedback textures), **Dynamic Compute Dispatching**, and **Intelligent Dependency Management** automatically.

>💭*Think of TinyShade as the **WebGPU evolution of Shadertoy**—built for those who need more than just a fragment shader, but less than a 600KB engine.*"


## ⚖️ A Tiny Footprint

TinyShade is engineered for the **64k and 4k intro philosophy**. It provides a full-scale WebGPU orchestration layer with a footprint smaller than a typical favicon.

| Component        | Size (Min/Gzip) | Strategy                                    |
| ---------------- | --------------- | ------------------------------------------- |
| TinyShade Core   | ~9 KB           | Tree-shaken dev-time graph manager          |
| TinyShade Runner | ~4.5 KB         | Ultra-lean binary replay engine             |
| Bake Output      | Compressed      | Frozen, minified, and packed final artifact |


## 📦 Installation & Setup

```bash

# Clone the repository
git clone https://github.com/MagnusThor/TinyShade.git

# Install dependencies
npm install

# Start the development server
npm run start

```

## 🚀 Quick Start: Dependency-Aware Graph

TinyShade uses an intelligent chaining API. This example demonstrates a **branched DAG**: running two independent simulations and combining them in a final fragment pass.

```ts

import { TinyShade } from "./TinyShade";

const start = async () => {
  // 1. Initialize the WebGPU context
  const app = await TinyShade.create("canvas");

  (await app
    .setUniforms()
    
    // 2. Implicit Dependency: Since 'deps' is omitted, 
    // this pass is added to the linear stack by default.
    .addCompute("physics", physicsWGSL)
    
    // 3. Explicit Empty Dependency: By passing [], we tell TinyShade 
    // this pass depends on NOTHING. This allows the GPU to 
    // potentially run "fluid" and "physics" in parallel.
    .addCompute("fluid", fluidWGSL, 0, [])
    
    // 4. Multi-Dependency Main: The final fragment pass 
    // explicitly requests the output textures from both prior passes.
    .main(mainWGSL, ["physics", "fluid"])
    
  ).run(); // Start the render loop
};

start();
```

### 💡 The "Omit" Rule (Convention over Configuration)

In TinyShade, you only write `deps` when you want to be specific.

-   **Omit the `deps` argument:** The pass is "greedy"—it automatically binds **every prior pass** in the chain. This is the fastest way to build a post-processing stack.
    
-   **Pass an empty array `[]`:** The pass is "isolated"—it binds nothing but the global uniforms. This is the best way to optimize performance for independent compute tasks.
    
-   **Pass a specific array `["a", "b"]`:** The pass is "surgical"—it binds only the named resources you requested.


## 🗺️ Smart-DAG Execution Model

TinyShade treats your pipeline as a **Directed Acyclic Graph (DAG)** using a *Convention over Configuration* API.

### 1. Implicit Dependency (Linear Default)

If no dependency array is provided, a pass automatically sees **all prior passes**.

### 2. Explicit Dependency (`deps`)

TinyShade simplifies the complex WebGPU binding model through a **"Convention over Configuration"** approach. You only define dependencies when you need to optimize.

### 1. Omit the `deps` argument (Linear Default)

The pass is "greedy." It automatically binds **every prior pass** in the chain. This is the fastest way to build a classic post-processing stack where each layer builds on the last.

### 2. Pass an empty array `[]` (Isolated)

The pass is "isolated." It binds nothing but the global uniforms. Use this for independent tasks (like a noise generator or an independent physics sim) to maximize GPU occupancy.

### 3. Pass a specific array `["a", "b"]` (Surgical)

TinyShade generates a custom BindGroup containing **only** the requested resources. This keeps your shader code clean and reduces the performance overhead of binding unused textures.


## 📜 Shader Variable Reference

| Type         | Name           | Source     | Description                   |
| ------------ | -------------- | ---------- | ----------------------------- |
| `vec3f`      | `u.resolution` | Internal   | Width, height, DPR            |
| `f32`        | `u.time`       | Internal   | Global clock (seconds)        |
| `f32`        | `u.sceneId`    | Sequencer  | Active timeline segment       |
| `f32`        | `u.progress`   | Sequencer  | 0–1 progress in current scene |
| `f32`        | `u.flags`      | Sequencer  | Bitmask for event triggers    |
| `texture_2d` | `<name>`       | addCompute | Output of named compute pass  |
| `texture_2d` | `prev_<name>`  | addPass    | Previous-frame feedback       |
| `sampler`    | `samp`         | Internal   | Global linear sampler         |

## 🧠 High-Level Pipeline Overview

TinyShade is built around a **named execution model** that balances simplicity with surgical control:

> **Data flows through a Directed Acyclic Graph (DAG) — where every pass can access the present and the past of its ancestors.**

### The Named Execution Flow

Every frame, TinyShade executes your pipeline **in the order it was defined**. By naming your passes, your shaders reference data via semantic names rather than opaque binding indices:

-   **Greedy Access (Default):** If you omit `deps`, a pass can **see the output of every stage before it** automatically.
    
-   **Surgical Access (`deps`):** If you specify `deps`, the pass only binds the specific resources requested, reducing GPU overhead and enabling internal parallel optimizations.
    
```rs
Uniforms 
   ↓ 
"sim_data" (Compute) 
   ↓ 
"post_fx" (Fragment) → sees ["sim_data"]
   ↓ 
main() → sees ["post_fx", "sim_data"] → Canvas

```

### Temporal Feedback (Ping-Ponging)

Temporal logic is a first-class citizen in TinyShade. Every fragment pass is automatically double-buffered. If you name a pass `"fx"`, TinyShade manages two textures behind the scenes:

-   **`fx`**: The current texture being written (available to _subsequent_ passes).
    
-   **`prev_fx`**: The texture as it looked in the previous frame (available to the _current_ pass).
    

This makes complex effects like **motion blur, temporal accumulation, and cellular automata** effortless to implement.


### 🧪 Best Practice: Atomic Heatmaps

When using `addAtomicCompute`, remember that the storage buffer persists. A common pattern is to have one pass "clear" the buffer (or use the `u.frame` index to offset) and a second pass "splat" data into it.

TypeScript

```ts
// Clear/Reset pass (optional depending on shader logic)
app.addCompute("clear", clearWGSL, 1, []);

// Splatting pass
app.addAtomicCompute("particles", splatWGSL, COUNT, ["clear"]);
```


## ⬛ Core API

TinyShade's API is designed to be declarative yet chainable. It eliminates the "Boilerplate Tax" of WebGPU by inferring BindGroups and Pipeline layouts from your graph structure.
[![API Docs](https://img.shields.io/badge/API_Docs-TypeDoc-blue)](https://magnusthor.github.io/TinyShade/public/doc/)


### 1. Initialize

Initialize the WebGPU context and attach it to a canvas. This setup is asynchronous and handles adapter/device discovery internally.

```ts
const app = await TinyShade.create("canvas-id");
```

### 2. Compute Pass

Registers a GPU compute task. TinyShade automatically handles the creation of the output storage texture and calculates the dispatch workgroups based on your canvas size.

```ts
app.addCompute("particles", particlesWGSL, 1024, ["background_sim"]);
);
```

### 3. Atomic Passes

A specialized compute pass that pre-configures a storage buffer with `atomic<u32>` support. Essential for "Many-to-One" operations like splatting particles onto a grid or building heatmaps.

```ts
app.addAtomicCompute("heatmap", heatmapWGSL, PIXEL_COUNT, ["physics"]);
```

### Fragment Pass (Ping-Pong Managed)


Registers a full-screen render pass. If a pass depends on itself (e.g., `["blur"]`), TinyShade automatically creates a **Ping-Pong** feedback loop, allowing you to sample `prev_blur` in your WGSL.

```ts
app.addPass("blur", blurWGSL, ["simulation"]);
```


## 🎬 Plugin System & Sequencer

TinyShade uses a **Plug-and-Tick** architecture. Animation logic, timelines, and audio sync live in optional plugins.

### TSSequencer

```ts
const seq = new TSSequencer(timeline, TOTAL_LENGTH_MS, 120, 4);
await app.addSequencer(seq).run();
```

### IBakePlugin Interface

```ts
export interface IBakePlugin {
  code: string;
  activator: any[];
  data: any;
}
```

###  🎭 Frame-Locked Orchestration

`TSSequencer` is built for synchronization. By integrating the sequencer, the framework drives your entire GPU pipeline through a unified uniform contract. Transition between scenes, modulate effects via `u.progress`, and trigger visual events using bitwise `u.flags`—all perfectly locked to the timeline.


```ts
 const app = await TinyShade.create("canvas");
    
    const L = 170000; 
    const seq = new TSSequencer([], L, 120, 4);

    const SS = [
        [seq.getUnitsFromMs(1800, L), 0x4000, 1],
        [seq.getUnitsFromBars(4, L),  0x4001, 2],
        [seq.getUnitsFromMs(5000, L), 0x0000, 3],
        [255, 0x0000, 0]
    ];
    seq.timeline = SS;

    (await app
        .addSequencer(seq)
        .setUniforms().
        //....
``` 

and within the `main` pass as an example you do

```rust
   @fragment fn main(in: VSOut) -> @location(0) vec4f {
    
                let noise = textureSample(noise_source, samp, in.uv).r;
                let color = textureSample(color_mask, samp, in.uv).rgb;

                var finalColor = vec3f(0.0);

                var sId:f32 = u.sceneId;

                if (sId == 1.0) {
                    finalColor = vec3f(noise);
                } else if (sId == 2.0) {
                    finalColor = color * noise;
                } else if (sId == 3.0) {
                    finalColor = mix(color * noise, 1.0 - (color * noise), u.progress);
                } else {
                    finalColor = vec3f(1.); // Idle state
                }

                return vec4f(finalColor, 1.0);
            }

```



## 🎹 Audio Integration (addAudio)

TinyShade supports sample-accurate timing. By implementing IAudioPlugin, an engine (like GPUSynth) can drive the u.time uniform.

```ts
app.addAudio(mySynth) // u.time is now driven by the audio clock
   .run();
```

### 🖥️🎶 GPU Music from PCrush
My dear friend PCrush (Peter C) and co-developer of GPUSynth created several example tracks for GPUSynth. These can be found in the following folder:

[src/example/music/PCrushSongs/](src/example/music/PCrushSongs/)

>Note: PCrush forked my old repository https://github.com/MagnusThor/demolishedAudio and significantly improved it, modernizing the codebase and adapting it toward a more WebGPU / WGSL–style architecture.


## Various Examples on TinyShade


You can try the live examples here:  
[TinyShade Examples](https://magnusthor.github.io/TinyShade/public/)

>⚠️ **Note:** TinyShade is under active development. APIs, visuals, and performance characteristics may change.

The source code for each example can be found in:

[/src/example/](src/example/)

```python  
Each example is self-contained and intended to demonstrate a specific feature or rendering technique.
```
---

## 🧁 TinyShadeBake & 4.5 KB Runner

Bake freezes your live dependency graph into a **portable, replay-only artifact**.

> "While standard WebGPU wrappers start at 100 KB+, TinyShade delivers a complete Compute/Fragment pipeline at ~4% of the size."

### Baking Pipeline

* **Entropic Optimization:** uniform + WGSL deduplication
* **Shader Mangling:** aggressive minification
* **Steganographic Packing:** app encoded into PNG RGB channels
* **Self-Contained Bootloader:** single `.html` output

### Size Comparison

| Stage            | Raw Dev State | Baked & Packed |
| ---------------- | ------------- | -------------- |
| Framework/Runner | ~15 KB        | 4.5 KB         |
| Shader Library   | 128 KB        | ~15 KB         |
| **Total**        | **143 KB**    | **< 20 KB**    |

### Baking an app (Code Example)

Once your TinyShade scene/app  is complete, baking it into a distributable artifact is a **single call**.

#### Default Runner 

```ts
import { TinyShadeBake } from "./TinyShadeBake";
import RunnerSource from "../TinyShaderRunner.ts?raw";

const minifiedRunnerCode = await minifyJS(RunnerSource);

await TinyShadeBake.downloadSelfContained(app, "demo.html", minifiedRunnerCode.code!);

```

This produces:

-   One `.html` file    
-   No external assets    
-   No runtime dependencies    
-   Ready-to-share output
-   Works offline
    

> The runner source is embedded directly into the baked payload and instantiated at runtime.  
> This allows **full control over execution** while keeping the original scene untouched.



## 🛠 Scripts Overview

| Command                  | Action        | Description                                       |
| ------------------------ | ------------- | ------------------------------------------------- |
| `npm run build`          | `tsc`         | Compile TypeScript sources using `tsconfig.json`. |
| `npm run prepublishOnly` | build hook    | Ensures compiled output before publishing.        |
| `npm run start`          | dev server    | Launches webpack dev server with live reload.     |
| `npm run start-prod`     | prod server   | Dev server simulating production build.           |
| `npm run build-examples` | bundle        | Builds example projects to static output.         |
| `npm run wgsl:minify`    | custom script | Minifies WGSL shaders for size and packing.       |

---

### ⚡ The WGSL Shrinker (Utility Overview)
The `wgsl:minify script` is a specialized build-step utility designed for WebGPU workflows.

Recursive Processing: It scans the `src/` directory for any .wgsl files, including those nested deep in subfolders.

Clean & Compress: It strips out single-line (//) and multi-line (/* */) comments and collapses redundant whitespace into a single space. 

Artifact Creation: For every source.wgsl, it generates a source.min.wgsl.

>Purpose: This reduces the final "Bake" payload size (essential for the PNG-encoded self-contained demos) and provides a basic layer of code obfuscation for shared shaders.


## ⚡ Technical Architecture

-   **Atomic Pass Orchestration**: TinyShade treats the GPU as a sequential state machine. It handles the heavy lifting of `CommandEncoder` management and `Compute-to-Render` synchronization, ensuring zero-latency data handover between simulation and visualization stages.
    
-   **Recursive Temporal Buffer Management**: Implements a sophisticated "Ping-Pong" texture strategy. By maintaining dual-buffer states for every fragment pass, the engine enables $O(1)$ access to historical frame data (`prev_name`), turning linear shaders into recursive feedback systems.
    
-   **Adaptive Dispatch Heuristics**: Rather than using naive thread counts, the engine queries hardware limits to calculate the **Optimal Workgroup Topology**. It aligns dispatch grids with the GPU's internal SIMD width, maximizing occupancy and throughput across varying architectures.
    
-   **Sample-Locked Synchronization**: By hijacking the uniform update loop with `IAudioPlugin`, the engine achieves sample-accurate phase alignment between visuals and audio. This eliminates the "clock drift" common in `requestAnimationFrame` and ensures every pixel update is chronologically locked to the audio sample clock.
    
-   **Procedural Geometry Injection**: Utilizes a "Vertex-less" rendering technique. By generating Clip Space coordinates directly from `@builtin(vertex_index)`, it bypasses the entire Input Assembler stage, reducing memory bandwidth overhead and eliminating the need for CPU-side vertex buffers.

---


## 📚 Resources & Learning

* **[Full API Reference](https://magnusthor.github.io/TinyShade/public/doc)** – Auto-generated documentation for all classes, types, and methods.
* **[Live Examples](https://magnusthor.github.io/TinyShade/public/)** – Interactive shaders and experiments.



## 🗺️ Roadmap: The Future of TinyShade

The goal for TinyShade is to remain the leanest orchestrator in the WebGPU ecosystem while expanding the creative possibilities for GPGPU and demoscene productions.

### 🏁 Phase 1: Performance & Core (Current Focus)

-   [ ] **Dynamic Buffer Resizing**: Allow storage buffers to scale without re-initializing the entire pipeline.
    
-   [ ] **Smart BindGroup Caching**: Further optimize the Smart-DAG to reuse layouts across similar compute passes.
    
-   [ ] **Multi-Queue Execution**: Support for concurrent compute and render queues to maximize GPU occupancy.
    

### 🛠️ Phase 2: IDE & Tooling

-   [ ] **VS Code Extension**: A "Live Preview" extension using Webview Panels to run the 4.5KB Runner directly inside your editor with hot-reloading.
    
-   [ ] **TinyShade Live (CodeMirror)**: An official web-based editor module that hooks into the app instance for real-time WGSL prototyping.
    
-   [ ] **Auto-Header Injection**: Improve the WGSL pre-processor to automatically inject `@group` and `@binding` based on the `.main(["deps"])` array.
    

### 🎨 Phase 3: Creative Quality of Life

-   [ ] **Debug Visualizer**: A toggleable overlay to inspect the output of any intermediate compute pass (the "Heatmap View").
    
-   [ ] **Noise Library**: A built-in, tree-shakable collection of optimized WGSL noise functions (Simplex, Worley, FBM).
    
-   [ ] **Audio-Reactive Templates**: Ready-to-use boilerplate for linking `u.progress` and `u.flags` to `GPUSynth` transients.
    

### 🧁 Phase 4: The "Intro" Ecosystem

-   [ ] **Advanced Mangler**: Integration with a specialized WGSL minifier that renames variables based on frequency for better Gzip/PNG compression.
    
-   [ ] **Headless Baking**: A CLI tool to "Bake" your `demo.html` directly from the terminal without opening a browser.

---



## 🥂 Credits

* **Mårten Rånge** — Path tracing example & inspiration (SYTYCC 2025)
* **PCrush** — GPUSynth & audio architecture

---
**Magnus Thor**
