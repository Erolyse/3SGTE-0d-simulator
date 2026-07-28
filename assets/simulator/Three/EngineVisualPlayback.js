// Contrôle le temps visuel du moteur Three.js.
// À 6 000 tr/min, un cycle quatre-temps de 720° ne dure que 20 ms.
// Une lecture directe de EngineState à 60 FPS est donc aliasée.
// Le mode ralenti rejoue le dernier cycle haute résolution du CycleRecorder.
// La physique, la télémétrie et les graphiques continuent à vitesse réelle.

import {
    CYLINDER_OFFSETS,
    getCylinderVolume,
    getPistonDisplacementFromTDC
} from "../Geometry/Geometry.js";

const FULL_CYCLE_DEG = 720;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const DEFAULT_VISUAL_CYCLE_DURATION_S = 2;
const SLOW_VISUAL_CYCLE_DURATION_S = 2;
const ULTRA_SLOW_VISUAL_CYCLE_DURATION_S = 10;
const MIN_VISUAL_CYCLE_DURATION_S = 0.25;
const MAX_VISUAL_CYCLE_DURATION_S = 20;
const DURATION_SLIDER_STEPS = 1000;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function normalizeAngle720(angleDeg) {
    return (
        (angleDeg % FULL_CYCLE_DEG)
        + FULL_CYCLE_DEG
    ) % FULL_CYCLE_DEG;
}

function interpolateNumber(a, b, ratio, fallback = 0) {
    const first = finite(a, fallback);
    const second = finite(b, first);
    return first + (second - first) * ratio;
}

/**
 * Recherche les deux échantillons angulaires encadrant l'angle demandé.
 * Le CycleRecorder fournit des points triés de 0° à 720°.
 */
function getCycleSamplePair(cycle, angleDeg) {
    const samples = cycle?.samples;
    if (!Array.isArray(samples) || samples.length === 0) {
        return null;
    }

    const target = normalizeAngle720(angleDeg);
    const first = samples[0];
    const last = samples[samples.length - 1];

    const fixedStep = finite(cycle?.angularStepDeg, 0);
    if (fixedStep > 0 && samples.length >= 2) {
        const position = target / fixedStep;
        const lowerIndex = clamp(Math.floor(position), 0, samples.length - 1);
        const upperIndex = clamp(lowerIndex + 1, 0, samples.length - 1);
        const lowerSample = samples[lowerIndex];
        const upperSample = samples[upperIndex];
        const lowerAngle = finite(lowerSample?.angleDeg, lowerIndex * fixedStep);
        const upperAngle = finite(upperSample?.angleDeg, lowerAngle);
        const span = Math.max(upperAngle - lowerAngle, 1e-9);
        return {
            first: lowerSample,
            second: upperSample,
            ratio: clamp((target - lowerAngle) / span, 0, 1)
        };
    }

    if (target <= finite(first.angleDeg)) {
        return { first, second: first, ratio: 0 };
    }

    if (target >= finite(last.angleDeg, FULL_CYCLE_DEG)) {
        return { first: last, second: last, ratio: 0 };
    }

    let low = 0;
    let high = samples.length - 1;

    while (high - low > 1) {
        const middle = (low + high) >> 1;

        if (finite(samples[middle].angleDeg) <= target) {
            low = middle;
        } else {
            high = middle;
        }
    }

    const lowerSample = samples[low];
    const upperSample = samples[high];
    const lowerAngle = finite(lowerSample.angleDeg);
    const upperAngle = finite(upperSample.angleDeg, lowerAngle);
    const span = Math.max(upperAngle - lowerAngle, 1e-9);

    return {
        first: lowerSample,
        second: upperSample,
        ratio: clamp((target - lowerAngle) / span, 0, 1)
    };
}

function interpolateCycleField(pair, field, fallback = 0) {
    if (!pair) {
        return fallback;
    }

    return interpolateNumber(
        pair.first?.[field],
        pair.second?.[field],
        pair.ratio,
        fallback
    );
}

function durationToSliderValue(durationSeconds) {
    const duration = clamp(
        durationSeconds,
        MIN_VISUAL_CYCLE_DURATION_S,
        MAX_VISUAL_CYCLE_DURATION_S
    );
    const logarithmicRange = Math.log(
        MAX_VISUAL_CYCLE_DURATION_S
        / MIN_VISUAL_CYCLE_DURATION_S
    );
    const normalized = Math.log(
        duration / MIN_VISUAL_CYCLE_DURATION_S
    ) / logarithmicRange;

    return Math.round(normalized * DURATION_SLIDER_STEPS);
}

function sliderValueToDuration(sliderValue) {
    const normalized = clamp(
        finite(Number(sliderValue)) / DURATION_SLIDER_STEPS,
        0,
        1
    );

    return MIN_VISUAL_CYCLE_DURATION_S * Math.pow(
        MAX_VISUAL_CYCLE_DURATION_S
        / MIN_VISUAL_CYCLE_DURATION_S,
        normalized
    );
}

function formatDuration(durationSeconds) {
    if (durationSeconds < 1) {
        return `${Math.round(durationSeconds * 1000)} ms`;
    }

    return `${durationSeconds.toFixed(durationSeconds < 10 ? 1 : 0)} s`;
}

function formatSlowdownRatio(physicalCycleDuration, visualCycleDuration) {
    if (!(physicalCycleDuration > 0) || !(visualCycleDuration > 0)) {
        return "";
    }

    const visualSpeedFactor = physicalCycleDuration / visualCycleDuration;
    if (visualSpeedFactor >= 0.995) {
        return "temps réel";
    }

    const divisor = Math.max(1, Math.round(1 / visualSpeedFactor));
    return `1/${divisor}×`;
}

function setText(element, value) {
    if (element && element.textContent !== value) {
        element.textContent = value;
    }
}

/**
 * Produit l'état lu par le modèle Three.js.
 *
 * En mode live, l'objet EngineState original est retourné.
 * En mode replay, un état visuel temporaire est construit par interpolation
 * du dernier cycle 720°. Aucun champ du moteur physique n'est modifié.
 */
export default class EngineVisualPlayback {
    constructor({
                    canvas,
                    cycleRecorder = null,
                    defaultCycleDurationSeconds = DEFAULT_VISUAL_CYCLE_DURATION_S
                }) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError(
                "EngineVisualPlayback nécessite un canvas Three.js valide."
            );
        }

        this.canvas = canvas;
        this.cycleRecorder = cycleRecorder;
        this.disposed = false;

        // Une interface minimale est créée si les contrôles externes sont absents.
        this.controlsOwnedByPlayback = false;
        this.controlListeners = [];

        // Le viewer démarre en mode lisible. Le bouton "Temps réel"
        // permet de revenir instantanément à EngineState brut.
        this.mode = "replay";
        this.paused = false;
        this.visualCycleDurationSeconds = clamp(
            finite(
                defaultCycleDurationSeconds,
                DEFAULT_VISUAL_CYCLE_DURATION_S
            ),
            MIN_VISUAL_CYCLE_DURATION_S,
            MAX_VISUAL_CYCLE_DURATION_S
        );

        // Angle global du vilebrequin utilisé uniquement par Three.js.
        this.visualCrankAngleDeg = null;
        this.lastEngineState = null;
        this.controlsDirty = true;
        this.lastControlsUpdateTime = 0;

        const cylinderCount = CYLINDER_OFFSETS.length;
        this.replayState = {
            crankAngle: 0,
            rpm: 0,
            throttle: 0,
            boost: 0,
            turboRPM: 0,
            pistonPositions: new Array(cylinderCount).fill(0),
            cylinderVolumes: new Array(cylinderCount).fill(0),
            cylinderPressures: new Array(cylinderCount).fill(101325),
            cylinderTemperatures: new Array(cylinderCount).fill(293),
            cylinderBurnedFraction: new Array(cylinderCount).fill(0),
            cylinderHeatReleaseRate: new Array(cylinderCount).fill(0),
            intakeValveLift: new Array(cylinderCount).fill(0),
            exhaustValveLift: new Array(cylinderCount).fill(0),
            intakeValveMassFlow: new Array(cylinderCount).fill(0),
            exhaustValveMassFlow: new Array(cylinderCount).fill(0)
        };

        // pendingCycle reçoit les cycles physiques récents.
        // playbackCycle reste figé pendant une relecture complète pour éviter
        // de changer de conditions thermodynamiques au milieu des 720°.
        this.pendingCycle = cycleRecorder?.getLatestCycle?.() ?? null;
        this.playbackCycle = this.pendingCycle;

        this.unsubscribeCycleRecorder = cycleRecorder?.subscribe?.(cycle => {
            this.pendingCycle = cycle;
            this.controlsDirty = true;

            if (!this.playbackCycle) {
                this.playbackCycle = cycle;
            }
        }) ?? null;

        this.createControls();
    }

    // API publique

    update(liveState, renderDt) {
        if (this.disposed || !liveState) {
            return liveState;
        }

        this.lastEngineState = liveState;

        const safeRenderDt = clamp(
            finite(renderDt),
            0,
            0.1
        );

        if (this.mode === "live" && !this.paused) {
            this.maybeUpdateControls();
            return liveState;
        }

        this.advanceReplayAngle(safeRenderDt);

        const replayState = this.createReplayState(liveState);
        this.maybeUpdateControls();

        return replayState;
    }

    setLive() {
        this.mode = "live";
        this.paused = false;
        this.visualCrankAngleDeg = null;
        this.controlsDirty = true;
        this.maybeUpdateControls(true);
    }

    setCycleDuration(durationSeconds, { preservePause = false } = {}) {
        const wasLive = this.mode === "live";

        this.mode = "replay";
        this.visualCycleDurationSeconds = clamp(
            finite(durationSeconds, DEFAULT_VISUAL_CYCLE_DURATION_S),
            MIN_VISUAL_CYCLE_DURATION_S,
            MAX_VISUAL_CYCLE_DURATION_S
        );

        if (!preservePause || wasLive) {
            this.paused = false;
        }

        this.initializeVisualCrankAngle();
        this.playbackCycle = this.pendingCycle ?? this.playbackCycle;
        this.controlsDirty = true;
        this.maybeUpdateControls(true);
    }

    togglePause() {
        if (this.mode === "live") {
            this.mode = "replay";
            this.initializeVisualCrankAngle();
            this.playbackCycle = this.pendingCycle ?? this.playbackCycle;
            this.paused = true;
        } else {
            this.paused = !this.paused;
        }

        this.controlsDirty = true;
        this.maybeUpdateControls(true);
    }

    getStatus() {
        return {
            mode: this.mode,
            paused: this.paused,
            cycleDurationSeconds: this.visualCycleDurationSeconds,
            visualCrankAngleDeg: this.visualCrankAngleDeg,
            cycleSequence:
                (this.playbackCycle ?? this.pendingCycle)?.sequence ?? null
        };
    }

    dispose() {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.unsubscribeCycleRecorder?.();

        for (const {
            element,
            eventName,
            handler
        } of this.controlListeners) {
            element.removeEventListener(eventName, handler);
        }
        this.controlListeners.length = 0;

        if (this.controlsOwnedByPlayback) {
            this.controlsRoot?.remove();
        }
    }

    // Horloge visuelle et état rejoué

    initializeVisualCrankAngle() {
        if (Number.isFinite(this.visualCrankAngleDeg)) {
            return;
        }

        this.visualCrankAngleDeg = normalizeAngle720(
            finite(this.lastEngineState?.crankAngle) * RAD_TO_DEG
        );
    }

    advanceReplayAngle(renderDt) {
        this.initializeVisualCrankAngle();

        if (this.paused) {
            return;
        }

        const cycle = this.playbackCycle ?? this.pendingCycle;
        const sourceRpm = finite(
            cycle?.summary?.meanRpm,
            finite(this.lastEngineState?.rpm)
        );

        // Pas de mouvement artificiel avant le premier démarrage.
        if (sourceRpm < 1 && !cycle) {
            return;
        }

        const previousAngle = this.visualCrankAngleDeg;
        const degreesPerSecond = FULL_CYCLE_DEG
            / this.visualCycleDurationSeconds;

        this.visualCrankAngleDeg = normalizeAngle720(
            previousAngle + degreesPerSecond * renderDt
        );

        // Le nouveau cycle physique n'est adopté qu'à la frontière visuelle
        // entre 720° et 0°, ce qui conserve une relecture cohérente.
        const wrapped = this.visualCrankAngleDeg < previousAngle;
        if (wrapped && this.pendingCycle) {
            this.playbackCycle = this.pendingCycle;
        }
    }

    createReplayState(liveState) {
        const cycle = this.playbackCycle ?? this.pendingCycle;
        const globalCrankAngleDeg = normalizeAngle720(
            finite(this.visualCrankAngleDeg)
        );
        const replayState = this.replayState;
        const cylinderCount = CYLINDER_OFFSETS.length;

        replayState.crankAngle = globalCrankAngleDeg * DEG_TO_RAD;
        replayState.throttle = finite(liveState.throttle);
        replayState.boost = finite(liveState.boost);
        replayState.turboRPM = finite(liveState.turboRPM);

        for (let i = 0; i < cylinderCount; i++) {
            const localAngleDeg = normalizeAngle720(
                globalCrankAngleDeg
                + finite(CYLINDER_OFFSETS[i]) * RAD_TO_DEG
            );
            const localAngleRad = localAngleDeg * DEG_TO_RAD;
            const pair = getCycleSamplePair(cycle, localAngleDeg);

            replayState.pistonPositions[i]
                = getPistonDisplacementFromTDC(localAngleRad);
            replayState.cylinderVolumes[i] = pair
                ? interpolateCycleField(
                    pair,
                    "cylinderVolumeM3",
                    getCylinderVolume(localAngleRad)
                )
                : getCylinderVolume(localAngleRad);
            replayState.cylinderPressures[i] = interpolateCycleField(
                pair,
                "cylinderPressurePa",
                finite(liveState.cylinderPressures?.[i], 101325)
            );
            replayState.cylinderTemperatures[i] = interpolateCycleField(
                pair,
                "cylinderTemperatureK",
                finite(liveState.cylinderTemperatures?.[i], 293)
            );
            replayState.cylinderBurnedFraction[i] = interpolateCycleField(
                pair,
                "burnedFraction",
                0
            );
            replayState.cylinderHeatReleaseRate[i] = interpolateCycleField(
                pair,
                "heatReleaseRateW",
                0
            );
            replayState.intakeValveLift[i] = interpolateCycleField(
                pair,
                "intakeValveLiftM",
                0
            );
            replayState.exhaustValveLift[i] = interpolateCycleField(
                pair,
                "exhaustValveLiftM",
                0
            );
            replayState.intakeValveMassFlow[i] = interpolateCycleField(
                pair,
                "intakeValveMassFlowKgS",
                0
            );
            replayState.exhaustValveMassFlow[i] = interpolateCycleField(
                pair,
                "exhaustValveMassFlowKgS",
                0
            );
        }

        replayState.rpm = finite(
            cycle?.summary?.meanRpm,
            finite(liveState.rpm)
        );
        return replayState;
    }

    // Interface DOM

    addControlListener(element, eventName, handler) {
        if (!element) {
            return;
        }

        element.addEventListener(eventName, handler);
        this.controlListeners.push({
            element,
            eventName,
            handler
        });
    }

    bindFrontControls() {
        const root = document.getElementById(
            "engineViewerPlaybackControls"
        );
        const liveButton = document.getElementById(
            "engineViewerLiveButton"
        );
        const slowButton = document.getElementById(
            "engineViewerSlowButton"
        );
        const ultraButton = document.getElementById(
            "engineViewerUltraButton"
        );
        const pauseButton = document.getElementById(
            "engineViewerPauseButton"
        );
        const durationSlider = document.getElementById(
            "engineViewerDurationSlider"
        );

        if (
            !root
            || !liveButton
            || !slowButton
            || !ultraButton
            || !pauseButton
            || !(durationSlider instanceof HTMLInputElement)
        ) {
            return false;
        }

        this.controlsRoot = root;
        this.controlsOwnedByPlayback = false;

        this.readout = document.getElementById(
            "engineViewerModeReadout"
        );
        this.durationValueElement = document.getElementById(
            "engineViewerDurationValue"
        );
        this.statusElement = document.getElementById(
            "engineViewerPlaybackStatus"
        );
        this.headerModeElement = document.getElementById(
            "engineViewerHeaderMode"
        );

        this.liveButton = liveButton;
        this.slowButton = slowButton;
        this.ultraButton = ultraButton;
        this.pauseButton = pauseButton;
        this.durationSlider = durationSlider;

        this.configureDurationSlider();

        this.addControlListener(
            this.liveButton,
            "click",
            () => this.setLive()
        );
        this.addControlListener(
            this.slowButton,
            "click",
            () => this.setCycleDuration(
                SLOW_VISUAL_CYCLE_DURATION_S
            )
        );
        this.addControlListener(
            this.ultraButton,
            "click",
            () => this.setCycleDuration(
                ULTRA_SLOW_VISUAL_CYCLE_DURATION_S
            )
        );
        this.addControlListener(
            this.pauseButton,
            "click",
            () => this.togglePause()
        );
        this.addControlListener(
            this.durationSlider,
            "input",
            event => {
                const duration = sliderValueToDuration(
                    event.currentTarget.value
                );

                this.setCycleDuration(duration, {
                    preservePause: true
                });
            }
        );

        return true;
    }

    configureDurationSlider() {
        this.durationSlider.min = "0";
        this.durationSlider.max = String(DURATION_SLIDER_STEPS);
        this.durationSlider.step = "1";
        this.durationSlider.value = String(
            durationToSliderValue(this.visualCycleDurationSeconds)
        );
        this.durationSlider.setAttribute(
            "aria-label",
            "Durée visuelle d’un cycle moteur de 720 degrés"
        );
    }

    createControls() {
        if (this.bindFrontControls()) {
            this.controlsDirty = true;
            this.maybeUpdateControls(true);
            return;
        }

        // Interface de secours lorsque les contrôles externes sont absents.
        this.installStyles();

        const root = document.createElement("section");
        root.className = "engine-viewer-playback";
        root.setAttribute("aria-label", "Contrôles du ralenti Three.js");

        const header = document.createElement("div");
        header.className = "engine-viewer-playback__header";

        const title = document.createElement("strong");
        title.textContent = "Ralenti visuel Three.js";

        this.readout = document.createElement("span");
        this.readout.className = "engine-viewer-playback__readout";

        header.append(title, this.readout);

        const buttonRow = document.createElement("div");
        buttonRow.className = "engine-viewer-playback__buttons";

        const createButton = (label, onClick) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            this.addControlListener(button, "click", onClick);
            buttonRow.appendChild(button);
            return button;
        };

        this.liveButton = createButton(
            "Temps réel",
            () => this.setLive()
        );
        this.slowButton = createButton(
            "Ralenti",
            () => this.setCycleDuration(
                SLOW_VISUAL_CYCLE_DURATION_S
            )
        );
        this.ultraButton = createButton(
            "Ultra",
            () => this.setCycleDuration(
                ULTRA_SLOW_VISUAL_CYCLE_DURATION_S
            )
        );
        this.pauseButton = createButton(
            "Pause",
            () => this.togglePause()
        );

        const sliderRow = document.createElement("label");
        sliderRow.className = "engine-viewer-playback__slider";

        const sliderLabel = document.createElement("span");
        sliderLabel.textContent = "Durée d’un cycle 720°";

        this.durationSlider = document.createElement("input");
        this.durationSlider.type = "range";
        this.configureDurationSlider();
        this.addControlListener(
            this.durationSlider,
            "input",
            event => {
                const duration = sliderValueToDuration(
                    event.currentTarget.value
                );

                this.setCycleDuration(duration, {
                    preservePause: true
                });
            }
        );

        sliderRow.append(sliderLabel, this.durationSlider);

        this.statusElement = document.createElement("small");
        this.statusElement.className = "engine-viewer-playback__status";

        root.append(
            header,
            buttonRow,
            sliderRow,
            this.statusElement
        );

        this.canvas.insertAdjacentElement("afterend", root);
        this.controlsRoot = root;
        this.controlsOwnedByPlayback = true;
        this.controlsDirty = true;
        this.maybeUpdateControls(true);
    }

    maybeUpdateControls(force = false) {
        const now = performance.now();
        if (!force && !this.controlsDirty
            && now - this.lastControlsUpdateTime < 250) {
            return;
        }
        this.updateControls();
        this.controlsDirty = false;
        this.lastControlsUpdateTime = now;
    }

    updateControls() {
        if (!this.controlsRoot) {
            return;
        }

        const isLive = this.mode === "live";
        const cycle = this.playbackCycle ?? this.pendingCycle;
        const sourceRpm = finite(
            cycle?.summary?.meanRpm,
            finite(this.lastEngineState?.rpm)
        );
        const physicalCycleDuration = sourceRpm > 0
            ? 120 / sourceRpm
            : 0;
        const ratioLabel = formatSlowdownRatio(
            physicalCycleDuration,
            this.visualCycleDurationSeconds
        );

        if (isLive) {
            setText(this.readout, "temps réel");
        } else {
            const ratioSuffix = ratioLabel ? ` • ${ratioLabel}` : "";
            const pauseSuffix = this.paused ? " • pause" : "";

            setText(
                this.readout,
                `${formatDuration(this.visualCycleDurationSeconds)} / cycle`
                + ratioSuffix
                + pauseSuffix
            );
        }

        this.liveButton.dataset.active = String(isLive);
        this.liveButton.setAttribute("aria-pressed", String(isLive));

        const slowActive = !isLive
            && Math.abs(
                this.visualCycleDurationSeconds
                - SLOW_VISUAL_CYCLE_DURATION_S
            ) < 0.01;
        this.slowButton.dataset.active = String(slowActive);
        this.slowButton.setAttribute("aria-pressed", String(slowActive));

        const ultraActive = !isLive
            && Math.abs(
                this.visualCycleDurationSeconds
                - ULTRA_SLOW_VISUAL_CYCLE_DURATION_S
            ) < 0.01;
        this.ultraButton.dataset.active = String(ultraActive);
        this.ultraButton.setAttribute("aria-pressed", String(ultraActive));

        this.pauseButton.dataset.active = String(this.paused);
        this.pauseButton.setAttribute("aria-pressed", String(this.paused));
        setText(this.pauseButton, this.paused ? "Reprendre" : "Pause");

        const sliderValue = String(
            durationToSliderValue(this.visualCycleDurationSeconds)
        );
        if (this.durationSlider.value !== sliderValue) {
            this.durationSlider.value = sliderValue;
        }

        setText(
            this.durationValueElement,
            formatDuration(this.visualCycleDurationSeconds)
        );

        if (this.headerModeElement) {
            let headerMode = "Visuel ralenti — physique temps réel";

            if (isLive) {
                headerMode = "Visuel temps réel — physique temps réel";
            } else if (this.paused) {
                headerMode = "Visuel en pause — physique temps réel";
            } else if (ultraActive) {
                headerMode = "Visuel ultra ralenti — physique temps réel";
            }

            setText(this.headerModeElement, headerMode);
        }

        if (cycle?.samples?.length) {
            const sequence = Number.isFinite(cycle.sequence)
                ? ` #${cycle.sequence}`
                : "";

            setText(
                this.statusElement,
                `Relecture du cycle${sequence}`
                + ` • ${cycle.samples.length} échantillons angulaires`
                + ` • source ${Math.round(sourceRpm)} tr/min`
            );
        } else {
            setText(
                this.statusElement,
                "Cinématique lissée active — phénomènes physiques en attente "
                + "du premier cycle 720° enregistré."
            );
        }
    }

    installStyles() {
        const styleId = "engine-viewer-playback-styles";
        if (document.getElementById(styleId)) {
            return;
        }

        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
            .engine-viewer-playback {
                display: grid;
                gap: 0.65rem;
                margin-top: 0.65rem;
                padding: 0.85rem;
                border: 1px solid rgba(126, 170, 205, 0.24);
                border-radius: 0.75rem;
                background: rgba(5, 11, 16, 0.88);
                color: #eaf3f8;
                font: 500 0.82rem/1.35 system-ui, sans-serif;
            }

            .engine-viewer-playback__header,
            .engine-viewer-playback__slider {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.75rem;
            }

            .engine-viewer-playback__readout {
                color: #8fd5ff;
                font-variant-numeric: tabular-nums;
                text-align: right;
            }

            .engine-viewer-playback__buttons {
                display: flex;
                flex-wrap: wrap;
                gap: 0.45rem;
            }

            .engine-viewer-playback button {
                padding: 0.42rem 0.65rem;
                border: 1px solid rgba(143, 213, 255, 0.28);
                border-radius: 0.45rem;
                background: #111d25;
                color: inherit;
                cursor: pointer;
            }

            .engine-viewer-playback button:hover {
                background: #172a36;
            }

            .engine-viewer-playback button[data-active="true"] {
                border-color: #63c7ff;
                background: #16384a;
                color: #ffffff;
            }

            .engine-viewer-playback__slider {
                align-items: flex-start;
                flex-direction: column;
            }

            .engine-viewer-playback__slider input {
                width: 100%;
                accent-color: #63c7ff;
            }

            .engine-viewer-playback__status {
                color: #91a5b2;
                min-height: 1.35em;
            }
        `;

        document.head.appendChild(style);
    }
}
