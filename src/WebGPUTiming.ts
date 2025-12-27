export class RollingAverage {
    samples: number[] = [];
    constructor(private size: number = 60) {}
    add(val: number) {
        this.samples.push(val);
        if (this.samples.length > this.size) this.samples.shift();
    }
    get() { return this.samples.reduce((a, b) => a + b, 0) / this.samples.length; }
}

export class WebGPUTiming {
    supportsTimeStampQuery: boolean;
    querySet: GPUQuerySet | undefined;
    resolveBuffer: GPUBuffer | undefined;
    readBuffer: GPUBuffer | undefined;
    
    private currentIndex = 0;
    private maxQueries = 20;

    constructor(public device: GPUDevice) {
        this.supportsTimeStampQuery = device.features.has("timestamp-query");

        if (this.supportsTimeStampQuery) {
            this.querySet = device.createQuerySet({ 
                type: "timestamp", 
                count: this.maxQueries 
            });
            this.resolveBuffer = device.createBuffer({
                size: this.maxQueries * 8,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            this.readBuffer = device.createBuffer({
                size: this.maxQueries * 8,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
        }
    }

    reset() {
        this.currentIndex = 0;
    }

    allocateIndices(): { start: number; end: number } | null {
        if (!this.supportsTimeStampQuery || this.currentIndex + 2 > this.maxQueries) return null;
        const indices = { start: this.currentIndex, end: this.currentIndex + 1 };
        this.currentIndex += 2;
        return indices;
    }
}