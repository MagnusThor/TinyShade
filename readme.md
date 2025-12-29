
# 🌑 TinyShade

A minimalist, zero-boilerplate **WebGPU** framework designed for rapid prototyping of compute-driven visuals, simulations, and multi-pass post-process effects.

TinyShade simplifies the complex WebGPU binding model into a chainable API. It handles **Ping-Ponging** (feedback textures), **Dynamic Compute Dispatching**, and **Uniform Management** automatically.

----------

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

----------

## 📜 Shader Variables Reference

| Variable        | Type             | Source        | Description                                                                 |
|-----------------|------------------|---------------|-----------------------------------------------------------------------------|
| `u.<name>`      | `any`            | `setUniforms` | Access any custom uniform defined in JS.                                     |
| `<name>`        | `texture_2d`     | `addCompute`  | The output texture of a named compute pass.                                  |
| `<name>`        | `texture_2d`     | `addPass`     | The current frame output of a named fragment pass.                           |
| `prev_<name>`   | `texture_2d`     | `addPass`     | The **previous frame** (feedback) of a named fragment pass.                  |
| `outTex`        | `texture_storage`| Internal      | The write-only target inside the **active** compute pass.                    |
| `samp`          | `sampler`        | Internal      | A linear, filtering sampler ready to use globally.                           |
| `data`          | `array<f32>`     | `addCompute`  | Storage buffer (active only if `size > 0`).                                  |
| `<name>`        | `texture_2d`     | `addTexture`  | Loaded external images/canvases (e.g., `matcap`).                             |

----------

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

----------

## ⬛ Core API: Step-by-Step

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

_Note: `##WORKGROUP_SIZE` is replaced with hardware-optimized settings like `@workgroup_size(16, 16, 1)`._

### 3. Multi-Pass Fragment (`addPass`)

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

----------

## 🎹 Audio Integration (`addAudio`)

TinyShade supports sample-accurate timing. By implementing `IAudioPlugin`, an engine (like `GPUSynth`) can drive the `u.time` uniform.


```ts
app.addAudio(mySynth) // u.time is now driven by the audio clock
   .run();

```

## ⚡ Technical Highlights

-   **Hardware-Aware Dispatch**: Automatically queries `maxComputeWorkgroupSize` to optimize thread counts.
    
-   **Zero-Input Vertexing**: Injects an optimized full-screen triangle requiring no CPU-side vertex buffers.
    
-   **Smart Binding Safety**: Orchestrates `@group(0)` bindings so textures, samplers, and buffers never collide.
    
-   **Master Clock Sync**: Uses `IAudioPlugin.isPlaying` to intelligently toggle between system time and audio time.
    

Magnus Thor - December 2025