// Ordonne les modules et met à jour l'état du moteur.
// La boucle externe reste exprimée en secondes afin de conserver une simulation
// temps réel. Chaque appel est toutefois sous-divisé automatiquement selon
// l'ANGLE parcouru par le vilebrequin. La combustion et les événements de
// distribution gardent ainsi une résolution presque indépendante du régime.

import EngineState from "./EngineState.js";
import {
    getCylinderVolume,
    getPistonDisplacementFromTDC,
    CYLINDER_OFFSETS
} from "../Geometry/Geometry.js";
import { updateIntakeManifold } from "../Intake/IntakeManifold.js";
import { updateExhaustManifold } from "../Exhaust/ExhaustManifold.js";
import { updateTurbocharger } from "../Turbo/Turbocharger.js";
import { updateThermodynamics } from "../Thermodynamics/Thermodynamics.js";
import { updateFuel } from "../Fuel/Fuel.js";
import { updateCrankshaft } from "../Crankshaft/Crankshaft.js";
import { updateOverrunFuelCut } from "../Crankshaft/MechanicalLosses.js";
import { updateDyno } from "../Dyno/Dyno.js";
import {
    requestEngineStart,
    requestEngineStop,
    toggleEngine,
    updateEngineControlBeforePhysics,
    updateEngineControlAfterPhysics
} from "../EngineControl/EngineControl.js";
import TelemetryRecorder from "../Telemetry/TelemetryRecorder.js";
import CycleRecorder from "../Cycle/CycleRecorder.js";
import {
    beginConservationStep,
    finalizeConservationStep
} from "../Diagnostics/ConservationDiagnostics.js";
import {
    calculateCrankAngleSubstep,
    BASE_CRANK_ANGLE_STEP_DEG,
    COMBUSTION_CRANK_ANGLE_STEP_DEG,
    EVENT_CRANK_ANGLE_STEP_DEG,
    MAX_INTERNAL_TIME_STEP
} from "../Numerics/CrankAngleIntegrator.js";

// Garde contre un intervalle externe anormalement grand. À 7000 tr/min,
// 50 000 sous-pas couvrent déjà plusieurs tours moteur.
const MAXIMUM_INTERNAL_SUBSTEPS_PER_UPDATE = 50000;
const REMAINING_TIME_EPSILON = 1e-12;

export default class Engine {

    constructor({
                    telemetryRecorder = null,
                    telemetryOptions = {},
                    cycleRecorder = null,
                    cycleRecorderOptions = {},
                    conservationDiagnosticsStride = 8,
                    angleSolverBaseStepDeg = BASE_CRANK_ANGLE_STEP_DEG
                } = {}) {
        this.state = new EngineState();

        // L'enregistreur reçoit chaque sous-pas ANGULAIRE réellement intégré.
        // Il fabrique ensuite des fenêtres temporelles exactes à 60 Hz pour
        // Chart.js, sans modifier aucune grandeur de la simulation.
        this.telemetry = telemetryRecorder
        && typeof telemetryRecorder.recordSubstep === "function"
            ? telemetryRecorder
            : new TelemetryRecorder(telemetryOptions);

        this.state.telemetryOutputRateHz
            = this.telemetry.outputRateHz;
        this.state.telemetryHistorySeconds
            = this.telemetry.historySeconds;
        this.state.telemetryBufferCapacity
            = this.telemetry.capacity;
        this.state.telemetryInputRateHz
            = this.telemetry.inputRateHz ?? this.telemetry.outputRateHz;

        // Recorder 720° haute résolution, indépendant de la télémétrie lente.
        this.cycleRecorder = cycleRecorder
        && typeof cycleRecorder.recordSubstep === "function"
            ? cycleRecorder
            : new CycleRecorder(cycleRecorderOptions);

        this.state.cycleRecorderEnabled = this.cycleRecorder.enabled;
        this.state.cycleRecorderCylinderIndex
            = this.cycleRecorder.cylinderIndex;

        // Temps reçu de la boucle temps réel mais pas encore consommé par un
        // sous-pas angulaire complet. Ce résidu rend le résultat indépendant de
        // la taille des appels externes : 10 appels de 10 µs produisent le même
        // pas interne qu'un appel de 100 µs.
        this.pendingSimulationTime = 0;

        // Les bilans de conservation sont purement diagnostiques. Les termes de
        // bookkeeping sont réinitialisés à chaque sous-pas, mais les résidus
        // complets ne sont calculés que tous les N sous-pas afin de libérer le
        // thread principal sans modifier la physique.
        this.conservationDiagnosticsStride = Math.max(
            Math.trunc(conservationDiagnosticsStride),
            1
        );
        this.physicsSubstepSequence = 0;
        this.state.conservationDiagnosticsStride
            = this.conservationDiagnosticsStride;

        // Diagnostics statiques de configuration, pratiques pour l'interface et
        // les tests de convergence. Le pas peut être changé avant un essai
        // déterministe sans modifier les constantes globales du solveur.
        this.setAngleResolution(angleSolverBaseStepDeg);
        this.state.angleSolverMaximumTimeStepUs
            = MAX_INTERNAL_TIME_STEP * 1e6;
    }

    // Commandes de l'interface

    start() {
        requestEngineStart(this.state);
    }

    stop() {
        requestEngineStop(this.state);
    }

    toggle() {
        toggleEngine(this.state);
    }

    /**
     * Configure la résolution générale du solveur angulaire.
     *
     * Les pas combustion et événements conservent les mêmes rapports que le
     * solveur nominal. Cette méthode est destinée aux essais de convergence
     * 1,00° / 0,50° / 0,25°.
     */
    setAngleResolution(baseStepDeg = BASE_CRANK_ANGLE_STEP_DEG) {
        const safeBaseStepDeg = Math.max(
            BASE_CRANK_ANGLE_STEP_DEG * 0.25,
            Math.min(
                Number.isFinite(baseStepDeg)
                    ? baseStepDeg
                    : BASE_CRANK_ANGLE_STEP_DEG,
                BASE_CRANK_ANGLE_STEP_DEG * 4
            )
        );
        const scale = safeBaseStepDeg
            / BASE_CRANK_ANGLE_STEP_DEG;

        this.state.angleSolverResolutionScale = scale;
        this.state.angleSolverBaseStepDeg
            = BASE_CRANK_ANGLE_STEP_DEG * scale;
        this.state.angleSolverCombustionStepDeg
            = COMBUSTION_CRANK_ANGLE_STEP_DEG * scale;
        this.state.angleSolverEventStepDeg
            = EVENT_CRANK_ANGLE_STEP_DEG * scale;

        return {
            baseStepDeg: this.state.angleSolverBaseStepDeg,
            combustionStepDeg: this.state.angleSolverCombustionStepDeg,
            eventStepDeg: this.state.angleSolverEventStepDeg,
            scale
        };
    }

    // Un sous-pas physique

    /**
     * Exécute un seul sous-pas déjà limité par l'intégrateur angulaire.
     *
     * L'ordre des modules est inchangé par rapport au modèle validé :
     * contrôle → angle → géométrie → admission → échappement → turbo →
     * thermodynamique fermée → couple → banc → transitions → carburant.
     */
    updatePhysicsSubstep(dt) {
        // Capture des stocks avant toute modification du sous-pas. Les modules
        // physiques renseignent ensuite leurs flux exacts, puis le bilan est
        // fermé en fin de fonction sans agir sur la simulation.
        const captureConservationDiagnostics = (
            this.physicsSubstepSequence
            % this.conservationDiagnosticsStride
        ) === 0;
        beginConservationStep(
            this.state,
            captureConservationDiagnostics
        );

        // A. Gestion moteur AVANT la physique
        updateEngineControlBeforePhysics(this.state, dt);
        updateOverrunFuelCut(this.state);

        // B. Rotation du vilebrequin sur 720°
        // Le régime au début du sous-pas définit l'avancement angulaire. Le banc
        // intégrera le nouveau régime en fin de sous-pas : schéma explicite,
        // cohérent avec les autres bilans du modèle.
        const omega = this.state.rpm * 2 * Math.PI / 60;
        this.state.crankAngle = (
            this.state.crankAngle + omega * dt
        ) % (4 * Math.PI);

        // C. Géométrie bielle-manivelle
        for (let i = 0; i < 4; i++) {
            const localAngle = (
                this.state.crankAngle + CYLINDER_OFFSETS[i]
            ) % (4 * Math.PI);

            this.state.prevCylinderVolumes[i]
                = this.state.cylinderVolumes[i];

            this.state.pistonPositions[i]
                = getPistonDisplacementFromTDC(localAngle);
            this.state.cylinderVolumes[i]
                = getCylinderVolume(localAngle);
        }

        // D. Volumes gazeux et soupapes
        updateIntakeManifold(this.state, dt);
        updateExhaustManifold(this.state, dt);

        // E. Turbo, compresseur et volume de suralimentation
        updateTurbocharger(this.state, dt);

        // F. Cylindres fermés : compression, combustion, détente
        updateThermodynamics(this.state, dt);

        // G. Couple moteur puis dynamique du banc
        updateCrankshaft(this.state, dt);
        updateDyno(this.state, dt);

        // H. Transitions de fonctionnement et consommation
        updateEngineControlAfterPhysics(this.state, dt);
        updateFuel(this.state, dt);

        // Résidus de masse et d'énergie du sous-pas. Cette opération est
        // purement diagnostique et ne réinjecte aucune correction dans l'état.
        finalizeConservationStep(this.state, dt);
        this.physicsSubstepSequence++;
    }

    // Intégration angulaire depuis la boucle temps réel

    update(dt) {
        if (!Number.isFinite(dt) || dt <= 0) {
            return;
        }

        // Le temps externe est accumulé. Le solveur n'exécute ensuite que des
        // sous-pas complets choisis par l'angle ou par la limite de 0.1 ms.
        // Aucun petit appel externe ne force donc un pas plus fin que demandé.
        this.pendingSimulationTime += dt;

        let substepCount = 0;
        let integratedTime = 0;

        let minimumSubstepTime = Number.POSITIVE_INFINITY;
        let maximumSubstepTime = 0;
        let maximumAngleAdvanceDeg = 0;
        let minimumRequestedAngleStepDeg = Number.POSITIVE_INFINITY;

        let integratedTorque = 0;
        let integratedPower = 0;
        let integratedTurbinePower = 0;

        while (substepCount < MAXIMUM_INTERNAL_SUBSTEPS_PER_UPDATE) {
            const substep = calculateCrankAngleSubstep(this.state);

            if (!Number.isFinite(substep.dt) || substep.dt <= 0) {
                break;
            }

            // Le reliquat est conservé jusqu'au prochain appel afin d'éviter
            // un pas partiel dépendant de dt externe.
            if (this.pendingSimulationTime + REMAINING_TIME_EPSILON
                < substep.dt) {
                break;
            }

            this.updatePhysicsSubstep(substep.dt);

            // Acquisition angulaire native du cylindre sélectionné. Le cycle
            // n'est publié qu'après un passage complet de 0° à 720°.
            this.cycleRecorder.recordSubstep(
                this.state,
                substep.dt
            );

            // Acquisition exactement au même niveau que les bilans physiques.
            // Le recorder partage si nécessaire ce sous-pas entre deux fenêtres
            // de 1/60 s et utilise des moyennes pondérées par substep.dt.
            const emittedTelemetrySamples = this.telemetry.recordSubstep(
                this.state,
                substep.dt
            );

            this.state.telemetrySamplesProduced
                += emittedTelemetrySamples;

            integratedTorque += this.state.torque * substep.dt;
            integratedPower += this.state.power * substep.dt;
            integratedTurbinePower += (
                Number.isFinite(this.state.turbinePower)
                    ? this.state.turbinePower
                    : 0
            ) * substep.dt;

            minimumSubstepTime = Math.min(
                minimumSubstepTime,
                substep.dt
            );
            maximumSubstepTime = Math.max(
                maximumSubstepTime,
                substep.dt
            );
            maximumAngleAdvanceDeg = Math.max(
                maximumAngleAdvanceDeg,
                substep.predictedAngleAdvanceDeg
            );
            minimumRequestedAngleStepDeg = Math.min(
                minimumRequestedAngleStepDeg,
                substep.targetAngleStepDeg
            );

            this.pendingSimulationTime = Math.max(
                this.pendingSimulationTime - substep.dt,
                0
            );
            integratedTime += substep.dt;
            substepCount++;
        }

        this.state.angleSolverSaturated
            = substepCount >= MAXIMUM_INTERNAL_SUBSTEPS_PER_UPDATE;
        this.state.angleSolverUnintegratedTime
            = this.pendingSimulationTime;
        this.state.angleSolverPendingTimeUs
            = this.pendingSimulationTime * 1e6;

        this.state.angleSolverSubstepsLastUpdate = substepCount;
        this.state.angleSolverMinimumTimeStepUs
            = Number.isFinite(minimumSubstepTime)
            ? minimumSubstepTime * 1e6
            : 0;
        this.state.angleSolverMaximumTimeStepUs
            = maximumSubstepTime * 1e6;
        this.state.angleSolverMaximumAngleAdvanceDeg
            = maximumAngleAdvanceDeg;
        this.state.angleSolverMinimumRequestedStepDeg
            = Number.isFinite(minimumRequestedAngleStepDeg)
            ? minimumRequestedAngleStepDeg
            : 0;
        this.state.angleSolverTotalSubsteps += substepCount;

        const latestTelemetrySample = this.telemetry.getLatestSample();
        this.state.telemetryBufferedSamples = this.telemetry.size;
        this.state.telemetryLastSampleTime = latestTelemetrySample
            ? latestTelemetrySample.time
            : 0;
        this.state.telemetryLastSampleSequence = latestTelemetrySample
            ? latestTelemetrySample.sequence
            : -1;

        if (integratedTime > 0) {
            this.state.lastUpdateAverageTorque
                = integratedTorque / integratedTime;
            this.state.lastUpdateAveragePower
                = integratedPower / integratedTime;
            this.state.lastUpdateAverageTurbinePower
                = integratedTurbinePower / integratedTime;
        }
    }
}
