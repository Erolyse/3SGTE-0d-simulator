// Banc stabilisé de calibration physique.
// Contrairement à un tir inertiel, chaque point est maintenu à régime fixe.
// Cela sépare la forme stationnaire du moteur des effets transitoires de spool,
// de l'inertie du banc et de la température des volumes.
// Usage :
//   node Diagnostics/PhysicalCalibrationSweep.mjs
//   node Diagnostics/PhysicalCalibrationSweep.mjs 0.0001 5 1
// Arguments :
//   1. pas externe envoyé à Engine.update() ;
//   2. durée de stabilisation par point en secondes ;
//   3. durée de moyenne par point en secondes.

import Engine from "../engine/Engine.js";
import {
    ENGINE_OPERATING_STATES
} from "../EngineControl/EngineControl.js";
import { DYNO_MODES } from "../Dyno/Dyno.js";

const externalTimeStep = Number(process.argv[2] || 0.0001);
const settlingDuration = Number(process.argv[3] || 5.0);
const averagingDuration = Number(process.argv[4] || 1.0);

const targetSpeeds = [
    2000,
    2500,
    3000,
    3500,
    4000,
    4500,
    5000,
    5500,
    6000,
    6500,
    6800
];

const engine = new Engine({
    telemetryOptions: {
        outputRateHz: 10,
        historySeconds: 5
    }
});

Object.assign(engine.state, {
    engineOperatingState: ENGINE_OPERATING_STATES.RUNNING,
    engineRunning: true,
    ignitionOn: true,
    combustionEnabled: true,
    starterActive: false,
    throttle: 1,
    rpm: targetSpeeds[0],
    dynoMode: DYNO_MODES.RPM_HOLD,
    dynoTargetRpm: targetSpeeds[0],
    dynoRoadLoadEnabled: false,
    dynoCoastdownBrakeEnabled: false,
    dynoCouplingFactor: 1,
    runningElapsedTime: 10
});

const fields = [
    "rpm",
    "boost",
    "torque",
    "power",
    "closedCycleIndicatedTorque",
    "pumpingTorque",
    "mechanicalLossTorque",
    "accessoryTorque",
    "intakePressure",
    "intakeTemperature",
    "exhaustBackPressure",
    "turboRPM",
    "turbinePower",
    "compressorPower",
    "wastegatePosition",
    "freshCylinderAirMassFlow",
    "intakeReversionMassFlow",
    "compressorMassFlow",
    "compressorCorrectedMassFlow",
    "compressorEfficiency",
    "compressorPressureRatio",
    "compressorRawPressureRatioCapability",
    "compressorChokeFraction",
    "compressorTipMach",
    "compressorTipMachLossFraction",
    "combustionDurationDeg",
    "combustionCA50DegAfterTdc",
    "ignitionTimingDeg",
    "combustionPhasingIgnitionLimitDeg",
    "intakeValveDischargeCoefficient",
    "exhaustValveDischargeCoefficient",
    "maximumMassResidualPercent",
    "maximumEnergyResidualPercent"
];

function forceOperatingPoint(targetRpm) {
    engine.state.rpm = targetRpm;
    engine.state.throttle = 1;
    engine.state.dynoTargetRpm = targetRpm;
}

function advanceAtFixedSpeed(targetRpm, durationSeconds, collect = false) {
    const stepCount = Math.ceil(durationSeconds / externalTimeStep);
    const sums = Object.fromEntries(fields.map(field => [field, 0]));
    let collectedSteps = 0;

    for (let step = 0; step < stepCount; step++) {
        // Le RPM est imposé uniquement par le banc de diagnostic. Tous les
        // débits, pressions, températures et couples restent calculés par les
        // modules physiques normaux.
        forceOperatingPoint(targetRpm);
        engine.update(externalTimeStep);
        forceOperatingPoint(targetRpm);

        if (!collect) {
            continue;
        }

        for (const field of fields) {
            const value = engine.state[field];
            sums[field] += Number.isFinite(value) ? value : 0;
        }
        collectedSteps++;
    }

    if (!collect) {
        return null;
    }

    const result = { targetRpm };
    for (const field of fields) {
        result[field] = sums[field] / Math.max(collectedSteps, 1);
    }

    result.powerHp = result.power / 745.7;
    result.mapBarAbsolute = result.intakePressure / 100000;
    result.emapBarAbsolute = result.exhaustBackPressure / 100000;
    result.intakeTemperatureC = result.intakeTemperature - 273.15;
    result.freshAirFlowGps = result.freshCylinderAirMassFlow * 1000;
    result.intakeReversionGps = result.intakeReversionMassFlow * 1000;
    result.compressorCorrectedFlowGps
        = result.compressorCorrectedMassFlow * 1000;
    result.trappedAirMassMgPerCylinder
        = engine.state.trappedAirMass.reduce((sum, mass) => sum + mass, 0)
            / engine.state.trappedAirMass.length
            * 1e6;

    return result;
}

const results = [];

for (const targetRpm of targetSpeeds) {
    advanceAtFixedSpeed(targetRpm, settlingDuration, false);
    const result = advanceAtFixedSpeed(
        targetRpm,
        averagingDuration,
        true
    );
    results.push(result);

    console.error(
        `${targetRpm.toString().padStart(4)} tr/min | `
        + `${result.torque.toFixed(1).padStart(6)} N·m | `
        + `${result.powerHp.toFixed(1).padStart(6)} ch | `
        + `${result.boost.toFixed(3)} bar | `
        + `CA50 ${result.combustionCA50DegAfterTdc.toFixed(1)}°`
    );
}

console.log(JSON.stringify({
    metadata: {
        externalTimeStep,
        settlingDuration,
        averagingDuration,
        throttle: 1,
        mode: "RPM_HOLD stabilisé"
    },
    results
}, null, 2));
