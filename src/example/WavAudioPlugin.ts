import { IAudioPlugin } from "../plugins/IAudioPlugin";

/**
 * Audio plugin for handling .wav files.
 * Implements the IAudioPlugin interface for use within the TinyShade ecosystem.
 */
export class WavAudioPlugin implements IAudioPlugin {
    private context: AudioContext;
    private audioBuffer: AudioBuffer | null = null;
    private sourceNode: AudioBufferSourceNode | null = null;
    private analyserNode: AnalyserNode;
    
    private startTime: number = 0;
    private pauseOffset: number = 0;
    
    public isPlaying: boolean = false;

    constructor() {
        // Initialize AudioContext and Analyser for shader frequency data
        this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.analyserNode = this.context.createAnalyser();
        this.analyserNode.fftSize = 256; // Provides 128 frequency bins
        this.analyserNode.connect(this.context.destination);
    }

    /**
     * Fetches and decodes the WAV file.
     * @param url Path to the .wav file
     */
    public async load(url: string): Promise<void> {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        // Web Audio API natively supports WAV decoding
        this.audioBuffer = await this.context.decodeAudioData(arrayBuffer);
    }

    /**
     * Returns the current playback time in seconds.
     */
    public getTime(): number {
        if (!this.isPlaying) {
            return this.pauseOffset;
        }
        return this.context.currentTime - this.startTime;
    }

    /**
     * Starts or resumes the audio playback.
     */
    public async play(): Promise<void> {
        if (this.isPlaying || !this.audioBuffer) return;

        // Resume context if suspended (browser autoplay policy)
        if (this.context.state === "suspended") {
            await this.context.resume();
        }

        this.sourceNode = this.context.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.connect(this.analyserNode);

        // Start playback at the saved offset
        this.sourceNode.start(0, this.pauseOffset);
        this.startTime = this.context.currentTime - this.pauseOffset;
        this.isPlaying = true;

        this.sourceNode.onended = () => {
            // Only reset if it reached the natural end of the file
            if (this.isPlaying) {
                this.isPlaying = false;
                this.pauseOffset = 0;
            }
        };
    }

    /**
     * Stops/Pauses the audio playback.
     */
    public stop(): void {
        if (!this.isPlaying || !this.sourceNode) return;
        
        this.pauseOffset = this.context.currentTime - this.startTime;
        this.sourceNode.stop();
        this.sourceNode = null;
        this.isPlaying = false;
    }

    /**
     * Extracts frequency data normalized (0.0 - 1.0) for shader uniforms.
     */
    public getFrequencyData() {
        const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
        this.analyserNode.getByteFrequencyData(dataArray);

        // Calculate averages for Low, Mid, and High ranges
        const low = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / (10 * 255);
        const mid = dataArray.slice(10, 50).reduce((a, b) => a + b, 0) / (40 * 255);
        const high = dataArray.slice(50, 100).reduce((a, b) => a + b, 0) / (50 * 255);
        
        return {
            low,
            mid,
            high,
            vol: (low + mid + high) / 3
        };
    }
}