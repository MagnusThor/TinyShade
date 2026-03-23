import { UniformUI, UniformUIConfig } from "./UniformUI";

export function createDevHUD(opts: {
    seq: any;
    audio: HTMLAudioElement;
    uniformsFn: any;
    uniformConfig?: UniformUIConfig;
    getFFT: () => Float32Array;
    totalMs: number;
    container?: string;
}) {
    const {
        seq,
        audio,
        uniformsFn,
        uniformConfig,
        getFFT,
        totalMs,
        container = "body"
    } = opts;

    const root = document.createElement("div");

    Object.assign(root.style, {
        position: "fixed",
        bottom: "0",
        left: "0",
        width: "100%",
        background: "rgba(0,0,0,0.75)",
        color: "#fff",
        fontFamily: "monospace",
        fontSize: "11px",
        zIndex: "9999",
        backdropFilter: "blur(6px)"
    });

    document.querySelector(container)?.appendChild(root);

    const timeline = document.createElement("div");
    Object.assign(timeline.style, {
        position: "relative",
        height: "40px",
        display: "flex",
        cursor: "pointer",
        borderTop: "1px solid #333"
    });
    root.appendChild(timeline);

    const unitsToMs = (u: number) => (u / 255) * totalMs;

    let current = 0;
    const blocks: HTMLDivElement[] = [];

    seq.timeline.forEach(([units, _, sceneId]: any) => {
        if (sceneId === 0) return;

        const dur = unitsToMs(units);
        const w = (dur / totalMs) * 100;

        const el = document.createElement("div");
        const hue = (sceneId * 47) % 360;

        Object.assign(el.style, {
            width: w + "%",
            background: `hsl(${hue},60%,45%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRight: "1px solid #000",
            userSelect: "none"
        });

        el.innerText = sceneId;
        el.onclick = () => (audio.currentTime = current / 1000);

        timeline.appendChild(el);
        blocks.push(el);

        current += dur;
    });

    const playhead = document.createElement("div");
    Object.assign(playhead.style, {
        position: "absolute",
        top: "0",
        width: "2px",
        height: "100%",
        background: "#fff",
        pointerEvents: "none"
    });
    timeline.appendChild(playhead);

    let dragging = false;

    timeline.onmousedown = (e) => {
        dragging = true;
        seek(e);
    };

    window.addEventListener("mouseup", () => dragging = false);
    window.addEventListener("mousemove", (e) => dragging && seek(e));

    function seek(e: MouseEvent) {
        const rect = timeline.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        audio.currentTime = (pct * totalMs) / 1000;
    }

    const playback = document.createElement("div");
    Object.assign(playback.style, {
        padding: "4px",
        borderTop: "1px solid #333"
    });

    const btn = document.createElement("button");
    btn.innerText = "Pause";

    btn.onclick = () => {
        if (audio.paused) {
            audio.play();
            btn.innerText = "Pause";
        } else {
            audio.pause();
            btn.innerText = "Play";
        }
    };

    playback.appendChild(btn);
    root.appendChild(playback);

    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 40;
    root.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;

    function drawFFT() {
        const data = getFFT();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            const x = i * 3;
            const h = v * canvas.height;

            ctx.fillRect(x, canvas.height - h, 2, h);
        }
    }

    const uniformContainer = document.createElement("div");
    uniformContainer.id = "uniform-ui";
    root.appendChild(uniformContainer);

    const uniformUI = UniformUI.attach(
        uniformsFn,
        "#uniform-ui",
        uniformConfig
    );

    function update() {
        const ms = audio.currentTime * 1000;

        playhead.style.left = (ms / totalMs) * 100 + "%";

        let t = 0;
        let activeIndex = 0;

        seq.timeline.forEach(([units, _, sceneId]: any, i: number) => {
            if (sceneId === 0) return;

            const dur = unitsToMs(units);
            if (ms >= t && ms < t + dur) activeIndex = i;
            t += dur;
        });

        blocks.forEach((b, i) => {
            b.style.outline = i === activeIndex ? "2px solid #fff" : "none";
        });

        drawFFT();

        requestAnimationFrame(update);
    }

    update();

    return {
        destroy() {
            root.remove();
        },
        ui: uniformUI
    };
}