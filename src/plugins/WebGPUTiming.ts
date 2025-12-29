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
    public currentIndex = 0;
    public maxQueries = 20;
    private isMapping = false;

    constructor(public device: GPUDevice, private onResult?: (results: {name: string, ms: number}[]) => void) {
        this.supportsTimeStampQuery = device.features.has("timestamp-query");
        if (this.supportsTimeStampQuery) {
            this.querySet = device.createQuerySet({ type: "timestamp", count: this.maxQueries });
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

    reset() { this.currentIndex = 0; }

    allocateIndices(): { start: number; end: number } | null {
        if (!this.supportsTimeStampQuery || this.currentIndex + 2 > this.maxQueries) return null;
        const indices = { start: this.currentIndex, end: this.currentIndex + 1 };
        this.currentIndex += 2;
        return indices;
    }

    async resolve(passTimings: { name: string, start: number, end: number }[]) {
        if (!this.supportsTimeStampQuery || this.isMapping || passTimings.length === 0) return;
        if (this.readBuffer!.mapState !== "unmapped") return;

        this.isMapping = true;
        try {
            const enc = this.device.createCommandEncoder();
            enc.resolveQuerySet(this.querySet!, 0, this.currentIndex, this.resolveBuffer!, 0);
            enc.copyBufferToBuffer(this.resolveBuffer!, 0, this.readBuffer!, 0, this.currentIndex * 8);
            this.device.queue.submit([enc.finish()]);

            await this.readBuffer!.mapAsync(GPUMapMode.READ);
            const timestamps = new BigUint64Array(this.readBuffer!.getMappedRange().slice(0));
            this.readBuffer!.unmap();

            const results = passTimings.map(t => ({
                name: t.name,
                ms: Number(timestamps[t.end] - timestamps[t.start]) / 1000000
            }));

            if (this.onResult) this.onResult(results);
        } catch (e) {
            // Mapping interrupted or device lost
        } finally {
            this.isMapping = false;
        }
    }
}