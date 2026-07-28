// Boucle temps réel, interface utilisateur et pont d'analyse.
// La télémétrie est réduite dans Engine.js au niveau des sous-pas physiques.

import Engine from "./simulator/engine/Engine.js";
import { DYNO_MODES } from "./simulator/Dyno/Dyno.js";
import { ENGINE_OPERATING_STATES } from "./simulator/EngineControl/EngineControl.js";
import EngineViewer from "./simulator/Three/EngineViewer.js";
import {
    REALTIME_TELEMETRY_CHANNELS
} from "./simulator/Telemetry/TelemetryRecorder.js";
import installAnalysisSessionBridge from "./simulator/Analysis/AnalysisSessionBridge.js";

// Instanciation et configuration initiale

const motor = new Engine({
    telemetryOptions: {
        outputRateHz: 30,
        inputRateHz: 2000,
        historySeconds: 30,
        channels: REALTIME_TELEMETRY_CHANNELS
    },
    cycleRecorderOptions: {
        cylinderIndex: 0,
        historyCycles: 2,
        angularSampleStepDeg: 1,
        captureIntervalSeconds: 0.25,
        maximumSamplesPerCycle: 1000
    },
    conservationDiagnosticsStride: 32
});

motor.state.rpm = 0;
motor.state.throttle = 0;

motor.state.dynoMode = DYNO_MODES.INERTIA;
motor.state.dynoBrakeCommand = 0;
motor.state.dynoTargetRpm = 3000;
motor.state.dynoRoadLoadEnabled = false;

// Dernière fenêtre de télémétrie disponible pour l'affichage.
let latestTelemetrySample = null;

motor.telemetry.subscribe(sample => {
    latestTelemetrySample = sample;
});

window.engineTwin = {
    motor,
    telemetry: motor.telemetry,
    cycleRecorder: motor.cycleRecorder
};

const analysisSessionBridge = installAnalysisSessionBridge({ motor });
window.engineTwin.analysisSessionBridge = analysisSessionBridge;

// Paramètres de simulation

// Engine.update() possède déjà son intégrateur angulaire. La boucle externe
// lui fournit donc de petits blocs de quelques millisecondes au lieu de 10 000
// appels par seconde. Un budget CPU évite la spirale de rattrapage : si la
// machine est saturée, le temps simulé ralentit légèrement mais l'UI reste fluide.
const PHYSICS_CHUNK_SECONDS = 0.004;
const MAX_PHYSICS_CHUNKS_PER_FRAME = 8;
const MAX_PHYSICS_BUDGET_MS = 8.5;
const MAX_ACCUMULATED_SIMULATION_TIME = 0.05;
const THROTTLE_SPEED = 1.0;
const DASHBOARD_REFRESH_INTERVAL_MS = 150;
const THREE_REFRESH_INTERVAL_MS = 1000 / 30;
const MAX_DISPLAY_RPM = 7000;

let isHoldingGas = false;
let simulationAccumulator = 0;

// Interface DOM

const ui = {
    rpm: document.getElementById("rpm"),
    headerRpm: document.getElementById("headerRpm"),
    throttle: document.getElementById("throttle"),
    torque: document.getElementById("torque"),
    power: document.getElementById("power"),
    rpmBarFill: document.getElementById("rpmBarFill"),
    throttleBarFill: document.getElementById("throttleBarFill"),

    turboRpm: document.getElementById("turboRpm"),
    turboBoost: document.getElementById("turboBoost"),
    exhaustTemperature: document.getElementById("exhaustTemperature"),
    chargeAirTemperature: document.getElementById("chargeAirTemperature"),

    cylinderPressureSpread: document.getElementById("cylinderPressureSpread"),
    cylinderBalanceStatus: document.getElementById("cylinderBalanceStatus"),

    gasPedal: document.getElementById("gasPedal"),
    engineStartButton: document.getElementById("engineStartButton"),
    fullscreenButton: document.getElementById("engineViewerFullscreenButton"),
    fullscreenTarget: document.getElementById("engineViewerPanel"),

    engineStatus: document.getElementById("engineStatus"),
    engineStateIndicator: document.getElementById("engineStateIndicator"),
    revLimiterStatus: document.getElementById("revLimiterStatus"),
    dynoModeLabel: document.getElementById("dynoModeLabel")
};


const viewerCanvas = document.getElementById("engineViewerCanvas");

const engineViewer = viewerCanvas
    ? new EngineViewer({
        canvas: viewerCanvas,
        cycleRecorder: motor.cycleRecorder,

        // Un cycle visuel de 2 s reste lisible même lorsque le moteur réel
        // tourne à 6 000 tr/min (cycle physique de seulement 20 ms).
        defaultCycleDurationSeconds: 2,
        pixelRatioCap: 1.25,
        shadows: false
    })
    : null;

if (engineViewer) {
    // Cadrage de présentation : le mécanisme remplit le viewer sans rogner les
    // quatre cylindres. La scène reste manipulable à la souris.
    engineViewer.cameraRadius = 6.0;
    engineViewer.cameraTheta = 0.70;
    engineViewer.cameraPhi = 1.13;
    engineViewer.camera.fov = 34;
    engineViewer.camera.updateProjectionMatrix?.();

    engineViewer.engineModel?.scale?.setScalar?.(1.10);
    if (engineViewer.engineModel?.position) {
        engineViewer.engineModel.position.set(0, -0.03, 0);
    }

    // La traverse supérieure reste un repère structurel, mais ne doit plus
    // apparaître comme une grosse plaque claire dominant la maquette.
    const headReference = engineViewer.engineModel?.getObjectByName?.(
        "CylinderHeadReference"
    );
    if (headReference?.material) {
        headReference.material.color?.setHex?.(0x393740);
        headReference.material.metalness = 0.38;
        headReference.material.roughness = 0.58;
        headReference.scale.y = 0.62;
    }

    const baseReference = engineViewer.engineModel?.getObjectByName?.(
        "EngineBase"
    );
    if (baseReference?.material) {
        baseReference.material.color?.setHex?.(0x1b1a20);
        baseReference.material.metalness = 0.30;
        baseReference.material.roughness = 0.66;
    }

    engineViewer.scene?.background?.setHex?.(0x07060b);
    if (engineViewer.scene?.fog?.color) {
        engineViewer.scene.fog.color.setHex(0x07060b);
        engineViewer.scene.fog.near = 9;
        engineViewer.scene.fog.far = 19;
    }

    const rimLight = engineViewer.scene?.getObjectByName?.("ViewerRimLight");
    rimLight?.color?.setHex?.(0x8878b3);
    if (rimLight) {
        rimLight.intensity = 0.72;
    }

    const grid = engineViewer.scene?.getObjectByName?.("ViewerGrid");
    const gridMaterials = grid
        ? (Array.isArray(grid.material) ? grid.material : [grid.material])
        : [];
    for (const material of gridMaterials) {
        if (!material) continue;
        material.opacity = 0.17;
        material.transparent = true;
        material.color?.setHex?.(0x3d354d);
    }

    engineViewer.updateCameraPosition?.();
}

window.engineTwin.viewer = engineViewer;
window.engineTwin.performance = {
    physicsCostMs: 0,
    physicsChunksLastFrame: 0,
    physicsLagSeconds: 0,
    droppedSimulationSeconds: 0,
    telemetryRateHz: motor.telemetry.outputRateHz,
    telemetryInputRateHz: motor.telemetry.inputRateHz,
    threeTargetFps: 30
};

function setText(element, value) {
    if (element && element.textContent !== value) {
        element.textContent = value;
    }
}

function setProgress(element, ratio) {
    if (!element) {
        return;
    }

    const clampedRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const nextWidth = `${(clampedRatio * 100).toFixed(2)}%`;

    if (element.style.width !== nextWidth) {
        element.style.width = nextWidth;
    }
}

// Bis. Modules D'analyse Optionnels
// Les modules Chart.js sont chargés uniquement lorsque leurs canvas existent.
const chartsSection = document.querySelector(".simulation-charts");
const pvCanvas = document.getElementById("pvChart");

let simulationCharts = null;
let pvDiagram = null;

window.engineTwin.charts = null;

function telemetryValue(key, fallback) {
    const value = latestTelemetrySample?.[key];
    return value !== null && value !== undefined
        ? value
        : fallback;
}

async function initializeOptionalAnalysisModules() {
    if (chartsSection) {
        try {
            const { initializeSimulationCharts } = await import(
                "./simulator/Charts/SimulationCharts.js"
                );

            simulationCharts = initializeSimulationCharts({
                recorder: motor.telemetry,
                cycleRecorder: motor.cycleRecorder
            });
            simulationCharts?.setVisible?.(chartsVisible);
            window.engineTwin.charts = simulationCharts;
        } catch (error) {
            console.error(
                "Impossible d'initialiser les graphiques de simulation.",
                error
            );
        }
    }

    if (pvCanvas && typeof globalThis.Chart === "function") {
        try {
            const { default: PVDiagram } = await import(
                "./simulator/Charts/PVDiagram.js"
                );

            pvDiagram = new PVDiagram({
                chartCanvas: pvCanvas,
                cylinderSelect: document.getElementById("pvCylinderSelect"),
                freezeButton: document.getElementById("pvFreezeButton"),
                resumeButton: document.getElementById("pvResumeButton"),
                exportButton: document.getElementById("pvExportButton"),
                zoomButton: document.getElementById("pvZoomButton"),
                statusElement: document.getElementById("pvStatus"),
                rpmElement: document.getElementById("pvRpm"),
                boostElement: document.getElementById("pvBoost"),
                peakPressureElement: document.getElementById("pvPeakPressure"),
                workElement: document.getElementById("pvWork"),
                netImepElement: document.getElementById("pvNetImep"),
                grossImepElement: document.getElementById("pvGrossImep"),
                pmepElement: document.getElementById("pvPmep"),
                torqueElement: document.getElementById("pvTorque"),
                consistencyElement: document.getElementById("pvConsistency"),
                resolutionElement: document.getElementById("pvResolution"),
                cycleRecorder: motor.cycleRecorder,
                angularStepDeg: 1,
                chartRefreshIntervalMs: 300
            });
            pvDiagram?.setVisible?.(chartsVisible);
        } catch (error) {
            console.error(
                "Impossible d'initialiser le diagramme P-V.",
                error
            );
        }
    }
}

// Commandes utilisateur

function setGasControlActive(active) {
    isHoldingGas = Boolean(active);
    ui.gasPedal?.classList.toggle("is-active", isHoldingGas);
    ui.gasPedal?.setAttribute(
        "aria-pressed",
        isHoldingGas ? "true" : "false"
    );
}

function startGas(event) {
    event?.preventDefault();
    setGasControlActive(true);
}

function stopGas(event) {
    event?.preventDefault();
    setGasControlActive(false);
}

if (ui.gasPedal) {
    ui.gasPedal.addEventListener("pointerdown", startGas);
    ui.gasPedal.addEventListener("pointerup", stopGas);
    ui.gasPedal.addEventListener("pointercancel", stopGas);
    ui.gasPedal.addEventListener("pointerleave", stopGas);
}

const GAS_KEY = "Space";

function isTextInput(element) {
    return element instanceof HTMLInputElement
        || element instanceof HTMLTextAreaElement
        || element instanceof HTMLSelectElement
        || element?.isContentEditable;
}

function handleGasKeyDown(event) {
    if (event.code !== GAS_KEY || isTextInput(event.target)) {
        return;
    }

    // Empêche la barre d'espace de faire défiler la page
    event.preventDefault();

    setGasControlActive(true);
}

function handleGasKeyUp(event) {
    if (event.code !== GAS_KEY) {
        return;
    }

    event.preventDefault();

    setGasControlActive(false);
}

window.addEventListener("keydown", handleGasKeyDown);
window.addEventListener("keyup", handleGasKeyUp);

window.addEventListener("blur", () => {
    setGasControlActive(false);
});

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        setGasControlActive(false);
        simulationAccumulator = 0;
    }
});

if (ui.engineStartButton) {
    ui.engineStartButton.addEventListener("click", () => {
        motor.toggle();
    });
}


function syncFullscreenButton() {
    if (!ui.fullscreenButton) return;

    const active = document.fullscreenElement === ui.fullscreenTarget;
    setText(ui.fullscreenButton, active ? "Quitter plein écran" : "Plein écran");
    ui.fullscreenButton.setAttribute("aria-pressed", String(active));

    if (engineViewer) {
        engineViewer.resizeDirty = true;
    }
}

async function toggleViewerFullscreen() {
    if (!ui.fullscreenTarget || !ui.fullscreenButton) return;

    try {
        if (document.fullscreenElement === ui.fullscreenTarget) {
            await document.exitFullscreen?.();
        } else {
            await ui.fullscreenTarget.requestFullscreen?.();
        }
    } catch (error) {
        console.warn("Le mode plein écran n'est pas disponible.", error);
    }
}

ui.fullscreenButton?.addEventListener("click", toggleViewerFullscreen);
document.addEventListener("fullscreenchange", syncFullscreenButton);

// Libellés d'état

function getEngineStatusLabel(state) {
    switch (state.engineOperatingState) {
        case ENGINE_OPERATING_STATES.CRANKING:
            return state.combustionEnabled
                ? "Premières combustions"
                : "Démarreur";
        case ENGINE_OPERATING_STATES.RUNNING:
            return "En marche";
        case ENGINE_OPERATING_STATES.STOPPING:
            return "Arrêt en cours";
        case ENGINE_OPERATING_STATES.STALLED:
            return "Calé";
        case ENGINE_OPERATING_STATES.OFF:
        default:
            return "Arrêté";
    }
}

function getStartButtonLabel(state) {
    switch (state.engineOperatingState) {
        case ENGINE_OPERATING_STATES.CRANKING:
            return "Annuler le démarrage";
        case ENGINE_OPERATING_STATES.RUNNING:
            return "Arrêter le moteur";
        case ENGINE_OPERATING_STATES.STOPPING:
            return "Arrêt en cours";
        case ENGINE_OPERATING_STATES.STALLED:
            return "Redémarrer";
        case ENGINE_OPERATING_STATES.OFF:
        default:
            return "Démarrer le moteur";
    }
}

// Rafraîchissement du dashboard

const cylinderPeakPressuresBar = new Float64Array(4);

function getDynoModeLabel(mode) {
    switch (mode) {
        case DYNO_MODES.BRAKED:
            return "Freiné";
        case DYNO_MODES.RPM_HOLD:
            return "Régime régulé";
        case DYNO_MODES.INERTIA:
        default:
            return "Inertiel";
    }
}

function updateCylinderBalance() {
    for (let i = 0; i < cylinderPeakPressuresBar.length; i++) {
        const pressurePa = telemetryValue(
            `cylinderPressure${i + 1}Max`,
            motor.state.cylinderPressures[i]
        );
        cylinderPeakPressuresBar[i] = pressurePa / 100000;
    }

    let minimum = cylinderPeakPressuresBar[0];
    let maximum = cylinderPeakPressuresBar[0];

    for (let i = 1; i < cylinderPeakPressuresBar.length; i++) {
        minimum = Math.min(minimum, cylinderPeakPressuresBar[i]);
        maximum = Math.max(maximum, cylinderPeakPressuresBar[i]);
    }

    const spreadBar = Math.max(0, maximum - minimum);
    setText(ui.cylinderPressureSpread, `${spreadBar.toFixed(2)} bar`);

    let state = "nominal";
    let label = "Nominal";

    if (spreadBar > 0.75) {
        state = "critical";
        label = "Déséquilibre";
    } else if (spreadBar > 0.35) {
        state = "warning";
        label = "À surveiller";
    }

    setText(ui.cylinderBalanceStatus, label);
    if (ui.cylinderBalanceStatus) {
        ui.cylinderBalanceStatus.dataset.state = state;
    }
}

function updateDashboard() {
    const rpm = telemetryValue("rpm", motor.state.rpm);
    const throttle = telemetryValue("throttle", motor.state.throttle);
    const torque = telemetryValue("torque", motor.state.torque);
    const power = telemetryValue("power", motor.state.power);
    const turboRpm = telemetryValue("turboRPM", motor.state.turboRPM);
    const boost = telemetryValue("boost", motor.state.boost);
    const egtK = telemetryValue(
        "egtSensorTemperature",
        motor.state.egtSensorTemperature
    );
    const chargeAirTemperatureK = telemetryValue(
        "chargeAirTemperature",
        motor.state.chargeAirTemperature
    );

    const roundedRpm = Math.max(0, Math.round(rpm));
    const formattedRpm = `${roundedRpm.toLocaleString("fr-FR")} tr/min`;

    setText(ui.rpm, formattedRpm);
    setText(ui.headerRpm, formattedRpm);
    setText(ui.throttle, `${(throttle * 100).toFixed(0)} %`);
    setText(ui.torque, `${torque.toFixed(0)} N·m`);
    setText(ui.power, `${(power / 735.49875).toFixed(0)} ch`);
    setText(ui.turboBoost, `${boost.toFixed(2)} bar`);
    setText(ui.turboRpm, `${Math.round(turboRpm).toLocaleString("fr-FR")} tr/min`);
    setText(ui.exhaustTemperature, `${(egtK - 273.15).toFixed(0)} °C`);
    setText(
        ui.chargeAirTemperature,
        `${(chargeAirTemperatureK - 273.15).toFixed(0)} °C`
    );

    setProgress(ui.rpmBarFill, rpm / MAX_DISPLAY_RPM);
    setProgress(ui.throttleBarFill, throttle);
    updateCylinderBalance();

    const operatingState = motor.state.engineOperatingState
        ?? ENGINE_OPERATING_STATES.OFF;
    const engineStatus = getEngineStatusLabel(motor.state);

    setText(ui.engineStatus, engineStatus);
    setText(ui.dynoModeLabel, getDynoModeLabel(motor.state.dynoMode));

    if (ui.engineStateIndicator) {
        ui.engineStateIndicator.dataset.state = operatingState;
    }

    const revLimiterActive = Boolean(
        telemetryValue("revLimiterActive", motor.state.revLimiterActive)
    );
    setText(
        ui.revLimiterStatus,
        revLimiterActive ? "Limiteur actif" : "Limiteur libre"
    );
    ui.revLimiterStatus?.classList.toggle("is-active", revLimiterActive);

    if (ui.engineStartButton) {
        ui.engineStartButton.textContent = getStartButtonLabel(motor.state);
        ui.engineStartButton.dataset.state = operatingState;
        ui.engineStartButton.setAttribute(
            "aria-pressed",
            operatingState === ENGINE_OPERATING_STATES.RUNNING
                ? "true"
                : "false"
        );
        ui.engineStartButton.disabled = operatingState
            === ENGINE_OPERATING_STATES.STOPPING;
    }
}

// Boucle temps réel

let lastFrameTime = performance.now();
let lastDisplayTime = 0;
let lastThreeRenderTime = 0;
let viewerVisible = true;
let chartsVisible = Boolean(chartsSection);

function elementIsVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0
        && rect.top < window.innerHeight
        && rect.right > 0
        && rect.left < window.innerWidth;
}

function observeSectionVisibility(element, callback) {
    if (!element) {
        callback(false);
        return null;
    }

    callback(elementIsVisible(element));
    if (typeof IntersectionObserver !== "function") {
        return null;
    }

    const observer = new IntersectionObserver(entries => {
        callback(entries[0]?.isIntersecting === true);
    }, {
        rootMargin: "160px 0px",
        threshold: 0.01
    });
    observer.observe(element);
    return observer;
}

const viewerVisibilityObserver = observeSectionVisibility(
    document.querySelector(".engine-viewer-panel"),
    visible => {
        viewerVisible = visible;
    }
);

const chartsVisibilityObserver = observeSectionVisibility(
    chartsSection,
    visible => {
        chartsVisible = visible;
        simulationCharts?.setVisible?.(visible);
        pvDiagram?.setVisible?.(visible);
    }
);

initializeOptionalAnalysisModules();

function advancePhysics(deltaTime) {
    const requestedAccumulator = simulationAccumulator + deltaTime;
    if (requestedAccumulator > MAX_ACCUMULATED_SIMULATION_TIME) {
        window.engineTwin.performance.droppedSimulationSeconds +=
            requestedAccumulator - MAX_ACCUMULATED_SIMULATION_TIME;
    }
    simulationAccumulator = Math.min(
        requestedAccumulator,
        MAX_ACCUMULATED_SIMULATION_TIME
    );

    const budgetStart = performance.now();
    let chunkCount = 0;

    while (simulationAccumulator >= PHYSICS_CHUNK_SECONDS
    && chunkCount < MAX_PHYSICS_CHUNKS_PER_FRAME
    && performance.now() - budgetStart < MAX_PHYSICS_BUDGET_MS) {
        motor.update(PHYSICS_CHUNK_SECONDS);
        simulationAccumulator -= PHYSICS_CHUNK_SECONDS;
        chunkCount++;
    }

    // Le retard accumulé reste borné pour éviter une spirale de rattrapage.
    if (simulationAccumulator > MAX_ACCUMULATED_SIMULATION_TIME) {
        simulationAccumulator = MAX_ACCUMULATED_SIMULATION_TIME;
    }

    const stats = window.engineTwin.performance;
    stats.physicsCostMs = performance.now() - budgetStart;
    stats.physicsChunksLastFrame = chunkCount;
    stats.physicsLagSeconds = simulationAccumulator;
}

function animate(currentTime) {
    let deltaTime = (currentTime - lastFrameTime) / 1000;
    lastFrameTime = currentTime;
    deltaTime = Math.min(Math.max(deltaTime, 0), 0.05);

    if (isHoldingGas) {
        motor.state.throttle = Math.min(
            1,
            motor.state.throttle + THROTTLE_SPEED * deltaTime
        );
    } else {
        motor.state.throttle = Math.max(
            0,
            motor.state.throttle - THROTTLE_SPEED * deltaTime
        );
    }

    if (!document.hidden) {
        advancePhysics(deltaTime);
    }

    if (currentTime - lastDisplayTime
        >= DASHBOARD_REFRESH_INTERVAL_MS) {
        updateDashboard();
        lastDisplayTime = currentTime;
    }

    if (chartsVisible) {
        simulationCharts?.update(currentTime);
    }

    if (engineViewer && viewerVisible
        && currentTime - lastThreeRenderTime
        >= THREE_REFRESH_INTERVAL_MS) {
        const viewerDt = lastThreeRenderTime > 0
            ? Math.min((currentTime - lastThreeRenderTime) / 1000, 0.1)
            : deltaTime;
        lastThreeRenderTime = currentTime;

        engineViewer.updateFromEngineState(motor.state, viewerDt);
        engineViewer.render();
    }

    requestAnimationFrame(animate);
}

window.addEventListener("beforeunload", () => {
    analysisSessionBridge?.persist?.();
    analysisSessionBridge?.destroy?.();
    viewerVisibilityObserver?.disconnect();
    document.removeEventListener("fullscreenchange", syncFullscreenButton);
    chartsVisibilityObserver?.disconnect();
    engineViewer?.dispose?.();
    simulationCharts?.destroy?.();
    pvDiagram?.destroy?.();
}, { once: true });

requestAnimationFrame(animate);

// Export du moteur pour les modules d'analyse.
export { motor };
