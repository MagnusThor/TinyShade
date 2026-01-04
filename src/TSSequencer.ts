export class TSSequencer {
    constructor(
        public timeline: any[][], 
        public L: number = 170000,
        public bpm: number = 120,
        public beatsPerBar: number = 4
    ) {}

    /**
    * Converts milliseconds into Relative Units for timeline positioning.
    * Best for intros, breakdowns, FX tails, silence.
    * @param ms - Duration in milliseconds
    * @param totalLength - Total length of the timeline in some reference unit
    * @returns The duration in relative units
    */
    getUnitsFromMs(ms: number, totalLength: number): number {
        return (ms * 44.1) / (totalLength * 2);
    }

    /**
    * Converts musical bars into Relative Units for timeline positioning.
    * Best for grooves, drops, verses, repeating structures.
    * @param bars - Duration in musical bars
    * @param totalLength - Total length of the timeline in some reference unit
    * @returns The duration in relative units
    */
    getUnitsFromBars(bars: number, totalLength: number): number {
        const secondsPerBeat = 60 / this.bpm;
        const secondsPerBar  = secondsPerBeat * this.beatsPerBar;
        return this.getUnitsFromMs(bars * secondsPerBar * 1000, totalLength);
    }

    update(seconds: number) {
        // Map real time to World Space Units
        let playhead = (seconds * 1000 * 44.1) / (this.L * 2);
        let cursor = 0;
        let localTime = playhead;

        // Traverse timeline
        while (
            cursor < this.timeline.length - 1 && 
            this.timeline[cursor][0] < 255 && 
            localTime >= this.timeline[cursor][0]
        ) {
            localTime -= this.timeline[cursor++][0];
        }

        const activeScene = this.timeline[cursor];
        const duration = activeScene[0];
        
        return {
            progress: Math.min(Math.max(0, localTime / duration), 1),
            flags: activeScene[1],
            sceneId: activeScene[2]
        };
    }
}