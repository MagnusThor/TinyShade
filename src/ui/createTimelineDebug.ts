export type TimelineEntry = [number, number, number];

export function createTimelineDebug(
    seq: any,
    totalMs: number,
    onSeek: (ms: number) => void
) {
    const container = document.querySelector("#timeline") as HTMLDivElement;
    if (!container) return;

    container.innerHTML = "";
    container.style.display = "flex";
    container.style.height = "40px";
    container.style.width = "100%";
    container.style.cursor = "pointer";
    container.style.fontFamily = "monospace";
    container.style.fontSize = "10px";
    container.style.overflow = "hidden";
    container.style.border = "1px solid #333";

    const timeline: TimelineEntry[] = seq.timeline;

    const unitsToMs = (units: number) => {
        return (units / 255) * totalMs;
    };

    let currentStartMs = 0;

    timeline.forEach(([units, _, sceneId], i) => {
        if (sceneId === 0) return;

        const durationMs = unitsToMs(units);
        const widthPercent = (durationMs / totalMs) * 100;

        const block = document.createElement("div");

        const hue = (sceneId * 47) % 360;
        block.style.background = `hsl(${hue}, 60%, 45%)`;

        block.style.width = `${widthPercent}%`;
        block.style.height = "100%";
        block.style.display = "flex";
        block.style.alignItems = "center";
        block.style.justifyContent = "center";
        block.style.borderRight = "1px solid rgba(0,0,0,0.3)";
        block.style.color = "white";
        block.style.userSelect = "none";

        block.innerText = `${sceneId}`;

        block.title = `Scene ${sceneId}
Start: ${Math.round(currentStartMs)} ms
Length: ${Math.round(durationMs)} ms`;

        block.onclick = () => {
            onSeek(currentStartMs);
        };

        container.appendChild(block);

        currentStartMs += durationMs;
    });
}