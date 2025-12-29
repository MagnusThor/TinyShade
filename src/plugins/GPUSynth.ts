import { IAudioPlugin } from "./IAudioPlugin";

/**
 * GPU-accelerated audio synthesizer that uses WebGPU compute shaders to generate audio samples.
 * 
 * Generates audio in chunks by dispatching compute work to the GPU, then reads back the results
 * and schedules them for playback through the Web Audio API.
 * 
 * GPUSynth is originally written by Crush for SYTYCD 2025
 * 
 * @example
 * ```typescript
 * const device = await navigator.gpu.requestAdapter().requestDevice();
 * const wgslShader = `@compute @workgroup_size(64) fn main(...) { ... }`;
 * const synth = new GPUSynth(device, wgslShader);
 * await synth.play();
 * ```
 */
export class GPUSynth implements IAudioPlugin{
    private ctx: AudioContext;
    private device: GPUDevice;
    private pipeline: GPUComputePipeline;
    private storageBuffer: GPUBuffer;
    private readBuffer: GPUBuffer;
    private uniformBuffer: GPUBuffer;
    private bindGroup: GPUBindGroup;

    private sampleRate: number;
    private bufferSamples: number = 16384; 
    private absoluteSampleCount: number = 0;
    private nextScheduleTime: number = 0;

    /**
     * Initializes a TinyAudio instance with GPU compute capabilities for audio processing.
     * 
     * @param device - The GPU device used for creating buffers and compute pipelines
     * @param wgslSource - The WGSL shader source code for the compute pipeline
     * 
     * @remarks
     * This constructor sets up:
     * - An AudioContext for audio output with the system's sample rate
     * - GPU storage buffers for audio sample data and readback operations
     * - A uniform buffer for passing parameters to the compute shader
     * - A compute pipeline from the provided WGSL source
     * - A bind group linking the uniform and storage buffers to the pipeline
     * 
     * The storage buffer size is calculated based on `bufferSamples` property (4 bytes per sample).
     */
    constructor(device: GPUDevice, wgslSource: string) {
        this.device = device;
        this.ctx = new AudioContext();
        this.sampleRate = this.ctx.sampleRate;

        const byteSize = this.bufferSamples * 4;

        this.storageBuffer = device.createBuffer({
            size: byteSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        this.readBuffer = device.createBuffer({
            size: byteSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        this.uniformBuffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        const shaderModule = device.createShaderModule({ code: wgslSource });
        this.pipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' }
        });

        this.bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.storageBuffer } }
            ]
        });
    }
    isPlaying: boolean = false

    /**
     * Gets the current playback time of the audio context.
     * @returns The current time in seconds.
     */
    getTime(): number {
        return this.ctx.currentTime;
    }

    private async generateChunk(startTime: number, channel: number): Promise<Float32Array> {
        const uniformData = new Float32Array([startTime, this.sampleRate, channel, 0]);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(this.bufferSamples / 64));
        pass.end();

        encoder.copyBufferToBuffer(this.storageBuffer, 0, this.readBuffer, 0, this.readBuffer.size);
        this.device.queue.submit([encoder.finish()]);

        await this.readBuffer.mapAsync(GPUMapMode.READ);
        const audioData = new Float32Array(this.readBuffer.getMappedRange()).slice();
        this.readBuffer.unmap();
        
        return audioData;
    }

    /**
     * Plays audio using the Web Audio API scheduler pattern.
     * 
     * Resumes the audio context if it's suspended, then schedules audio buffer chunks
     * to be played with a 0.5 second lookahead buffer. Each chunk is generated for both
     * left and right channels and queued for playback.
     * 
     * @param cb - Optional callback function to execute immediately after scheduling begins
     * @returns A promise that resolves after the scheduler is initiated
     * 
     * @remarks
     * - The scheduler runs on a 100ms interval to maintain the audio playback queue
     * - Audio chunks are scheduled with a minimum 0.1 second offset from current time
     * - The absolute sample count is incremented to track the total samples processed
     * 
     * @example
     * ```typescript
     * await audioPlayer.play(() => console.log('Playback started'));
     * ```
     */
    async play(cb?:() => void) {
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        this.isPlaying = true;
        
        this.nextScheduleTime = this.ctx.currentTime + 0.1;
        
        const scheduler = async () => {
            if (!this.ctx) return;
            
            while (this.nextScheduleTime < this.ctx.currentTime + 0.5) {
                const startS = this.absoluteSampleCount / this.sampleRate;
                
                const left = await this.generateChunk(startS, 0);
                const right = await this.generateChunk(startS, 1);

                const audioBuf = this.ctx.createBuffer(2, this.bufferSamples, this.sampleRate);
               
                audioBuf.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
                audioBuf.copyToChannel(right as Float32Array<ArrayBuffer>, 1);

                const source = this.ctx.createBufferSource();
                source.buffer = audioBuf;
                source.connect(this.ctx.destination);
                source.start(this.nextScheduleTime);

                this.nextScheduleTime += this.bufferSamples / this.sampleRate;
                this.absoluteSampleCount += this.bufferSamples;
            }
            setTimeout(scheduler, 100);
        };

        scheduler();
       
        if(cb) cb();
    }
}

/**
 * WGSL compute shader for synthesizing "Sweet Dreams" audio.
 * 
 * Generates a polyphonic synthesizer with 16 simultaneous voices playing a predefined
 * melody pattern, combined with a kick drum pulse. The shader uses triangle wave oscillators
 * with stereo phase shifting and ADSR envelope modulation.
 * 
 * @remarks
 * - Processes audio samples at the specified sample rate
 * - Uses a 16-note repeating melody with BPS (beats per second) timing at 2.1 BPS
 * - Each voice has an independent ADSR envelope starting at different times
 * - Applies pitch shifting based on the second half of a 32-beat cycle
 * - Includes stereo channel separation via phase modulation
 * - Adds a percussive kick drum with its own envelope
 * 
 * @group 0 @binding 0 - AudioUniforms containing bufferTime, sampleRate, channel, and padding
 * @group 0 @binding 1 - Read-write storage buffer for output audio samples
 * 
 * @returns void - Writes processed audio samples to the output buffer
 * 
 * @example
 * // Used in a compute pipeline to generate audio in real-time
 * // Output values are clamped to [-1.0, 1.0] range for valid audio
 */
export const SWEET_DREAMS_WGSL = /* wgsl */`

struct AudioUniforms {
    bufferTime: f32,
    sampleRate: f32,
    channel: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: AudioUniforms;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;

const PI: f32 = 3.14159265359;
const BPS: f32 = 2.1;

fn noteToFreq(n: f32) -> f32 {
    return pow(2.0, (n - 49.0) / 12.0) * 440.0;
}

fn adsr(t_abs: f32, env: vec4f, start: f32, duration: f32) -> f32 {
    let t = t_abs - start;
    let sustain = env.z;
    let t1 = env.x;
    let t2 = t1 + env.y;
    let t3 = max(t2, duration);
    let t4 = t3 + env.w;

    if (t < 0.0 || t > t4) { return 0.0; }
    if (t <= t1) { return smoothstep(0.0, t1, t); }
    if (t <= t2) { return sustain + smoothstep(t2, t1, t) * (1.0 - sustain); }
    if (t <= t3) { return sustain; }
    return sustain * smoothstep(t4, t3, t);
}

fn tri(t: f32, x: f32) -> f32 {
    return abs(1.0 - ((2.0 * t * x) % 2.0)) * 2.0 - 1.0;
}

fn synth(t: f32, f: f32) -> f32 {
    var time = t;
    // Stereo phase shift based on channel
    time += select(0.2, 0.6, u.channel > 0.5) * sin(t * 2.0) / f;
    return 0.3 * tri(time, f / 2.0) + 0.2 * tri(time, f / 4.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if (idx >= arrayLength(&output)) { return; }

    let t = u.bufferTime + f32(idx) / u.sampleRate;
    let m = (t * BPS * 2.0) % 16.0;
    
    var notes = array<f32, 16>(24., 24., 36., 48., 39., 51., 36., 48., 32., 32., 44., 48., 31., 31., 46., 48.);
    var sound: f32 = 0.0;

    for (var i: i32 = 0; i < 16; i = i + 1) {
        let is_second_half = ((t * BPS * 2.0) % 32.0) > 16.0;
        let pitch_factor = select(2.0, 1.0, is_second_half);
        
        sound += synth(t, pitch_factor * noteToFreq(notes[i])) * adsr(m, vec4f(0.1, 0.2, 0.7, 0.8), f32(i), 0.6);
    }

    // Add a simple kick drum pulse
    let beat_t = (t * BPS) % 2.0;
    let kick = tri(beat_t, 60.0 * smoothstep(0.4, 0.0, beat_t)) * adsr(beat_t, vec4f(0.01, 0.1, 0.0, 0.2), 0.0, 0.2);

    output[idx] = clamp((sound * 0.4) + (kick * 0.5), -1.0, 1.0);
}`