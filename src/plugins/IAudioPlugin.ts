
/**
 * Interface for audio plugin implementations.
 * Provides methods and properties to control audio playback and track time.
 * 
 * @interface IAudioPlugin
 * 
 * @property {boolean} isPlaying - Indicates whether audio is currently playing.
 * 
 * @method getTime - Returns the current playback time in seconds.
 * @returns {number} The current playback time.
 * 
 * @method play - Starts or resumes audio playback.
 * @returns {void}
 */
export interface IAudioPlugin {
    isPlaying: boolean;
    getTime(): number;
    play(): void;
}
