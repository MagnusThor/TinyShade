// ── À-Trous edge-stopping denoiser ───────────────────────────────────────
//
// Single-pass sparse 3×3 kernel with stride=2 (9 taps, covers 5×5 footprint).
// Works in world-space texel size so it scales correctly from 640×360 dev
// all the way to 1920×1080 final render without any constant re-tuning.
//
// Edge stops:
//   • Luminance stop  — kills blur across emitter/lattice boundaries.
//     Sigma chosen so a delta-lum of 0.15 reduces weight to ~14%.
//   • Depth stop      — kills blur across geometry edges (uses computeTex0.a
//     which stores first_t / 20.0).  Sigma chosen so a 5% depth difference
//     reduces weight to ~14%.
//
// The blur amount is further gated by a luminance mask: bright pixels
// (lum > 0.28, i.e. emitters and sharp specular) get ≤5% blur so their
// edges stay crisp.  Only the dim lattice faces and fog get the full 80%.
//
// Gaussian kernel weights for a 3×3 sparse grid:
//   centre = 0.375,  edge-neighbours = 0.125,  corners = 0.0625
//   (approximates a σ=1 Gaussian; sum = 0.375 + 4×0.125 + 4×0.0625 = 1.0)

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

fn atrous_weight(lum_c: f32, lum_n: f32, dep_c: f32, dep_n: f32) -> f32 {
    // Luminance stop — σ_l = 0.12
    let dl  = (lum_c - lum_n) / 0.12;
    let wl  = exp(-dl * dl);
    // Depth stop — σ_d = 0.04  (fraction of max_t = 20 world units)
    let dd  = (dep_c - dep_n) / 0.04;
    let wd  = exp(-dd * dd);
    return wl * wd;
}

@fragment fn main(in: VSOut) -> @location(0) vec4f {
    let texel = 1.0 / u.resolution.xy;
    // Stride 2 makes the 3×3 sparse kernel cover a 5×5 pixel footprint,
    // giving much more averaging power for the same 9-tap cost.
    let s = texel * 2.0;

    let cur  = textureSample(computeTex0, samp, in.uv).rgb;
    let dep0 = textureSample(computeTex0, samp, in.uv).a;
    let lum0 = luma(cur);

    // ── 3×3 sparse Gaussian with edge stops ──────────────────────────────
    // Offsets: (-s,+s) × (-s,+s).  Kernel weights:
    //   corners = 0.0625,  edges = 0.125,  centre = 0.375
    var col_sum   = cur * 0.375;
    var weight_sum = 0.375;

    // Unrolled 8 neighbours — WGSL doesn't allow variable indexing on
    // sampled textures so we write them out explicitly.
    // Each tap: sample colour + depth, compute edge-stop weight, accumulate.
    let offsets = array<vec2f, 8>(
        vec2f(-s.x, -s.y), vec2f(0.0, -s.y), vec2f( s.x, -s.y),
        vec2f(-s.x,  0.0),                    vec2f( s.x,  0.0),
        vec2f(-s.x,  s.y), vec2f(0.0,  s.y), vec2f( s.x,  s.y)
    );
    let gauss_w = array<f32, 8>(
        0.0625, 0.125, 0.0625,
        0.125,         0.125,
        0.0625, 0.125, 0.0625
    );

    for (var i = 0; i < 8; i++) {
        let nuv  = in.uv + offsets[i];
        let nc   = textureSample(computeTex0, samp, nuv).rgb;
        let nd   = textureSample(computeTex0, samp, nuv).a;
        let w    = gauss_w[i] * atrous_weight(lum0, luma(nc), dep0, nd);
        col_sum    += nc * w;
        weight_sum += w;
    }

    let blurred = col_sum / weight_sum;

    // ── Luminance-gated blend ─────────────────────────────────────────────
    // Bright pixels (emitters, metallic highlights lum > 0.28) stay sharp.
    // Dark pixels (unlit lattice faces, fog) get up to 80% of the blur.
    let blurMix  = (1.0 - smoothstep(0.0, 0.28, lum0)) * 0.80;
    let denoised = mix(cur, blurred, blurMix);

    // ── Luminosity lift ───────────────────────────────────────────────────
    let dark   = 1.0 - smoothstep(0.0, 0.08, lum0);
    let lifted = denoised + vec3f(0.010, 0.012, 0.016) * dark;

    // ── Temporal accumulation ─────────────────────────────────────────────
    let his = textureSample(prev_pass_rt, samp, in.uv).rgb;
    return vec4f(mix(lifted, his, u.accumBlend), 1.0);
}
