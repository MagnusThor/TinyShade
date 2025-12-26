# 🌑 TinyShade

A minimalist, zero-boilerplate **WebGPU** framework designed for rapid prototyping of compute-driven visuals and post-process effects.

TinyShade simplifies the complex WebGPU binding model into a clean, chainable API. It handles **Ping-Ponging** (feedback textures), **Smart Compute Dispatching**, and **Uniform Management** automatically.

---

## 🚀 Core API

### 1. Initialize

TinyShade automatically detects your device pixel ratio and configures the GPU context.

```typescript
const app = await TinyShade.create("canvas-id");

```

### 2. Set Uniforms

Pass a callback to define custom data. TinyShade automatically generates the WGSL `struct` and manages the buffer updates every frame.

```typescript
app.setUniforms(l => {
    l.addUniform("count", 1_000_000)
     .addUniform("speed", 0.02)
     .addUniform("mouse", [0, 0]);
});

```

*Variables available in WGSL via: `u.time`, `u.resolution`, `u.count`, `u.speed`, etc.*

### 3. Smart Compute Stage

The `addCompute` method is context-aware.

* If **size > 0**: It treats the pass as a **1D simulation** (e.g., Particles) and provides a `data` buffer.
* If **size = 0**: It treats it as a **2D generative pass** (e.g., Fractals) and dispatches across the full screen grid.

```typescript
app.addCompute(COUNT, `
    ##WORKGROUP_SIZE
    fn main(@builtin(global_invocation_id) id: vec3u) {
        let i = id.x;
        // logic here...
        textureStore(outTex, coords, vec4f(color, 1.0));
    }
`);

```

> **Note:** Use the `##WORKGROUP_SIZE` placeholder. TinyShade will inject the optimal `@compute @workgroup_size(...)` attribute based on your hardware limits.

### 4. Multi-Pass Effects

Add as many passes as you like. TinyShade manages "Current" and "History" textures for every pass automatically, perfect for temporal smoothing, blur, or trails.

```typescript
app.addPass(`
    @fragment fn main(in: VSOut) -> @location(0) vec4f {
        let current = textureSample(computeTex, samp, in.uv).rgb;
        let history = textureSample(prevPass0, samp, in.uv).rgb; // History!
        return vec4f(mix(current, history, 0.9), 1.0);
    }
`);

```

### 5. Main Compositor

The final output to the canvas. Here you combine your passes and compute results.

```typescript
app.main(`
    @fragment fn main(in: VSOut) -> @location(0) vec4f {
        let bloom = textureSample(pass0, samp, in.uv).rgb;
        return vec4f(bloom, 1.0);
    }
`).run();

```

---

## 🧬 Shader Variables Reference

| Variable | Type | Source | Description |
| --- | --- | --- | --- |
| `u.<name>` | `any` | `setUniforms` | Access any custom uniform defined in JS. |
| `computeTex` | `texture_2d` | `addCompute` | The high-precision output of your compute shader. |
| `passN` | `texture_2d` | `addPass` | The output of the N-th pass (e.g., `pass0`, `pass1`). |
| `prevPassN` | `texture_2d` | `addPass` | The feedback (previous frame) of the N-th pass. |
| `samp` | `sampler` | Internal | A linear, filtering sampler ready to use. |
| `data` | `array<f32>` | `addCompute` | The storage buffer (only if `size > 0`). |

---

## 💡 Common Recipes

### Recipe: Volumetric Particles (1D)

Initialize with a count, update positions in `data` during the compute stage, and project them to `outTex`. Access the result in `main` via `computeTex`.

### Recipe: Generative Fractals (2D)

Initialize `addCompute` with `0`. The shader will automatically dispatch in an 8x8 grid across your entire resolution. Perfect for Mandlebrot sets or Raymarching.

### Recipe: Temporal Anti-Aliasing (Feedback)

Add a pass that samples `prevPass0`. Mix it with the `computeTex` to create motion blur or to smooth out high-frequency shimmering in fractals.

---

## ⚡ Technical Highlights

* **Binding Safety:** Uses a layout-first approach to ensure textures and buffers never mismatch during binding, preventing the common "Binding index not present" WebGPU crash.
* **Automatic Vertexing:** You never have to write a Vertex Shader. TinyShade injects a zero-input full-screen triangle.
* **Resource Management:** Automatically clears and swaps textures between frames to prevent memory leaks or artifacts.

---

