
# 🌑 TinyShade

A minimalist, zero-boilerplate **WebGPU** framework designed for rapid prototyping of compute-driven visuals, simulations, and multi-pass post-process effects.

TinyShade simplifies the complex WebGPU binding model into a chainable API. It handles **Ping-Ponging** (feedback textures), **Dynamic Compute Dispatching**, and **Uniform Management** automatically.


## 🚀 Quick Start: The Stack

This example demonstrates the power of the full chain: loading external textures, sharing common math, running a compute simulation named "fluid", and rendering a final lit scene.


```ts
import { TinyShade } from "./TinyShade";

const start = async () => {
    const app = await TinyShade.create("canvas");

    (await app
        // 1. Load assets once; accessible by name in all shader stages
        .addTexture("matcap", "./textures/gold_matcap.jpg")
        
        // 2. Inject shared math automatically
        .addCommon(`
            fn sdfSphere(p: vec3f, s: f32) -> f32 { return length(p) - s; }
        `)
        
        // 3. Compute Pass: Output is accessible in later stages as 'fluid'
        .addCompute("fluid", `
            fn main(@builtin(global_invocation_id) id: vec3u) {
                textureStore(outTex, id.xy, vec4f(u.time % 1.0)); 
            }
        `)
        
        // 4. Main Pass: Final rendering using 'matcap' and 'fluid' textures
        .main(`
            @fragment fn main(in: VSOut) -> @location(0) vec4f {
                let simData = textureSample(fluid, samp, in.uv).r;
                let lit = textureSample(matcap, samp, in.uv).rgb * simData;
                return vec4f(lit, 1.0);
            }
        `)
    ).run();
};

start();

```


## 📜 Shader Variables Reference

| Variable Type | Source | Description |
|--------------|--------|-------------|
| `<name>` | any | setUniformsAccess any custom uniform defined in JS. |
| `<name>` | texture_2d | addCompute The output texture of a named compute pass. |
| `<name>_data` | array<u32> | addAtomicCompute The raw atomic buffer of a named atomic pass. |
| `prev_<name>` | texture_2d | addPass The previous frame (feedback) of a named fragment pass. |
| `outTex` | texture_storage | Internal The write-only target inside the active compute pass. |
| `data` | atomic<u32> | addAtomicCompute Read/Write atomic buffer (active only within its own pass). |
| `samp` | sampler | Internal A linear, filtering sampler ready to use globally. |
| `data` | array<f32> | addCompute Storage buffer (active only if size > 0). |



## 🧠 High-Level Pipeline Overview

TinyShade is built around a **simple, linear execution model**:

> **Data flows forward through a named chain of GPU passes — and each pass remembers its own past.**

### The Named Execution Flow

Every frame, TinyShade executes your pipeline **exactly in the order you write it**. Because you name your passes, your shaders read like logic rather than indices:

```lua
Uniforms ↓ "blur" (Compute) ↓ "bloom" (Fragment) ↓ main() → Canvas 

```

-   Each stage can **see the output of every stage before it** using the assigned name.
    
-   Fragment passes also see **their own previous frame** by prefixing the name with `prev_`.
    

### Temporal Feedback Is Built-In

Every fragment pass automatically creates a "ping-pong" pair. If you name a pass `"feedback"`, TinyShade provides:

-   `feedback` → The texture you are writing to this frame.
    
-   `prev_feedback` → The texture as it looked in the previous frame.
    

This makes effects like trails, accumulation, and cellular automata **natural and effortless**.


## ⬛ Core API: Step-by-Step

API Doumentation can be found here - [TinyShade documentation](https://magnusthor.github.io/TinyShade/public/doc/)

### 1. Initialize

Sets up the GPU context, detects hardware workgroup limits, and configures the canvas.

TypeScript

```
const app = await TinyShade.create("canvas-id");
```

### 2. Compute Engine (`addCompute`)

-   **1D Simulation (`size > 0`):** Perfect for particles. Provides the `data` buffer.
    
-   **2D Generative (`size = 0`):** Dispatches across the screen resolution.
    


```rust
app.addCompute("particles", `
    ##WORKGROUP_SIZE
    fn main(@builtin(global_invocation_id) id: vec3u) {
        data[id.x] += 0.01; 
        textureStore(outTex, id.xy, vec4f(1.0));
    }
`);

```

### 3. Atomic Scattering (`addAtomicCompute`)

This specialized pass is designed for **Many-to-One** operations where multiple threads need to write to the same memory address safely (e.g., projection, heatmaps, splatting).

```rust
app.addAtomicCompute("heatmap", `
    ##WORKGROUP_SIZE
    fn main(@builtin(global_invocation_id) id: vec3u) {
        let i = id.x;
        let pos = physics_data[i]; // Reading from a previous pass
        let coords = project_to_screen(pos);
        
        // Safely increment a pixel's energy value
        atomicAdd(&data[coords.y * width + coords.x], 1u);
    }
`, PIXEL_COUNT);

```

> **When to use `addAtomicCompute`?**
> -   **YES:** For "Splatting" (projecting 3D particles onto a 2D grid), creating density heatmaps, or histogram generation.
> -   **NO:** For standard image processing or SDF rendering. Atomics introduce serialization overhead; only use them when thread collisions are a mathematical requirement.    


_Note: `##WORKGROUP_SIZE` is replaced with hardware-optimized settings like `@workgroup_size(16, 16, 1)`._

### 4. Multi-Pass Fragment (`addPass`)

Add sequential post-processing. Each `addPass` defines a texture name for subsequent shaders.


```rust
app.addPass("blur", `
    @fragment fn main(in: VSOut) -> @location(0) vec4f {
        let current = textureSample(baseLayer, samp, in.uv);
        let history = textureSample(prev_blur, samp, in.uv); // Automatic feedback!
        return mix(current, history, 0.9);
    }
`);

```


## 🎹 Audio Integration (`addAudio`)

TinyShade supports sample-accurate timing. By implementing `IAudioPlugin`, an engine (like `GPUSynth`) can drive the `u.time` uniform.


```ts
app.addAudio(mySynth) // u.time is now driven by the audio clock
   .run();

```

## Examples

You can try the live examples here:  
[TinyShade Examples](https://magnusthor.github.io/TinyShade/public/)

>⚠️ **Note:** TinyShade is under active development. APIs, visuals, and performance characteristics may change.

The source code for each example can be found in:

[/src/example/](src/example/)

```python  
Each example is self-contained and intended to demonstrate a specific feature or rendering technique.

```


## ⚡ Technical Architecture

-   **Atomic Pass Orchestration**: TinyShade treats the GPU as a sequential state machine. It handles the heavy lifting of `CommandEncoder` management and `Compute-to-Render` synchronization, ensuring zero-latency data handover between simulation and visualization stages.
    
-   **Recursive Temporal Buffer Management**: Implements a sophisticated "Ping-Pong" texture strategy. By maintaining dual-buffer states for every fragment pass, the engine enables $O(1)$ access to historical frame data (`prev_name`), turning linear shaders into recursive feedback systems.
    
-   **Adaptive Dispatch Heuristics**: Rather than using naive thread counts, the engine queries hardware limits to calculate the **Optimal Workgroup Topology**. It aligns dispatch grids with the GPU's internal SIMD width, maximizing occupancy and throughput across varying architectures.
    
-   **Sample-Locked Synchronization**: By hijacking the uniform update loop with `IAudioPlugin`, the engine achieves sample-accurate phase alignment between visuals and audio. This eliminates the "clock drift" common in `requestAnimationFrame` and ensures every pixel update is chronologically locked to the audio sample clock.
    
-   **Procedural Geometry Injection**: Utilizes a "Vertex-less" rendering technique. By generating Clip Space coordinates directly from `@builtin(vertex_index)`, it bypasses the entire Input Assembler stage, reducing memory bandwidth overhead and eliminating the need for CPU-side vertex buffers.
    

----------

### 🚀 Developer Tip: Avoiding Name Collisions

Since we now use dynamic naming, it’s important to remember that your pass names become **global identifiers** in WGSL.

> **Rule of Thumb:** Avoid naming your passes after WGSL reserved words (like `texture`, `var`, `fn`, `array`) or your own `addCommon` function names. A name like `fluid_sim` is always safer and more readable than just `fluid`.


## 🥂 Special Thanks & Credits
TinyShade stands on the shoulders of giants in the creative coding community:

**Mårten Rånge**: Huge thanks for the "[Introduction to Path Tracers](https://github.com/MagnusThor/so-you-think-you-can-code-2025/blob/main/day08/readme.md)" article featured in the SYTYCC 2025 Advent Calendar. The logic for the path-tracing examples in this repo is ported directly from his masterful WGSL/WebGPU implementation.

**PCrush**: For the [GPUSynth architecture](https://github.com/MagnusThor/so-you-think-you-can-code-2025/blob/main/day04/readme.md). TinyShade’s audio integration and internal DSP logic are heavily inspired by and adapted from his work on GPU-based sound synthesis.

---    

_Magnus Thor - December 2025_