# 🌑 TinyShade

A minimalist, zero-boilerplate **WebGPU** framework designed for rapid prototyping of compute-driven visuals, simulations, and multi-pass post-process effects.

TinyShade simplifies the complex WebGPU binding model into a chainable API. It handles **Ping-Ponging** (feedback textures), **Dynamic Compute Dispatching**, and **Uniform Management** automatically.

----------

##  Core API: Step-by-Step

TinyShade allows you to chain an arbitrary number of Compute and Fragment passes ($1 \dots n$). The execution follows the order of your method calls.

### 1. Initialize

Sets up the GPU context, detects pixel density, and prepares the internal texture stack.


```typescript
const app = await TinyShade.create("canvas-id");
```


### 2. Global Helpers (addCommon)
Register a shared library of math and utility functions. TinyShade prepends this to every shader stage in the pipeline automatically.

```rust

app.addCommon(`
    fn rotate(p: vec2f, a: f32) -> vec2f {
        let s = sin(a); let c = cos(a);
        return mat2x2f(c, s, -s, c) * p;
    }
`);

### 3. Set Uniforms

Define custom data in JS. TinyShade automatically injects the **standard built-ins** into the `u` struct for every shader. You do not need to define `time` or `resolution` manually.

```typescript
app.setUniforms(l => {
    // Standard built-ins are ALWAYS available:
    // u.time       : f32
    // u.resolution : vec3<f32> (x: width, y: height, z: aspect)
    l.addUniform("speed", 0.02)
     .addUniform("intensity", 0.5);
});
```

_Access in WGSL via `u.speed`, `u.color`, etc._  

**Note:** `u.resolution` is a `vec3f` where `.z` stores the aspect ratio ($width / height$), saving you a division inside the shader.


### 4. Compute Engine (`addCompute`)

You can add $1 \dots n$ compute passes. TinyShade automatically handles the workgroup dispatch based on your input.

-   **1D Simulation Mode (`size > 0`):** Perfect for particles or physics. Provides a `data` storage buffer.
    
-   **2D Generative Mode (`size = 0`):** Dispatches across the full screen grid (resolution).
    

```rust
app.addCompute(1024, `
    //##WORKGROUP_SIZE
    fn main(@builtin(global_invocation_id) id: vec3u) {
        // Manipulate the storage buffer (1D Mode)
        data[id.x] = data[id.x] + u.speed;
        
        // Or write to the output texture (2D Mode)
        textureStore(outTex, id.xy, vec4f(1.0));
    }
`);

```
**Note:** `##WORKGROUP_SIZE` is dynamically replaced at runtime by the most suitable compute workgroup settings for the specific device executing the code. If you prefer to use a specific manual setting like `@compute @workgroup_size(8, 8, 1)`, you can simply omit the tag and write it out.

### 5. Single & Multi-Pass Fragment (`addPass`)

Add $1 \dots n$ fragment passes for post-processing or feedback effects. Every `addPass` creates a new `passN` texture that subsequent passes can sample.

```rust
// PASS 0: Edge Detection
app.addPass(\`
    @fragment fn main(in: VSOut) -> @location(0) vec4f {
        let tex = textureSample(computeTex, samp, in.uv).rgb;
        return vec4f(tex * 2.0, 1.0);
    }
\`)
// PASS 1: Temporal Feedback (Blur/Motion)
.addPass(\`
    @fragment fn main(in: VSOut) -> @location(0) vec4f {
        let current = textureSample(pass0, samp, in.uv).rgb;
        let history = textureSample(prevPass1, samp, in.uv).rgb; // History of THIS pass
        return vec4f(mix(current, history, 0.9), 1.0);
    }
\`);

```

### 6. Final Compositor (`main`)

The end of the chain. This pass renders directly to the canvas swapchain.

```rust
app.main(`
    @fragment fn main(in: VSOut) -> @location(0) vec4f {
        let finalColor = textureSample(pass1, samp, in.uv).rgb;
        return vec4f(finalColor, 1.0);
    }
`).run();

```

----------


## Shader Variables Reference

| Variable       | Type          | Source        | Description |
|---------------|---------------|---------------|-------------|
| `u.<name>`     | `any`         | `setUniforms` | Access any custom uniform defined in JS. |
| `computeTex`   | `texture_2d`  | `addCompute`  | The high-precision output of your compute shader. |
| `passN`        | `texture_2d`  | `addPass`     | The output of the N-th pass (e.g., `pass0`, `pass1`). |
| `prevPassN`    | `texture_2d`  | `addPass`     | The feedback (**previous frame**) of the N-th pass. |
| `samp`         | `sampler`     | Internal      | A linear, filtering sampler ready to use. |
| `data`         | `array<f32>`  | `addCompute`  | The storage buffer (active only if `size > 0`). |
----------


##  Example 1: Compute Fractal to Screen

A common pattern is using `addCompute` for heavy calculations (like a fractal orbit trap) and then flushing it to the screen via `.main()`.  

View the example here [https://magnusthor.github.io/TinyShade/public/example-2.html](https://magnusthor.github.io/TinyShade/public/example-2.html)

```rust
    const app = await TinyShade.create("canvas");

    app.setUniforms()
    /**
     * COMPUTE PASS: Fractal Orbit Trap
     */
    .addCompute(0,`
         const AA: i32 = 3;
        const sqrt2_inv: f32 = 0.70710678118;
        //##WORKGROUP_SIZE
        @compute @workgroup_size(8, 8, 1)
        fn main(@builtin(global_invocation_id) id: vec3u) {
           const AA: i32 = 3;
            const sqrt2_inv: f32 = 0.70710678118;

            let R = u.resolution;
            // Guard against out-of-bounds if resolution isn't multiple of 8
            if (f32(id.x) >= R.x || f32(id.y) >= R.y) { return; }

            let fragCoord = vec2f(f32(id.x), f32(id.y));
            var col = vec3f(0.0);

            // Precompute constant values
            let zoo = 1.0 / (350.0 - 250.0 * sin(fma(0.25, u.time, -0.3))); 
            let t2c_base = vec2f(-0.5, 2.0) + 0.5 * vec2f(
                cos(fma(0.13, u.time, -1.3)), 
                sin(fma(0.13, u.time, -1.3))
            );

            // Anti-Aliasing Loop
            for (var m: i32 = 0; m < AA; m++) {
                for (var n: i32 = 0; n < AA; n++) {
                    let p = (2.0 * (fragCoord + vec2f(f32(m), f32(n)) / f32(AA)) - R.xy) / R.y;

                    let cc = vec2f(-0.533516, 0.526141) + p * zoo;  
                    var z = vec2f(0.0);  
                    var dz = vec2f(0.0);
                    var trap1: f32 = 0.0;  
                    var trap2: f32 = 1e20;
                    var co2: f32 = 0.0;  

                    for (var i: i32 = 0; i < 150; i++) {
                        dz = vec2f(fma(2.0 * z.x, dz.x, -2.0 * z.y * dz.y), 
                                   fma(2.0 * z.x, dz.y, 2.0 * z.y * dz.x)) + vec2f(1.0, 0.0);
                        z = cc + vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);

                        let shouldBreak = dot(z, z) > 1024.0;
                        if (shouldBreak) { break; } 

                        let z_offset = z - vec2f(0.0, 1.0);
                        let d1 = abs(dot(z_offset, vec2f(sqrt2_inv)));
                        let ff = 1.0 - smoothstep(0.6, 1.4, d1);
                        co2 = fma(ff, d1, co2); 
                        trap1 = fma(ff, d1, trap1); 
                        trap2 = min(trap2, dot(z - t2c_base, z - t2c_base)); 
                    }

                    let d = sqrt(dot(z, z) / dot(dz, dz)) * log(dot(z, z));
                    let c1 = pow(clamp(2.0 * d / zoo, 0.0, 1.0), 0.5);
                    let c2 = pow(clamp(1.5 * trap1 / co2, 0.0, 1.0), 2.0);
                    let c3 = pow(clamp(0.4 * trap2, 0.0, 1.0), 0.25);

                    let factor1 = 3.0 + 4.0 * c2; 
                    let factor2 = 4.1 + 2.0 * c3;

                    col += 2.0 * sqrt(c1 * (0.5 + 0.5 * sin(factor1 + vec3f(0.0, 0.5, 1.0))) * (0.5 + 0.5 * sin(factor2 + vec3f(1.0, 0.5, 0.0))));
                }
            }

            col /= f32(AA * AA);
            textureStore(outTex, id.xy, vec4f(col, 1.0)); 
        }
    `)
    /**
     * MAIN: Final Post-Process
     */
    .main(`
        @fragment fn main(in: VSOut) -> @location(0) vec4f {
            let uv = in.uv;
            let fractal = textureSample(computeTex, samp, uv).rgb;
            
            // Add a subtle vignette and contrast
            let vignette = smoothstep(1.5, 0.3, length(uv - 0.5));
            let color = pow(fractal * vignette, vec3f(1.1));
            
            return vec4f(color, 1.0);
        }
    `)
    .run();
```

> Credits; this Compute Shader is an WGSL implementation of this [shadertoy.com/view/ldf3DN](https://shadertoy.com/view/ldf3DN) by  Inigo Quilez (iq)


##  Example 2: Cellular Warp with Temporal Bloom

Demonstrating complex generative math in a pass followed by a multi-tap bloom compositor.  
View the example here [https://magnusthor.github.io/TinyShade/public/example-3.html](https://magnusthor.github.io/TinyShade/public/example-3.html)

```rust

   const app = await TinyShade.create("canvas");

   app.setUniforms().addPass(`
       fn hash22(p: vec2f) -> vec2f {
           var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
           p3 += dot(p3, p3.yzx + 33.33);
           return fract((p3.xx + p3.yz) * p3.zy);
       }

       fn rotate2D(r: f32) -> mat2x2f {
           let c = cos(r); let s = sin(r);
           return mat2x2f(c, s, -s, c);
       }

       @fragment 
       fn main(in: VSOut) -> @location(0) vec4f {
           let res = u.resolution.xy;
           let uv = (in.pos.xy - 0.5 * res) / res.y;

           var p = uv;
           var n = vec2f(0.0);
           var warp_accum = 0.0;
           let m = rotate2D(5.0);
           
           for (var j: f32 = 0.0; j < 6.0; j += 1.0) {
               p = m * p;
               n = m * n;
               let q = p * 1.5 + u.time * 0.5 + n;
               warp_accum += dot(cos(q), vec2f(0.2));
               n -= sin(q);
           }

           let cell_uv = uv * 8.0 + n; 
           let i_p = floor(cell_uv);
           let f_p = fract(cell_uv);
           
           var min_dist: f32 = 1.0;
           for (var y: f32 = -1.0; y <= 1.0; y += 1.0) {
               for (var x: f32 = -1.0; x <= 1.0; x += 1.0) {
                   let neighbor = vec2f(x, y);
                   var point = hash22(i_p + neighbor);
                   point = 0.5 + 0.5 * sin(u.time + 6.28 * point);
                   let dist = length(neighbor + point - f_p);
                   min_dist = min(min_dist, dist);
               }
           }

           let history = textureSampleLevel(prevPass0, samp, in.uv, 0.0).rgb;
           let membrane = smoothstep(0.4, 0.1, min_dist);
           let glow_val = (1.0 - min_dist) * warp_accum;
           
           var current_rgb = mix(vec3f(0.3, 0.01, 0.03), vec3f(1.0, 0.7, 0.6), membrane);
           current_rgb += glow_val * vec3f(1.0, 0.3, 0.1);

           return vec4f(mix(current_rgb, history, 0.85), 1.0); // Temporal Smooth
       }
   `)
   .main(`
       @fragment 
       fn main(in: VSOut) -> @location(0) vec4f {
           let uv = in.uv;
           let scene = textureSample(pass0, samp, uv).rgb;

           // Multi-tap Bloom (Cheap Gaussian Blur)
           let b_radius = 0.005;
           var bloom = textureSample(pass0, samp, uv + vec2f(b_radius)).rgb;
           bloom += textureSample(pass0, samp, uv - vec2f(b_radius)).rgb;
           bloom *= 0.5;

           let glow = max(bloom - 0.2, vec3f(0.0)) * 2.5;
           let vignette = smoothstep(1.2, 0.3, length(uv - 0.5));
           return vec4f((scene + glow) * vignette, 1.0);
       }
   `)
   .run();
```

## ⚡ Technical Highlights

-   **Automatic Vertexing**: Injects an optimized zero-input full-screen triangle.
    
-   **Binding Safety**: Layout-first approach prevents "Binding index mismatch" crashes.
    
-   **Smart Dispatch**: Automatically calculates optimal grid dispatch based on `u.resolution`.
    

