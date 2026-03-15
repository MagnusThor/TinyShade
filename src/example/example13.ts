import { TinyShade } from "../TinyShade";

document.addEventListener("DOMContentLoaded", async () => {
    const app = await TinyShade.create("canvas");
    const MAP_RES = 1024;

    (await app.setUniforms()
        .addAtomicCompute("paint_buffer", /*wgsl*/`
            @compute @workgroup_size(64)
            fn main(@builtin(global_invocation_id) id: vec3u) {
                if (id.x > 0u) { return; }

                let radius = (1.0 - fract(u.time * 0.12)) * 0.45;
                let angle = u.time * 10.0;
                
                // Centered at 0.5, 0.5 in the 1024 grid
                let pos = vec2f(0.5) + vec2f(cos(angle), sin(angle)) * radius;
                let coords = vec2i(pos * 1024.0);

                for(var x=-3; x<=3; x++) {
                    for(var y=-3; y<=3; y++) {
                        let c = coords + vec2i(x, y);
                        if(c.x >= 0 && c.x < 1024 && c.y >= 0 && c.y < 1024) {
                            atomicAdd(&data[u32(c.y) * 1024u + u32(c.x)], 150u); 
                        }
                    }
                }
            }
        `, MAP_RES * MAP_RES, false)

        .addCompute("paint_resolve", /*wgsl*/`
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = u.resolution.xy; // Now matches physical pixels!
                if (f32(id.x) >= res.x || f32(id.y) >= res.y) { return; }

                // 1. Get standard UV (0 to 1)
                var uv = vec2f(id.xy) / res;

                // 2. Streamlined Aspect Correction
                // Ensures the 1024x1024 square stays a circle in the center
                let aspect = res.x / res.y;
                uv.x = (uv.x - 0.5) * aspect + 0.5;

                // 3. Bounds check: only draw inside the 1024x1024 area
                if(uv.x < 0.0 || uv.x > 1.0) {
                    textureStore(outTex, id.xy, vec4f(0.0, 0.0, 0.0, 1.0));
                    return;
                }

                let buffer_coords = vec2u(uv * 1024.0);
                let raw = atomicLoad(&paint_buffer_data[buffer_coords.y * 1024u + buffer_coords.x]);
                
                // Fast-visibility mapping
                let val = f32(raw) / 500.0; 
                textureStore(outTex, id.xy, vec4f(val * 0.2, val, val * 0.8, 1.0));
            }
        `, 0, ["paint_buffer"])

        .main(/*wgsl*/`
            @fragment 
            fn main(in: VSOut) -> @location(0) vec4f {
                return textureSample(paint_resolve, samp, in.uv);
            }
        `))
        .run();
});