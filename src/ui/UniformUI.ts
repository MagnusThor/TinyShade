// src/ui/UniformUI.ts

import { UniformLayout } from "../UniformLayout";

export interface UniformUIRangeConfig {
    min: number;
    max: number;
    step?: number;
    onChange?: (value: number | number[]) => void;
}

export interface UniformUIToggleConfig {
    label?: string;
    default?: boolean;
    onChange?: (value: boolean) => void;
}

export interface UniformUIConfig {
    skip?: string[];
    ranges?:  Record<string, UniformUIRangeConfig>;
    toggles?: Record<string, UniformUIToggleConfig>;
}

type UniformsFunction = (l: UniformLayout) => void;

const BUILTIN_SKIP = new Set([
    "resolution", "time", "deltaTime", "sceneId", "progress", "flags", "frame"
]);

const AXIS_COLORS = ["#E24B4A", "#1D9E75", "#378ADD", "#aaa"];
const AXIS_LABELS = ["x", "y", "z", "w"];

const DEFAULT_RANGES: Record<string, UniformUIRangeConfig> = {
    f32:   { min: -10, max: 10, step: 0.01 },
    vec2f: { min: -10, max: 10, step: 0.01 },
    vec3f: { min: -10, max: 10, step: 0.01 },
    vec4f: { min: -1,  max: 1,  step: 0.01 },
};

export class UniformUI {

    private slidersByName:  Map<string, HTMLInputElement[]> = new Map();
    private displaysByName: Map<string, HTMLSpanElement[]>  = new Map();
    private togglesByName:  Map<string, HTMLInputElement>   = new Map();

    // ── Public API ───────────────────────────────────────────────────────

    static attach(
        uniformsFn: UniformsFunction,
        selector: string,
        config: UniformUIConfig = {}
    ): UniformUI {
        const instance = new UniformUI();
        instance.init(uniformsFn, selector, config);
        return instance;
    }

    /**
     * Programmatically push new values into sliders.
     * Keeps the panel visually in sync when driven from code (e.g. keydown).
     *
     *   ui.setValues("ro",      [1.2, 0.5, -4.0]);
     *   ui.setValues("samples", 8);
     */
    setValues(name: string, value: number | number[]): void {
        const sliders  = this.slidersByName.get(name);
        const displays = this.displaysByName.get(name);
        if (!sliders) return;

        const arr = typeof value === "number" ? [value] : (value as number[]);
        arr.forEach((v, i) => {
            if (sliders[i])    sliders[i].value        = String(v);
            if (displays?.[i]) displays[i].textContent = UniformUI.fmtVal(v, parseFloat(sliders[i].step));
        });
    }

    /**
     * Programmatically set a toggle.
     *
     *   ui.setToggle("showLattice", false);
     */
    setToggle(name: string, value: boolean): void {
        const checkbox = this.togglesByName.get(name);
        if (checkbox) checkbox.checked = value;
    }

    // ── Init ─────────────────────────────────────────────────────────────

    private init(
        uniformsFn: UniformsFunction,
        selector: string,
        config: UniformUIConfig
    ): void {
        const container = document.querySelector(selector);
        if (!container) {
            console.warn(`UniformUI: selector "${selector}" not found`);
            return;
        }

        // Probe layout to discover registered entries
        const probe = new UniformLayout([800, 450]);
        uniformsFn(probe);
        probe.build();

        const skip    = new Set([...BUILTIN_SKIP, ...(config.skip ?? [])]);
        const entries = (probe as any).entries.filter((e: any) => !skip.has(e.name));

        // Separate slider entries from toggle entries
        const toggleNames  = new Set(Object.keys(config.toggles ?? {}));
        const sliderEntries = entries.filter((e: any) => !toggleNames.has(e.name));
        const toggleEntries = entries.filter((e: any) =>  toggleNames.has(e.name));

        if (sliderEntries.length === 0 && toggleEntries.length === 0) return;

        const panel = this.buildPanel(sliderEntries, toggleEntries, config);
        (container as HTMLElement).style.position = "relative";
        container.appendChild(panel);
    }

    // ── Panel ────────────────────────────────────────────────────────────

    private buildPanel(
        sliderEntries: any[],
        toggleEntries: any[],
        config: UniformUIConfig
    ): HTMLElement {
        const panel = document.createElement("div");
        panel.className = "ui-panel";

        const totalActive = sliderEntries.length + toggleEntries.length;

        // Header
        const header = document.createElement("div");
        header.className = "ui-header";
        header.innerHTML = `
            <span class="ui-title">uniforms</span>
            <span class="ui-badge">${totalActive} active</span>
        `;
        panel.appendChild(header);

        // Sliders
        sliderEntries.forEach((entry, i) => {
            panel.appendChild(this.buildUniformBlock(entry, config));
            if (i < sliderEntries.length - 1 || toggleEntries.length > 0) {
                const div = document.createElement("div");
                div.className = "ui-divider";
                panel.appendChild(div);
            }
        });

        // Toggles section
        if (toggleEntries.length > 0) {
            const section = document.createElement("div");
            section.className = "ui-toggle-section";

            const sectionLabel = document.createElement("div");
            sectionLabel.className = "ui-section-label";
            sectionLabel.textContent = "visibility";
            section.appendChild(sectionLabel);

            toggleEntries.forEach(entry => {
                const toggleCfg = config.toggles?.[entry.name] ?? {};
                section.appendChild(this.buildToggleRow(entry.name, toggleCfg));
            });

            panel.appendChild(section);
        }

        return panel;
    }

    // ── Per-uniform slider block ─────────────────────────────────────────

    private buildUniformBlock(entry: any, config: UniformUIConfig): HTMLElement {
        const wrap = document.createElement("div");

        const label = document.createElement("div");
        label.className = "ui-uniform-label";
        label.innerHTML = `
            <span class="ui-uniform-name">${entry.name}</span>
            <span class="ui-uniform-type">${entry.type}</span>
        `;
        wrap.appendChild(label);

        const dims  = UniformUI.dimsForType(entry.type);
        const range = config.ranges?.[entry.name]
            ?? DEFAULT_RANGES[entry.type]
            ?? DEFAULT_RANGES.f32;
        const init  = UniformUI.resolveInitial(entry);

        // Shared current[] — onChange always receives the full vector
        const current: number[] = dims === 1
            ? [(init as number)]
            : [...(Array.isArray(init) ? (init as number[]) : new Array(dims).fill(0))];

        for (let axis = 0; axis < dims; axis++) {
            wrap.appendChild(
                this.buildSliderRow(
                    entry.name,
                    axis,
                    dims,
                    current[axis],
                    range,
                    (ax, v) => {
                        current[ax] = v;
                        range.onChange?.(dims === 1 ? current[0] : [...current]);
                    }
                )
            );
        }

        return wrap;
    }

    // ── Slider row ───────────────────────────────────────────────────────

    private buildSliderRow(
        name: string,
        axis: number,
        dims: number,
        initVal: number,
        range: UniformUIRangeConfig,
        onAxisChange: (axis: number, value: number) => void
    ): HTMLElement {
        const axisKey = dims === 1 ? "s" : AXIS_LABELS[axis];

        const row = document.createElement("div");
        row.className = "ui-row";

        const axisLabel = document.createElement("span");
        axisLabel.className   = `ui-axis ui-axis-${axisKey}`;
        axisLabel.textContent = dims === 1 ? "·" : axisKey;
        row.appendChild(axisLabel);

        const slider = document.createElement("input");
        slider.type      = "range";
        slider.className = `ui-slider-${axisKey}`;
        slider.min       = String(range.min);
        slider.max       = String(range.max);
        slider.step      = String(range.step ?? 0.01);
        slider.value     = String(initVal);
        row.appendChild(slider);

        const valDisplay = document.createElement("span");
        valDisplay.className   = "ui-val";
        valDisplay.textContent = UniformUI.fmtVal(initVal, range.step);
        row.appendChild(valDisplay);

        // Register for setValues()
        if (!this.slidersByName.has(name))  this.slidersByName.set(name, []);
        if (!this.displaysByName.has(name)) this.displaysByName.set(name, []);
        this.slidersByName.get(name)!.push(slider);
        this.displaysByName.get(name)!.push(valDisplay);

        slider.addEventListener("input", () => {
            const v = parseFloat(slider.value);
            valDisplay.textContent = UniformUI.fmtVal(v, range.step);
            onAxisChange(axis, v);
        });

        return row;
    }

    // ── Toggle row ───────────────────────────────────────────────────────

    private buildToggleRow(name: string, cfg: UniformUIToggleConfig): HTMLElement {
        const row = document.createElement("div");
        row.className = "ui-toggle-row";

        const checkbox = document.createElement("input");
        checkbox.type    = "checkbox";
        checkbox.checked = cfg.default ?? true;
        checkbox.className = "ui-toggle-checkbox";
        row.appendChild(checkbox);

        const track = document.createElement("span");
        track.className = "ui-toggle-track";
        row.appendChild(track);

        const labelEl = document.createElement("span");
        labelEl.className   = "ui-toggle-label";
        labelEl.textContent = cfg.label ?? name;
        row.appendChild(labelEl);

        // Register for setToggle()
        this.togglesByName.set(name, checkbox);

        // Fire default onChange immediately to seed the uniform value
        cfg.onChange?.(checkbox.checked);

        checkbox.addEventListener("change", () => {
            cfg.onChange?.(checkbox.checked);
        });

        // Clicking the label row also toggles
        row.addEventListener("click", (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event("change"));
            }
        });

        return row;
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private static dimsForType(type: string): number {
        return ({ f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 } as any)[type] ?? 1;
    }

    private static resolveInitial(entry: any): number | number[] {
        if (typeof entry.value === "function") {
            try {
                const result = (entry.value as Function)(0, 0);
                if (result !== undefined && result !== null) return result;
            } catch (_) {}
        } else if (entry.value !== undefined) {
            return entry.value as number | number[];
        }
        return UniformUI.zeroForType(entry.type);
    }

    private static zeroForType(type: string): number | number[] {
        return ({ f32: 0, vec2f: [0,0], vec3f: [0,0,0], vec4f: [0,0,0,0] } as any)[type] ?? 0;
    }

    private static fmtVal(v: number, step?: number): string {
        return (step !== undefined && step >= 1) ? String(Math.round(v)) : v.toFixed(2);
    }
}