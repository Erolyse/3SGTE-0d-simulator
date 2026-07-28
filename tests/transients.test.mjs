import Engine from "../assets/simulator/engine/Engine.js";
import { DYNO_MODES } from "../assets/simulator/Dyno/Dyno.js";
import {
    ENGINE_OPERATING_STATES,
    REV_LIMITER_CUT_RPM,
    REV_LIMITER_RESUME_RPM
} from "../assets/simulator/EngineControl/EngineControl.js";
import {
    DEFAULT_TELEMETRY_CHANNELS
} from "../assets/simulator/Telemetry/TelemetryRecorder.js";

const DT = 0.004;
const BASE_ANGLE_STEP_DEG = 0.5;
const CHANNEL_KEYS = new Set([
    "rpm",
    "boost",
    "turboRPM",
    "wastegatePosition",
    "wastegateMassFlow",
    "compressorBypassValvePosition",
    "compressorBypassMassFlow",
    "revLimiterActive",
    "fuelCutActive",
    "instantFuelConsumptionLh",
    "torque",
    "maximumMassResidualPercent",
    "maximumEnergyResidualPercent"
]);
const CHANNELS = DEFAULT_TELEMETRY_CHANNELS.filter(channel =>
    CHANNEL_KEYS.has(channel.key)
);

const results = [];

function record(name, pass, measured, criterion) {
    results.push({ name, pass: Boolean(pass), measured, criterion });
    console.log(`${pass ? "PASS" : "FAIL"} ${name} · ${measured}`);
}

function createEngine() {
    const engine = new Engine({
        telemetryOptions: {
            outputRateHz: 30,
            inputRateHz: 2000,
            historySeconds: 30,
            channels: CHANNELS
        },
        cycleRecorderOptions: {
            enabled: false
        },
        conservationDiagnosticsStride: 16,
        angleSolverBaseStepDeg: BASE_ANGLE_STEP_DEG
    });

    engine.state.rpm = 0;
    engine.state.throttle = 0;
    engine.state.dynoMode = DYNO_MODES.INERTIA;
    engine.state.dynoRoadLoadEnabled = false;
    return engine;
}

function simulate(engine, seconds, beforeStep = null, afterStep = null) {
    for (let elapsed = 0; elapsed < seconds - 1e-12; elapsed += DT) {
        beforeStep?.(engine.state, elapsed);
        engine.update(DT);
        afterStep?.(engine.state, elapsed + DT);
    }
}

function startFreshEngine(engine) {
    engine.start();
    simulate(engine, 8, state => {
        state.throttle = 0;
    });
    if (engine.state.engineOperatingState
        !== ENGINE_OPERATING_STATES.RUNNING) {
        throw new Error("Le moteur de test n’a pas démarré.");
    }
    simulate(engine, 1, state => {
        state.throttle = 0;
    });
}

function cloneState(state) {
    return structuredClone(state);
}

function restoreState(engine, snapshot) {
    Object.assign(engine.state, cloneState(snapshot));
    engine.pendingSimulationTime = 0;
    engine.physicsSubstepSequence = 0;
    engine.setAngleResolution(BASE_ANGLE_STEP_DEG);
    engine.telemetry.clear({ resetTime: true });
    engine.cycleRecorder.clear();
}

function values(samples, key, minimumTime = -Infinity) {
    return samples
        .filter(sample => sample.time >= minimumTime)
        .map(sample => sample[key])
        .filter(Number.isFinite);
}

function maximum(samples, key) {
    const series = values(samples, key);
    return series.length ? Math.max(...series) : NaN;
}

function meanLast(samples, key, durationSeconds) {
    const lastTime = samples.at(-1)?.time;
    if (!Number.isFinite(lastTime)) return NaN;
    const series = values(samples, key, lastTime - durationSeconds);
    return series.length
        ? series.reduce((sum, value) => sum + value, 0) / series.length
        : NaN;
}

function crossing(samples, key, threshold, direction = "up") {
    const sample = samples.find(candidate => {
        const value = candidate[key];
        if (typeof value === "boolean") {
            return direction === "down" ? !value : value;
        }
        if (!Number.isFinite(value)) return false;
        return direction === "down"
            ? value <= threshold
            : value >= threshold;
    });
    return sample?.time ?? NaN;
}

const baseEngine = createEngine();
startFreshEngine(baseEngine);
const idleState = cloneState(baseEngine.state);

// Spool à 3 500 tr/min avec la même rampe que le tir déterministe.
const engine = createEngine();
restoreState(engine, idleState);
engine.state.rpm = 3500;
engine.state.dynoMode = DYNO_MODES.RPM_HOLD;
engine.state.dynoTargetRpm = 3500;
const spoolSamples = [];
engine.telemetry.subscribe(sample => spoolSamples.push(sample));
simulate(engine, 10, (state, elapsed) => {
    state.dynoMode = DYNO_MODES.RPM_HOLD;
    state.dynoTargetRpm = 3500;
    state.throttle = Math.min(1, elapsed / 1.25);
});

const boostStart = crossing(spoolSamples, "boost", 0.10);
const boostTarget = crossing(spoolSamples, "boost", 0.65);
const spoolRise = boostTarget - boostStart;
const spoolMaxBoost = maximum(spoolSamples, "boost");
const spoolMaxTurbo = maximum(spoolSamples, "turboRPM");
record("Spool atteint 0,65 bar", Number.isFinite(boostTarget), `${boostTarget.toFixed(3)} s`, "cible atteinte");
record("Commande vers 0,65 bar", boostTarget <= 10, `${boostTarget.toFixed(3)} s`, "≤ 10 s");
record("Montée 0,10 vers 0,65 bar", spoolRise <= 5, `${spoolRise.toFixed(3)} s`, "≤ 5 s");
record("Boost maximal pendant spool", spoolMaxBoost <= 1.10, `${spoolMaxBoost.toFixed(3)} bar`, "≤ 1,10 bar");
record("Régime turbo pendant spool", spoolMaxTurbo <= 185000, `${spoolMaxTurbo.toFixed(0)} tr/min`, "≤ 185 000 tr/min");

// Stabilisation à 4 000 tr/min, lever de pied puis reprise.
simulate(engine, 2, state => {
    state.dynoMode = DYNO_MODES.RPM_HOLD;
    state.dynoTargetRpm = 4000;
    state.throttle = 1;
});
const stable4000 = cloneState(engine.state);
engine.telemetry.clear({ resetTime: true });
const liftSamples = [];
const unsubscribeLift = engine.telemetry.subscribe(sample => liftSamples.push(sample));
simulate(engine, 2, state => {
    state.dynoMode = DYNO_MODES.RPM_HOLD;
    state.dynoTargetRpm = 4000;
    state.throttle = 0;
});
unsubscribeLift();

const bypassOpening = crossing(
    liftSamples,
    "compressorBypassValvePosition",
    0.80
);
const boostRelease = crossing(liftSamples, "boost", 0.10, "down");
const fuelCut = crossing(liftSamples, "fuelCutActive", true);
const finalFuel = meanLast(liftSamples, "instantFuelConsumptionLh", 0.5);
const finalTorque = meanLast(liftSamples, "torque", 0.5);
record("Ouverture bypass", bypassOpening <= 0.50, `${bypassOpening.toFixed(3)} s`, "≤ 0,50 s");
record("Décharge sous 0,10 bar", boostRelease <= 1.0, `${boostRelease.toFixed(3)} s`, "≤ 1,00 s");
record("Activation fuel cut", fuelCut <= 0.50, `${fuelCut.toFixed(3)} s`, "≤ 0,50 s");
record("Consommation après coupure", finalFuel <= 0.50, `${finalFuel.toFixed(4)} L/h`, "≤ 0,50 L/h");
record("Frein moteur", finalTorque < 0, `${finalTorque.toFixed(2)} N·m`, "couple négatif");

engine.telemetry.clear({ resetTime: true });
const recoverySamples = [];
const unsubscribeRecovery = engine.telemetry.subscribe(sample =>
    recoverySamples.push(sample)
);
simulate(engine, 3, (state, elapsed) => {
    state.dynoMode = DYNO_MODES.RPM_HOLD;
    state.dynoTargetRpm = 4000;
    state.throttle = Math.min(1, elapsed / 0.15);
});
unsubscribeRecovery();
const bypassClosing = crossing(
    recoverySamples,
    "compressorBypassValvePosition",
    0.10,
    "down"
);
const boostRecovery = crossing(recoverySamples, "boost", 0.50);
record("Fermeture bypass", bypassClosing <= 0.60, `${bypassClosing.toFixed(3)} s`, "≤ 0,60 s");
record("Récupération de 0,50 bar", boostRecovery <= 4.0, `${boostRecovery.toFixed(3)} s`, "≤ 4,00 s");
record("Pas d’overshoot à la reprise", maximum(recoverySamples, "boost") <= 1.10, `${maximum(recoverySamples, "boost").toFixed(3)} bar`, "≤ 1,10 bar");

// Wastegate : causalité sur la rampe 3 500 tr/min, puis capacité de
// régulation à fort débit sur un point 5 500 tr/min.
const firstSpoolWastegateSample = spoolSamples.find(sample =>
    Number.isFinite(sample.wastegatePosition)
    && Number.isFinite(sample.boost)
);
const initialWastegatePosition =
    firstSpoolWastegateSample?.wastegatePosition;
const boostCrack = crossing(spoolSamples, "boost", 0.65);
const wastegateOpening = crossing(
    spoolSamples,
    "wastegatePosition",
    0.05
);
const wastegateDelay = wastegateOpening - boostCrack;
record(
    "Wastegate initialement fermée",
    Number.isFinite(initialWastegatePosition)
        && initialWastegatePosition <= 0.01,
    Number.isFinite(initialWastegatePosition)
        ? `${(initialWastegatePosition * 100).toFixed(2)} %`
        : "indisponible",
    "≤ 1 %"
);
record(
    "Ordre causal boost puis wastegate",
    Number.isFinite(boostCrack)
        && Number.isFinite(wastegateOpening)
        && wastegateDelay >= 0,
    Number.isFinite(wastegateDelay)
        ? `${wastegateDelay.toFixed(3)} s`
        : "franchissements incomplets",
    "délai brut ≥ 0 s"
);
record(
    "Réponse wastegate causale",
    Number.isFinite(wastegateDelay)
        && wastegateDelay >= 0
        && wastegateDelay <= 0.50,
    Number.isFinite(wastegateDelay)
        ? `${wastegateDelay.toFixed(3)} s`
        : "indisponible",
    "0 à 0,50 s"
);

const wastegateEngine = createEngine();
restoreState(wastegateEngine, stable4000);
wastegateEngine.state.rpm = 5500;
wastegateEngine.state.dynoMode = DYNO_MODES.RPM_HOLD;
wastegateEngine.state.dynoTargetRpm = 5500;
const wastegateSamples = [];
wastegateEngine.telemetry.subscribe(sample => wastegateSamples.push(sample));
simulate(wastegateEngine, 5, state => {
    state.dynoMode = DYNO_MODES.RPM_HOLD;
    state.dynoTargetRpm = 5500;
    state.throttle = 1;
});
record("Wastegate ouverte à fort débit", maximum(wastegateSamples, "wastegatePosition") >= 0.05, `${maximum(wastegateSamples, "wastegatePosition").toFixed(3)}`, "≥ 0,05");
record("Débit wastegate positif", maximum(wastegateSamples, "wastegateMassFlow") >= 0.001, `${maximum(wastegateSamples, "wastegateMassFlow").toFixed(5)} kg/s`, "≥ 0,001 kg/s");
record("Boost régulé", maximum(wastegateSamples, "boost") <= 1.10, `${maximum(wastegateSamples, "boost").toFixed(3)} bar`, "≤ 1,10 bar");

// Rupteur : état haut régime, activation puis reprise par hystérésis.
const limiterEngine = createEngine();
restoreState(limiterEngine, wastegateEngine.state);
limiterEngine.state.rpm = REV_LIMITER_CUT_RPM + 25;
limiterEngine.state.dynoMode = DYNO_MODES.INERTIA;
limiterEngine.state.throttle = 1;
const initialEvents = limiterEngine.state.revLimiterEventCount;
let activationTime = NaN;
let injectionCutTime = NaN;
let resumeTime = NaN;
let maximumRpm = limiterEngine.state.rpm;
let previousLimiter = Boolean(limiterEngine.state.revLimiterActive);
simulate(limiterEngine, 4, state => {
    state.dynoMode = DYNO_MODES.INERTIA;
    state.throttle = 1;
}, (state, elapsed) => {
    maximumRpm = Math.max(maximumRpm, state.rpm);
    if (!Number.isFinite(activationTime) && state.revLimiterActive) {
        activationTime = elapsed;
    }
    if (!Number.isFinite(injectionCutTime)
        && Array.isArray(state.cylinderFuelEnabled)
        && state.cylinderFuelEnabled.every(enabled => !enabled)) {
        injectionCutTime = elapsed;
    }
    if (Number.isFinite(activationTime)
        && !Number.isFinite(resumeTime)
        && previousLimiter
        && !state.revLimiterActive) {
        resumeTime = elapsed;
    }
    previousLimiter = Boolean(state.revLimiterActive);
});
record("Activation rupteur", activationTime <= 0.10, `${activationTime.toFixed(3)} s`, "≤ 0,10 s");
record("Suppression injection au rupteur", injectionCutTime <= 0.10, `${injectionCutTime.toFixed(3)} s`, "≤ 0,10 s");
record("Reprise sous hystérésis", resumeTime <= 4.0, `${resumeTime.toFixed(3)} s`, `≤ 4,00 s et seuil ${REV_LIMITER_RESUME_RPM} tr/min`);
record("Régime maximal borné", maximumRpm <= 7300, `${maximumRpm.toFixed(0)} tr/min`, "≤ 7 300 tr/min");
record("Événement rupteur compté", limiterEngine.state.revLimiterEventCount - initialEvents >= 1, `${limiterEngine.state.revLimiterEventCount - initialEvents}`, "≥ 1");

const passed = results.filter(result => result.pass).length;
const failed = results.length - passed;
console.log(`RESULT ${passed}/${results.length} passed`);
if (failed > 0) process.exitCode = 1;
