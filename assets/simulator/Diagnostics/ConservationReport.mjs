// Test autonome des résidus de masse et d'énergie.
// À lancer depuis la racine de numericalTwin :
//     node Diagnostics/ConservationReport.mjs
//     node Diagnostics/ConservationReport.mjs 15 0.0001
// Arguments : durée simulée en secondes, puis pas externe de Engine.update().
// Le solveur angulaire interne reste maître de la résolution physique.

import Engine from "../engine/Engine.js";
import { DYNO_MODES } from "../Dyno/Dyno.js";

const duration = Number(process.argv[2] || 10);
const externalDt = Number(process.argv[3] || 0.0001);
const warmupDuration = Math.min(3, duration * 0.35);

const engine = new Engine({
    telemetryOptions: {
        outputRateHz: 60,
        historySeconds: Math.max(duration + 1, 10)
    }
});

engine.state.dynoMode = DYNO_MODES.INERTIA;
engine.state.dynoRoadLoadEnabled = false;
engine.state.dynoCoastdownBrakeEnabled = false;
engine.start();

let maximumMassResidualPercent = 0;
let maximumEnergyResidualPercent = 0;
let sumGlobalMassResidualPercent = 0;
let sumGlobalEnergyResidualPercent = 0;
let measuredSubsteps = 0;

const steps = Math.ceil(duration / externalDt);
for (let step = 0; step < steps; step++) {
    const time = step * externalDt;

    // Démarrage et ralenti, puis ouverture progressive du papillon.
    engine.state.throttle = time < 2
        ? 0
        : Math.min(1, (time - 2) / 1.0);

    engine.update(externalDt);

    if (time >= warmupDuration) {
        maximumMassResidualPercent = Math.max(
            maximumMassResidualPercent,
            engine.state.maximumMassResidualPercent
        );
        maximumEnergyResidualPercent = Math.max(
            maximumEnergyResidualPercent,
            engine.state.maximumEnergyResidualPercent
        );
        sumGlobalMassResidualPercent
            += engine.state.globalMassResidualPercent;
        sumGlobalEnergyResidualPercent
            += engine.state.globalEnergyResidualPercent;
        measuredSubsteps++;
    }
}

const state = engine.state;
const divisor = Math.max(measuredSubsteps, 1);

const report = {
    scenario: {
        duration,
        externalDt,
        telemetrySamples: engine.telemetry.getHistory().length,
        finalRpm: state.rpm,
        finalBoostBar: state.boost
    },
    closureResiduals: {
        maximumMassResidualPercent,
        maximumEnergyResidualPercent,
        averageGlobalMassResidualPercent:
            sumGlobalMassResidualPercent / divisor,
        averageGlobalEnergyResidualPercent:
            sumGlobalEnergyResidualPercent / divisor,
        latestGlobalMassResidualRateKgPerS:
            state.globalMassResidualRate,
        latestGlobalEnergyResidualRateW:
            state.globalEnergyResidualRate
    },
    explicitCorrections: {
        latestMassCorrectionRateKgPerS:
            state.globalMassCorrectionRate,
        latestEnergyCorrectionRateW:
            state.globalEnergyCorrectionRate,
        cumulativeAbsoluteMassResidualKg:
            state.cumulativeAbsoluteMassResidual,
        cumulativeAbsoluteEnergyResidualJ:
            state.cumulativeAbsoluteEnergyResidual
    },
    interfaces: {
        throttleMassMismatchKgPerS:
            state.throttleInterfaceMassMismatchRate,
        throttleEnergyMismatchW:
            state.throttleInterfaceEnergyMismatchRate
    },
    latestVolumeResidualPercent: {
        cylindersMass: state.cylinderMassResidualPercent,
        cylindersEnergy: state.cylinderEnergyResidualPercent,
        intakeMass: state.intakeManifoldMassResidualPercent,
        intakeEnergy: state.intakeManifoldEnergyResidualPercent,
        chargeAirMass: state.chargeAirMassResidualPercent,
        chargeAirEnergy: state.chargeAirEnergyResidualPercent,
        exhaustScrollMass: state.exhaustScrollMassResidualPercent,
        exhaustScrollEnergy: state.exhaustScrollEnergyResidualPercent,
        exhaustWallEnergy: state.exhaustWallEnergyResidualPercent
    }
};

console.log(JSON.stringify(report, null, 2));
