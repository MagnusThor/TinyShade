import { TinyShade } from "../TinyShade";
import { TSSequencer } from "../TSSequencer";

const start = async () => {
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
        .setUniforms() 
        
        .addCompute("noise_source", `
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = vec2u(u.resolution.xy);
                if (id.x >= res.x || id.y >= res.y) { return; }
                let uv = vec2f(id.xy) / u.resolution.xy;
                let val = sin(uv.x * 10.0 + u.time) * cos(uv.y * 10.0 + u.time);
                textureStore(outTex, id.xy, vec4f(vec3f(val * 0.5 + 0.5), 1.0));
            }
        `) 

        .addCompute("color_mask", `
            ##WORKGROUP_SIZE
            fn main(@builtin(global_invocation_id) id: vec3u) {
                let res = vec2u(u.resolution.xy);
                if (id.x >= res.x || id.y >= res.y) { return; }
                let uv = vec2f(id.xy) / u.resolution.xy;
                let col = 0.5 + 0.5 * cos(u.time + uv.xyx + vec3f(0, 2, 4));
                textureStore(outTex, id.xy, vec4f(col, 1.0));
            }
        `)

        .main(`
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
        `, ["noise_source", "color_mask"])
    ).run();
};

start();