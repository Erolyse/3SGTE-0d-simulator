import type { EngineStateData, CylinderIndex } from "../engine/EngineStateTypes.js";
import type { CycleEvents, CycleSample, CycleSummary, RecordedCycle } from "../Charts/VisualizationTypes.js";

// Recorder passif d'un cycle thermodynamique complet de 720°.
// Il conserve la résolution angulaire native pour pression-angle, P-V et bilans
// thermiques, indépendamment de la télémétrie temporelle.

import {
    CYLINDER_OFFSETS,
    SWEPT_VOLUME,
    getCylinderVolume
} from "../Geometry/Geometry.js";
import {
    INTAKE_VALVE_OPEN_DEG,
    INTAKE_VALVE_CLOSE_DEG,
    getIntakeValveLift,
    isIntakeValveOpen
} from "../Valvetrain/IntakeValves.js";
import {
    EXHAUST_VALVE_OPEN_DEG,
    EXHAUST_VALVE_CLOSE_DEG,
    getExhaustValveLift,
    isExhaustValveOpen
} from "../Valvetrain/ExhaustValves.js";
import {
    EXHAUST_SCROLL_BY_CYLINDER
} from "../Exhaust/ExhaustManifold.js";


export interface CycleRecorderOptions {
    cylinderIndex?: number;
    historyCycles?: number;
    maximumSamplesPerCycle?: number;
    minimumRecordingRpm?: number;
    angularSampleStepDeg?: number;
    captureIntervalSeconds?: number;
    enabled?: boolean;
}

export interface CycleRecorderSample extends CycleSample {
    angleDeg: number;
    absoluteTime: number;
    deltaTime: number;
    timeFromCycleStart?: number;
}

interface CycleIntegrals {
    rpmTime: number; torqueTime: number; powerTime: number; boostTime: number;
    intakePressureTime: number; exhaustPressureTime: number; ignitionTimingTime: number;
    combustionDurationTime: number; ca50ModelTime: number; ca50TargetTime: number;
    ca50TargetValidTime: number; heatReleasedJ: number; wallHeatTransferJ: number;
    closedBoundaryWorkJ: number; pumpingBoundaryWorkJ: number; intakeEnthalpyJ: number;
    exhaustEnthalpyJ: number; fuelMassAddedKg: number;
}

type CombustionCrossingKey = "ca10Deg" | "ca50Deg" | "ca90Deg";
interface CombustionCrossings extends Record<CombustionCrossingKey, number> {
    previousAngleDeg: number;
    previousBurnedFraction: number;
}

interface CycleExtrema {
    peakPressurePa: number; peakPressureAngleDeg: number; minimumPressurePa: number;
    peakTemperatureK: number; peakTemperatureAngleDeg: number;
    maximumIntakeMassFlowKgS: number; maximumExhaustMassFlowKgS: number;
    maximumMassResidualPercent: number; maximumEnergyResidualPercent: number;
}

export interface CycleSummaryDetails extends CycleSummary {
    durationSeconds: number;
    sampleCount: number;
    meanRpm: number;
    peakPressurePa: number;
    peakPressureAngleDeg: number;
    heatReleasedJ: number;
    wallHeatTransferJ: number;
    closedBoundaryWorkJ: number;
    pumpingBoundaryWorkJ: number;
    totalBoundaryWorkJ: number;
    [key: string]: number | boolean | undefined;
}
export interface CycleEventsDetails extends CycleEvents {
    [key: string]: number | undefined;
}
export interface RecordedCycleDetails extends RecordedCycle {
    startTime: number; endTime: number; duration: number; angularStepDeg: number;
    samples: CycleRecorderSample[]; truncated: boolean;
    summary?: CycleSummaryDetails; events?: CycleEventsDetails;
}
interface InternalCycle extends RecordedCycleDetails {
    nextSampleAngleDeg?: number;
    integrals?: CycleIntegrals;
    combustionCrossings?: CombustionCrossings;
    extrema?: CycleExtrema;
}
export type CycleSubscriber = (cycle: RecordedCycleDetails) => void;

const FULL_CYCLE_DEG = 720;
const FOUR_PI = 4 * Math.PI;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_HISTORY_CYCLES = 4;
const DEFAULT_MAXIMUM_SAMPLES_PER_CYCLE = 1000;
const DEFAULT_MINIMUM_RECORDING_RPM = 100;
const DEFAULT_ANGULAR_SAMPLE_STEP_DEG = 1;
const DEFAULT_CAPTURE_INTERVAL_SECONDS = 0.25;
const WRAP_DETECTION_THRESHOLD_DEG = 360;
const NUMERIC_EPSILON = 1e-12;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function arrayValue(array: readonly unknown[] | null | undefined, index: number, fallback = 0): number {
    if (!Array.isArray(array)) {
        return fallback;
    }

    return finite(array[index], fallback);
}

function normalizeDegrees720(angleDeg: number): number {
    return (
        (angleDeg % FULL_CYCLE_DEG)
        + FULL_CYCLE_DEG
    ) % FULL_CYCLE_DEG;
}

function getCylinderLocalAngleDeg(state: EngineStateData, cylinderIndex: number): number {
    const localAngleRad = (
        finite(state.crankAngle)
        + CYLINDER_OFFSETS[cylinderIndex]
    ) % FOUR_PI;

    return normalizeDegrees720(localAngleRad * RAD_TO_DEG);
}

function getWiebeNormalizedPosition(fraction: number): number {
    // Loi de Wiebe utilisée dans Thermodynamics.js :
    // xb = 1 - exp(-5 * x^3)
    const safeFraction = clamp(fraction, 1e-9, 1 - 1e-9);
    return Math.pow(-Math.log(1 - safeFraction) / 5, 1 / 3);
}

/**
 * Interpole l'angle exact où une grandeur monotone franchit un seuil.
 * Utilisé pour mesurer CA10 / CA50 / CA90 sur les sous-pas réellement intégrés,
 * sans reconstruire ces angles à partir de la loi de Wiebe.
 */
export function interpolateMonotonicThresholdCrossing(
    previousAngleDeg: number,
    previousValue: number,
    currentAngleDeg: number,
    currentValue: number,
    threshold: number
): number {
    if (![previousAngleDeg, previousValue, currentAngleDeg, currentValue, threshold]
        .every(Number.isFinite)) {
        return NaN;
    }
    if (currentAngleDeg < previousAngleDeg
        || previousValue >= threshold
        || currentValue < threshold
        || currentValue <= previousValue + NUMERIC_EPSILON) {
        return NaN;
    }

    const fraction = clamp(
        (threshold - previousValue) / (currentValue - previousValue),
        0,
        1
    );
    return previousAngleDeg
        + (currentAngleDeg - previousAngleDeg) * fraction;
}

function getCyclePhase(angleDeg: number, intakeOpen: boolean, exhaustOpen: boolean): string {
    if (intakeOpen) {
        return "intake";
    }
    if (exhaustOpen) {
        return "exhaust";
    }
    if (angleDeg < 360) {
        return "compression";
    }
    return "combustionExpansion";
}

function cloneSampleWithBoundaryAngle(sample: CycleRecorderSample, boundaryAngleDeg: number, dt = 0): CycleRecorderSample {
    return {
        ...sample,
        angleDeg: boundaryAngleDeg,
        deltaTime: dt
    };
}

/**
 * Enregistre continuellement les cycles complets d'un cylindre sélectionné.
 *
 * Le premier fragment observé est volontairement ignoré. L'acquisition commence
 * au prochain passage de 720° vers 0°, ce qui garantit que chaque cycle publié
 * couvre exactement une séquence admission → compression → combustion →
 * détente → échappement.
 */
export default class CycleRecorder {
    cylinderIndex: CylinderIndex;
    readonly historyCycles: number;
    readonly maximumSamplesPerCycle: number;
    readonly minimumRecordingRpm: number;
    readonly angularSampleStepDeg: number;
    readonly captureIntervalSeconds: number;
    enabled: boolean;
    elapsedSimulationTime: number;
    nextCaptureAllowedTime: number;
    previousLocalAngleDeg: number | null;
    currentCycle: InternalCycle | null;
    readonly completedCycles: InternalCycle[];
    sequence: number;
    readonly subscribers: Set<CycleSubscriber>;

    constructor({
                    cylinderIndex = 0,
                    historyCycles = DEFAULT_HISTORY_CYCLES,
                    maximumSamplesPerCycle = DEFAULT_MAXIMUM_SAMPLES_PER_CYCLE,
                    minimumRecordingRpm = DEFAULT_MINIMUM_RECORDING_RPM,
                    angularSampleStepDeg = DEFAULT_ANGULAR_SAMPLE_STEP_DEG,
                    captureIntervalSeconds = DEFAULT_CAPTURE_INTERVAL_SECONDS,
                    enabled = true
                }: CycleRecorderOptions = {}) {
        this.cylinderIndex = clamp(Math.trunc(cylinderIndex), 0, 3) as CylinderIndex;
        this.historyCycles = Math.max(Math.trunc(historyCycles), 1);
        this.maximumSamplesPerCycle = Math.max(
            Math.trunc(maximumSamplesPerCycle),
            100
        );
        this.minimumRecordingRpm = Math.max(minimumRecordingRpm, 0);
        this.angularSampleStepDeg = clamp(
            finite(angularSampleStepDeg, DEFAULT_ANGULAR_SAMPLE_STEP_DEG),
            0.25,
            10
        );
        this.captureIntervalSeconds = Math.max(
            finite(captureIntervalSeconds, DEFAULT_CAPTURE_INTERVAL_SECONDS),
            0
        );
        this.enabled = Boolean(enabled);

        this.elapsedSimulationTime = 0;
        this.nextCaptureAllowedTime = 0;
        this.previousLocalAngleDeg = null;
        this.currentCycle = null;
        this.completedCycles = [];
        this.sequence = 0;
        this.subscribers = new Set();
    }

    // Commandes publiques

    setEnabled(enabled: boolean): void {
        this.enabled = Boolean(enabled);
        if (!this.enabled) {
            this.resetCurrentCapture();
        }
    }

    setCylinder(cylinderIndex: number): void {
        const nextIndex = clamp(Math.trunc(cylinderIndex), 0, 3) as CylinderIndex;
        if (nextIndex === this.cylinderIndex) {
            return;
        }

        this.cylinderIndex = nextIndex;
        this.previousLocalAngleDeg = null;
        this.resetCurrentCapture();
    }

    clear(): void {
        this.completedCycles.length = 0;
        this.previousLocalAngleDeg = null;
        this.resetCurrentCapture();
    }

    subscribe(callback: CycleSubscriber): () => void {
        if (typeof callback !== "function") {
            return () => {};
        }

        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    getLatestCycle(): RecordedCycleDetails | null {
        return this.completedCycles.length > 0
            ? this.completedCycles[this.completedCycles.length - 1]
            : null;
    }

    getHistory(): RecordedCycleDetails[] {
        return this.completedCycles.slice();
    }

    getCurrentCyclePreview(): RecordedCycleDetails | null {
        return this.currentCycle;
    }

    /**
     * Exporte un cycle au format CSV. Les clés par défaut couvrent les premiers
     * graphiques envisagés : pression-angle, P-V, soupapes et bilan thermique.
     */
    exportCsv(cycle: RecordedCycleDetails | null = this.getLatestCycle(), fields: string[] | null = null): string {
        if (!cycle || !Array.isArray(cycle.samples)) {
            return "";
        }

        const selectedFields = Array.isArray(fields) && fields.length > 0
            ? fields
            : [
                "angleDeg",
                "rpm",
                "cylinderPressurePa",
                "cylinderVolumeM3",
                "cylinderTemperatureK",
                "intakeValveLiftM",
                "exhaustValveLiftM",
                "intakeValveMassFlowKgS",
                "exhaustValveMassFlowKgS",
                "burnedFraction",
                "heatReleaseRateW",
                "wallHeatTransferRateW",
                "boundaryWorkRateW"
            ];

        const escapeCsv = (value: unknown): string => {
            if (typeof value === "string") {
                return `"${value.replaceAll('"', '""')}"`;
            }
            return Number.isFinite(value) ? String(value) : "";
        };

        const lines = [selectedFields.join(",")];
        for (const sample of cycle.samples) {
            lines.push(
                selectedFields
                    .map(field => escapeCsv(sample[field]))
                    .join(",")
            );
        }

        return lines.join("\n");
    }

    // Acquisition d'un sous-pas angulaire

    /**
     * Reçoit l'état APRÈS un sous-pas physique complet.
     *
     * @param {object} state État moteur après intégration du sous-pas
     * @param {number} dt Durée exacte du sous-pas en secondes
     * @returns {object|null} Cycle finalisé lors de ce sous-pas, sinon null
     */
    recordSubstep(state: EngineStateData, dt: number): RecordedCycleDetails | null {
        if (!Number.isFinite(dt) || dt <= 0) {
            return null;
        }

        this.elapsedSimulationTime += dt;
        const localAngleDeg = getCylinderLocalAngleDeg(
            state,
            this.cylinderIndex
        );

        if (!this.enabled
            || finite(state.rpm) < this.minimumRecordingRpm) {
            this.previousLocalAngleDeg = localAngleDeg;
            this.resetCurrentCapture();
            this.updateStateDiagnostics(state);
            return null;
        }

        if (this.previousLocalAngleDeg === null) {
            this.previousLocalAngleDeg = localAngleDeg;
            this.updateStateDiagnostics(state);
            return null;
        }

        const wrapped = this.previousLocalAngleDeg - localAngleDeg
            > WRAP_DETECTION_THRESHOLD_DEG;
        let completedCycle = null;

        // Hors capture, l'acquisition attend une frontière 720° sans allouer
        // les gros objets d'un cycle complet.
        if (!this.currentCycle) {
            if (wrapped
                && this.elapsedSimulationTime + NUMERIC_EPSILON
                >= this.nextCaptureAllowedTime) {
                const initialSample = this.createSample(
                    state,
                    dt,
                    0
                );
                initialSample.deltaTime = 0;
                this.currentCycle = this.createCycleContainer(initialSample);
                this.appendSample(this.currentCycle, initialSample, state);
            }

            this.previousLocalAngleDeg = localAngleDeg;
            this.updateStateDiagnostics(state);
            return null;
        }

        // Les intégrales scientifiques restent basées sur chaque sous-pas réel,
        // tandis que les objets destinés au front sont limités au pas angulaire.
        this.accumulateCycleStep(
            this.currentCycle,
            state,
            dt,
            localAngleDeg
        );

        if (wrapped) {
            const terminalSample = this.createSample(
                state,
                dt,
                FULL_CYCLE_DEG
            );
            terminalSample.deltaTime = 0;
            this.appendSample(this.currentCycle, terminalSample, state);
            completedCycle = this.finalizeCurrentCycle(state);
            this.nextCaptureAllowedTime = this.elapsedSimulationTime
                + this.captureIntervalSeconds;
        } else {
            const cycle = this.currentCycle;
            while (cycle.nextSampleAngleDeg!
            <= localAngleDeg + NUMERIC_EPSILON) {
                const displaySample = this.createSample(
                    state,
                    dt,
                    cycle.nextSampleAngleDeg!
            );
                displaySample.deltaTime = 0;
                this.appendSample(cycle, displaySample, state);
                cycle.nextSampleAngleDeg! += this.angularSampleStepDeg;

                if (cycle.samples.length >= this.maximumSamplesPerCycle) {
                    cycle.truncated = true;
                    break;
                }
            }
        }

        this.previousLocalAngleDeg = localAngleDeg;
        this.updateStateDiagnostics(state, completedCycle);
        return completedCycle;
    }

    // Création des échantillons

    createSample(state: EngineStateData, dt: number, localAngleDeg: number): CycleRecorderSample {
        const cylinder = this.cylinderIndex;
        const scroll = EXHAUST_SCROLL_BY_CYLINDER[cylinder] ?? 0;

        const intakeOpen = isIntakeValveOpen(
            localAngleDeg * Math.PI / 180
        );
        const exhaustOpen = isExhaustValveOpen(
            localAngleDeg * Math.PI / 180
        );

        const closedBoundaryWork = arrayValue(
            state.cylinderBoundaryWorkStep,
            cylinder
        );
        const openBoundaryWork = arrayValue(
            state.cylinderOpenBoundaryWorkStep,
            cylinder
        );
        const closedWallHeat = arrayValue(
            state.cylinderWallHeatTransferStep,
            cylinder
        );
        const openWallHeat = arrayValue(
            state.cylinderOpenWallHeatTransferStep,
            cylinder
        );
        const safeDt = Math.max(dt, NUMERIC_EPSILON);

        return {
            // Repères du cycle
            angleDeg: localAngleDeg,
            absoluteTime: this.elapsedSimulationTime,
            deltaTime: dt,
            phase: getCyclePhase(localAngleDeg, intakeOpen, exhaustOpen),
            intakeValveOpen: intakeOpen,
            exhaustValveOpen: exhaustOpen,

            // État moteur global utile pour contextualiser le cycle
            rpm: finite(state.rpm),
            throttle: finite(state.throttle),
            torqueNm: finite(state.torque),
            indicatedTorqueNm: finite(state.indicatedTorque),
            closedCycleTorqueNm: finite(state.closedCycleIndicatedTorque),
            pumpingTorqueNm: finite(state.pumpingTorque),
            powerW: finite(state.power),
            boostBarGauge: finite(state.boost),
            turboRPM: finite(state.turboRPM),
            ignitionTimingDeg: finite(state.ignitionTimingDeg),
            combustionDurationDeg: finite(state.combustionDurationDeg, 50),
            // Valeur analytique du modèle de Wiebe, distincte du CA50 mesuré.
            combustionCA50DegAfterTdc: finite(
                state.combustionCA50DegAfterTdc
            ),
            combustionCA50ModelDegAfterTdc: finite(
                state.combustionCA50DegAfterTdc
            ),
            combustionCA50TargetDegAfterTdc: finite(
                state.combustionCA50TargetDegAfterTdc,
                NaN
            ),

            // État thermodynamique du cylindre sélectionné
            cylinderPressurePa: arrayValue(
                state.cylinderPressures,
                cylinder
            ),
            // Le point d'affichage est placé sur un angle nominal décimé.
            // Son volume doit donc être calculé à ce même angle, et non repris
            // depuis l'état du sous-pas légèrement décalé.
            cylinderVolumeM3: getCylinderVolume(
                (localAngleDeg % 360) * DEG_TO_RAD
            ),
            cylinderTemperatureK: arrayValue(
                state.cylinderTemperatures,
                cylinder
            ),
            cylinderGasMassKg: arrayValue(
                state.cylinderGasMass,
                cylinder
            ),
            trappedAirMassKg: arrayValue(
                state.trappedAirMass,
                cylinder
            ),
            burnedFuelMassKg: arrayValue(
                state.burnedFuelMassInCylinder,
                cylinder
            ),
            cylinderInternalEnergyJ: arrayValue(
                state.cylinderInternalEnergies,
                cylinder
            ),
            burnedFraction: clamp(
                arrayValue(state.cylinderBurnedFraction, cylinder),
                0,
                1
            ),

            // Conditions aux limites du cylindre
            intakePressurePa: finite(state.intakePressure),
            intakeTemperatureK: finite(state.intakeTemperature),
            exhaustPressurePa: arrayValue(
                state.exhaustManifoldPressures,
                scroll,
                finite(state.exhaustBackPressure, 101325)
            ),
            exhaustTemperatureK: arrayValue(
                state.exhaustManifoldTemperatures,
                scroll,
                finite(state.exhaustGasTemperature, 293)
            ),

            // Distribution et débits signés
            intakeValveLiftM: getIntakeValveLift(
                localAngleDeg * Math.PI / 180
            ),
            exhaustValveLiftM: getExhaustValveLift(
                localAngleDeg * Math.PI / 180
            ),
            intakeValveMassFlowKgS: arrayValue(
                state.intakeValveMassFlow,
                cylinder
            ),
            exhaustValveMassFlowKgS: arrayValue(
                state.exhaustValveMassFlow,
                cylinder
            ),

            // Flux thermiques instantanés
            heatReleaseRateW: arrayValue(
                state.cylinderHeatReleaseRate,
                cylinder
            ),

            // Ces champs décrivent la phase fermée ; les variantes `total...`
            // couvrent le bilan complet sur 720°.
            wallHeatTransferRateW: arrayValue(
                state.cylinderWallHeatTransferRate,
                cylinder
            ),
            boundaryWorkRateW: arrayValue(
                state.cylinderBoundaryWorkRate,
                cylinder
            ),
            closedWallHeatTransferRateW: closedWallHeat / safeDt,
            openWallHeatTransferRateW: openWallHeat / safeDt,
            totalWallHeatTransferRateW:
                (closedWallHeat + openWallHeat) / safeDt,
            closedBoundaryWorkRateW: closedBoundaryWork / safeDt,
            openBoundaryWorkRateW: openBoundaryWork / safeDt,
            totalBoundaryWorkRateW:
                (closedBoundaryWork + openBoundaryWork) / safeDt,
            heatTransferCoefficientWm2K: arrayValue(
                state.cylinderHeatTransferCoefficient,
                cylinder
            ),
            heatTransferAreaM2: arrayValue(
                state.cylinderHeatTransferArea,
                cylinder
            ),
            effectiveWallTemperatureK: arrayValue(
                state.cylinderEffectiveWallTemperature,
                cylinder
            ),

            // Incréments conservatifs du sous-pas. Ils sont utilisés pour les
            // intégrales du cycle et non reconstruits depuis les taux affichés.
            heatReleaseStepJ: arrayValue(
                state.cylinderHeatReleaseStep,
                cylinder
            ),
            closedWallHeatTransferStepJ: closedWallHeat,
            openWallHeatTransferStepJ: openWallHeat,
            totalWallHeatTransferStepJ: closedWallHeat + openWallHeat,
            closedBoundaryWorkStepJ: closedBoundaryWork,
            openBoundaryWorkStepJ: openBoundaryWork,
            totalBoundaryWorkStepJ: closedBoundaryWork + openBoundaryWork,
            intakeEnthalpyTransferStepJ: arrayValue(
                state.cylinderIntakeEnthalpyTransferStep,
                cylinder
            ),
            exhaustEnthalpyTransferStepJ: arrayValue(
                state.cylinderExhaustEnthalpyTransferStep,
                cylinder
            ),
            intakeEnthalpyRateW: arrayValue(
                state.cylinderIntakeEnthalpyTransferStep,
                cylinder
            ) / safeDt,
            exhaustEnthalpyRateW: arrayValue(
                state.cylinderExhaustEnthalpyTransferStep,
                cylinder
            ) / safeDt,
            fuelMassAddedStepKg: arrayValue(
                state.cylinderFuelMassAddedStep,
                cylinder
            ),

            // Résidus du volume sélectionné
            massResidualPercent: arrayValue(
                state.cylinderMassResidualPercent,
                cylinder
            ),
            energyResidualPercent: arrayValue(
                state.cylinderEnergyResidualPercent,
                cylinder
            )
        };
    }

    // Construction et finalisation du cycle

    createCycleContainer(initialSample: CycleRecorderSample): InternalCycle {
        return {
            sequence: this.sequence,
            cylinderIndex: this.cylinderIndex,
            cylinderNumber: this.cylinderIndex + 1,
            startTime: initialSample.absoluteTime,
            endTime: initialSample.absoluteTime,
            duration: 0,
            angularStepDeg: this.angularSampleStepDeg,
            nextSampleAngleDeg: this.angularSampleStepDeg,
            samples: [],
            truncated: false,

            integrals: {
                rpmTime: 0,
                torqueTime: 0,
                powerTime: 0,
                boostTime: 0,
                intakePressureTime: 0,
                exhaustPressureTime: 0,
                ignitionTimingTime: 0,
                combustionDurationTime: 0,
                ca50ModelTime: 0,
                ca50TargetTime: 0,
                ca50TargetValidTime: 0,

                heatReleasedJ: 0,
                wallHeatTransferJ: 0,
                closedBoundaryWorkJ: 0,
                pumpingBoundaryWorkJ: 0,
                intakeEnthalpyJ: 0,
                exhaustEnthalpyJ: 0,
                fuelMassAddedKg: 0
            },

            combustionCrossings: {
                previousAngleDeg: NaN,
                previousBurnedFraction: NaN,
                ca10Deg: NaN,
                ca50Deg: NaN,
                ca90Deg: NaN
            },

            extrema: {
                peakPressurePa: 0,
                peakPressureAngleDeg: 0,
                minimumPressurePa: Number.POSITIVE_INFINITY,
                peakTemperatureK: 0,
                peakTemperatureAngleDeg: 0,
                maximumIntakeMassFlowKgS: 0,
                maximumExhaustMassFlowKgS: 0,
                maximumMassResidualPercent: 0,
                maximumEnergyResidualPercent: 0
            }
        };
    }

    appendSample(cycle: InternalCycle, sample: CycleRecorderSample, state: EngineStateData): void {
        if (cycle.samples.length >= this.maximumSamplesPerCycle) {
            cycle.truncated = true;
            return;
        }

        sample.timeFromCycleStart = Math.max(
            sample.absoluteTime - cycle.startTime,
            0
        );
        cycle.samples.push(sample);
        state.cycleRecorderSamplesCurrentCycle = cycle.samples.length;
    }

    accumulateCycleStep(cycle: InternalCycle, state: EngineStateData, dt: number, localAngleDeg: number): void {
        const cylinder = this.cylinderIndex;
        const scroll = EXHAUST_SCROLL_BY_CYLINDER[cylinder] ?? 0;
        const safeDt = Math.max(dt, NUMERIC_EPSILON);

        cycle.endTime = this.elapsedSimulationTime;
        cycle.duration += safeDt;

        const integrals = cycle.integrals!;
        integrals.rpmTime += finite(state.rpm) * safeDt;
        integrals.torqueTime += finite(state.torque) * safeDt;
        integrals.powerTime += finite(state.power) * safeDt;
        integrals.boostTime += finite(state.boost) * safeDt;
        integrals.intakePressureTime += finite(state.intakePressure) * safeDt;
        integrals.exhaustPressureTime += arrayValue(
            state.exhaustManifoldPressures,
            scroll,
            finite(state.exhaustBackPressure, 101325)
        ) * safeDt;
        integrals.ignitionTimingTime += finite(state.ignitionTimingDeg) * safeDt;
        integrals.combustionDurationTime
            += finite(state.combustionDurationDeg, 50) * safeDt;
        integrals.ca50ModelTime
            += finite(state.combustionCA50DegAfterTdc) * safeDt;
        if (Number.isFinite(state.combustionCA50TargetDegAfterTdc)) {
            integrals.ca50TargetTime
                += state.combustionCA50TargetDegAfterTdc * safeDt;
            integrals.ca50TargetValidTime += safeDt;
        }

        // CA10 / CA50 / CA90 sont mesurés sur les SOUS-PAS natifs du solveur.
        // Ce contrôle est volontairement indépendant du calcul analytique des
        // positions de Wiebe utilisé plus bas comme valeur "modèle".
        const burnedFraction = clamp(
            arrayValue(state.cylinderBurnedFraction, cylinder),
            0,
            1
        );
        const crossings = cycle.combustionCrossings!;
        const previousAngleDeg = crossings.previousAngleDeg;
        const previousBurnedFraction = crossings.previousBurnedFraction;

        if (Number.isFinite(previousAngleDeg)
            && Number.isFinite(previousBurnedFraction)
            && localAngleDeg >= previousAngleDeg) {
            for (const [key, threshold] of [
                ["ca10Deg", 0.10],
                ["ca50Deg", 0.50],
                ["ca90Deg", 0.90]
            ] as const satisfies readonly (readonly [CombustionCrossingKey, number])[]) {
                if (Number.isFinite(crossings[key])) {
                    continue;
                }
                const crossingAngleDeg = interpolateMonotonicThresholdCrossing(
                    previousAngleDeg,
                    previousBurnedFraction,
                    localAngleDeg,
                    burnedFraction,
                    threshold
                );
                if (Number.isFinite(crossingAngleDeg)) {
                    crossings[key] = crossingAngleDeg;
                }
            }
        }
        crossings.previousAngleDeg = localAngleDeg;
        crossings.previousBurnedFraction = burnedFraction;

        integrals.heatReleasedJ += arrayValue(
            state.cylinderHeatReleaseStep,
            cylinder
        );
        integrals.wallHeatTransferJ += arrayValue(
            state.cylinderWallHeatTransferStep,
            cylinder
        ) + arrayValue(
            state.cylinderOpenWallHeatTransferStep,
            cylinder
        );
        integrals.closedBoundaryWorkJ += arrayValue(
            state.cylinderBoundaryWorkStep,
            cylinder
        );
        integrals.pumpingBoundaryWorkJ += arrayValue(
            state.cylinderOpenBoundaryWorkStep,
            cylinder
        );
        integrals.intakeEnthalpyJ += arrayValue(
            state.cylinderIntakeEnthalpyTransferStep,
            cylinder
        );
        integrals.exhaustEnthalpyJ += arrayValue(
            state.cylinderExhaustEnthalpyTransferStep,
            cylinder
        );
        integrals.fuelMassAddedKg += arrayValue(
            state.cylinderFuelMassAddedStep,
            cylinder
        );

        const pressure = arrayValue(state.cylinderPressures, cylinder);
        const temperature = arrayValue(state.cylinderTemperatures, cylinder);
        const intakeFlow = arrayValue(state.intakeValveMassFlow, cylinder);
        const exhaustFlow = arrayValue(state.exhaustValveMassFlow, cylinder);
        const extrema = cycle.extrema!;

        if (pressure > extrema.peakPressurePa) {
            extrema.peakPressurePa = pressure;
            extrema.peakPressureAngleDeg = localAngleDeg;
        }
        extrema.minimumPressurePa = Math.min(
            extrema.minimumPressurePa,
            pressure
        );
        if (temperature > extrema.peakTemperatureK) {
            extrema.peakTemperatureK = temperature;
            extrema.peakTemperatureAngleDeg = localAngleDeg;
        }
        extrema.maximumIntakeMassFlowKgS = Math.max(
            extrema.maximumIntakeMassFlowKgS,
            Math.abs(intakeFlow)
        );
        extrema.maximumExhaustMassFlowKgS = Math.max(
            extrema.maximumExhaustMassFlowKgS,
            Math.abs(exhaustFlow)
        );
        extrema.maximumMassResidualPercent = Math.max(
            extrema.maximumMassResidualPercent,
            Math.abs(arrayValue(state.cylinderMassResidualPercent, cylinder))
        );
        extrema.maximumEnergyResidualPercent = Math.max(
            extrema.maximumEnergyResidualPercent,
            Math.abs(arrayValue(state.cylinderEnergyResidualPercent, cylinder))
        );
    }

    finalizeCurrentCycle(state: EngineStateData): RecordedCycleDetails | null {
        const cycle = this.currentCycle;
        this.currentCycle = null;

        if (!cycle || cycle.samples.length < 2) {
            return null;
        }

        const duration = Math.max(cycle.duration, NUMERIC_EPSILON);
        const integrals = cycle.integrals!;

        const meanIgnitionTimingDeg
            = integrals.ignitionTimingTime / duration;
        const meanCombustionDurationDeg
            = integrals.combustionDurationTime / duration;
        const meanCA50ModelDegAfterTdc
            = integrals.ca50ModelTime / duration;
        const meanCA50TargetDegAfterTdc
            = integrals.ca50TargetValidTime > NUMERIC_EPSILON
            ? integrals.ca50TargetTime / integrals.ca50TargetValidTime
            : NaN;

        const ignitionStartDeg = 360 - meanIgnitionTimingDeg;
        const ca10ModelDeg = ignitionStartDeg
            + getWiebeNormalizedPosition(0.10)
            * meanCombustionDurationDeg;
        const ca50ModelDeg = ignitionStartDeg
            + getWiebeNormalizedPosition(0.50)
            * meanCombustionDurationDeg;
        const ca90ModelDeg = ignitionStartDeg
            + getWiebeNormalizedPosition(0.90)
            * meanCombustionDurationDeg;
        const ignitionEndDeg = ignitionStartDeg
            + meanCombustionDurationDeg;

        const ca10MeasuredDeg = finite(
            cycle.combustionCrossings!.ca10Deg,
            NaN
    );
        const ca50MeasuredDeg = finite(
            cycle.combustionCrossings!.ca50Deg,
            NaN
    );
        const ca90MeasuredDeg = finite(
            cycle.combustionCrossings!.ca90Deg,
            NaN
    );
        const ca50MeasuredDegAfterTdc = Number.isFinite(ca50MeasuredDeg)
            ? ca50MeasuredDeg - 360
            : NaN;
        const ca50TargetDeg = Number.isFinite(meanCA50TargetDegAfterTdc)
            ? 360 + meanCA50TargetDegAfterTdc
            : NaN;

        const totalBoundaryWorkJ = integrals.closedBoundaryWorkJ
            + integrals.pumpingBoundaryWorkJ;
        const extrema = cycle.extrema!;

        cycle.summary = {
            durationSeconds: cycle.duration,
            sampleCount: cycle.samples.length,
            angleCoverageDeg: cycle.samples.at(-1)!.angleDeg
        - cycle.samples[0]!.angleDeg,
            meanRpm: integrals.rpmTime / duration,
            meanTorqueNm: integrals.torqueTime / duration,
            meanPowerW: integrals.powerTime / duration,
            meanBoostBarGauge: integrals.boostTime / duration,
            meanIntakePressurePa: integrals.intakePressureTime / duration,
            meanExhaustPressurePa: integrals.exhaustPressureTime / duration,
            meanIgnitionTimingDeg,
            meanCombustionDurationDeg,

            // Trois notions séparées :
            // target   = cible du contrôleur d'allumage ;
            // model    = position analytique de la loi de Wiebe ;
            // measured = franchissement réellement observé de xb = 0,5.
            meanCA50DegAfterTdc: ca50MeasuredDegAfterTdc,
            ca50TargetDegAfterTdc: meanCA50TargetDegAfterTdc,
            ca50ModelDegAfterTdc: meanCA50ModelDegAfterTdc,
            ca50MeasuredDegAfterTdc,

            heatReleasedJ: integrals.heatReleasedJ,
            wallHeatTransferJ: integrals.wallHeatTransferJ,
            closedBoundaryWorkJ: integrals.closedBoundaryWorkJ,
            pumpingBoundaryWorkJ: integrals.pumpingBoundaryWorkJ,
            totalBoundaryWorkJ,
            intakeEnthalpyJ: integrals.intakeEnthalpyJ,
            exhaustEnthalpyJ: integrals.exhaustEnthalpyJ,
            fuelMassAddedKg: integrals.fuelMassAddedKg,

            indicatedMeanTorqueContributionNm:
        totalBoundaryWorkJ / (4 * Math.PI),
            grossIndicatedMeanEffectivePressurePa:
        integrals.closedBoundaryWorkJ / SWEPT_VOLUME,
            pumpingMeanEffectivePressurePa:
        integrals.pumpingBoundaryWorkJ / SWEPT_VOLUME,
            netIndicatedMeanEffectivePressurePa:
        totalBoundaryWorkJ / SWEPT_VOLUME,

            peakPressurePa: extrema.peakPressurePa,
            peakPressureAngleDeg: extrema.peakPressureAngleDeg,
            minimumPressurePa: Number.isFinite(
            extrema.minimumPressurePa
        ) ? extrema.minimumPressurePa : 0,
            peakTemperatureK: extrema.peakTemperatureK,
            peakTemperatureAngleDeg:
        extrema.peakTemperatureAngleDeg,
            maximumIntakeMassFlowKgS:
        extrema.maximumIntakeMassFlowKgS,
            maximumExhaustMassFlowKgS:
        extrema.maximumExhaustMassFlowKgS,
            maximumMassResidualPercent:
        extrema.maximumMassResidualPercent,
            maximumEnergyResidualPercent:
        extrema.maximumEnergyResidualPercent,
            truncated: cycle.truncated
    };

        cycle.events = {
            tdcIntakeDeg: 0,
            intakeValveOpenDeg: INTAKE_VALVE_OPEN_DEG,
            bdcIntakeDeg: 180,
            intakeValveCloseDeg: INTAKE_VALVE_CLOSE_DEG,
            ignitionStartDeg,
            tdcCombustionDeg: 360,

            // CA10/50/90 désignent les franchissements mesurés de fraction brûlée.
            ca10Deg: ca10MeasuredDeg,
            ca50Deg: ca50MeasuredDeg,
            ca90Deg: ca90MeasuredDeg,

            ca10MeasuredDeg,
            ca50MeasuredDeg,
            ca90MeasuredDeg,
            ca10ModelDeg,
            ca50ModelDeg,
            ca90ModelDeg,
            ca50TargetDeg,
            ignitionEndDeg,
            exhaustValveOpenDeg: EXHAUST_VALVE_OPEN_DEG,
            bdcExpansionDeg: 540,
            exhaustValveCloseDeg: EXHAUST_VALVE_CLOSE_DEG
        };

        delete cycle.integrals;
        delete cycle.extrema;
        delete cycle.combustionCrossings;
        delete cycle.nextSampleAngleDeg;

        cycle.sequence = this.sequence++;
        this.completedCycles.push(cycle);
        while (this.completedCycles.length > this.historyCycles) {
            this.completedCycles.shift();
        }

        for (const subscriber of this.subscribers) {
            try {
                subscriber(cycle);
            } catch (error) {
                console.error("CycleRecorder subscriber error:", error);
            }
        }

        this.updateStateDiagnostics(state, cycle);
        return cycle;
    }

    resetCurrentCapture(): void {
        this.currentCycle = null;
    }

    updateStateDiagnostics(state: EngineStateData, completedCycle: RecordedCycleDetails | null = null): void {
        state.cycleRecorderEnabled = this.enabled;
        state.cycleRecorderCylinderIndex = this.cylinderIndex;
        state.cycleRecorderAngularStepDeg = this.angularSampleStepDeg;
        state.cycleRecorderCaptureIntervalMs
            = this.captureIntervalSeconds * 1000;
        state.cycleRecorderBufferedCycles = this.completedCycles.length;
        state.cycleRecorderCompletedCycles = this.sequence;
        state.cycleRecorderSamplesCurrentCycle = this.currentCycle
            ? this.currentCycle.samples.length
            : 0;

        const latest = completedCycle || this.getLatestCycle();
        if (!latest?.summary) {
            return;
        }

        state.cycleRecorderLatestCycleRpm = latest.summary.meanRpm;
        state.cycleRecorderLatestCycleDurationMs
            = latest.summary.durationSeconds * 1000;
        state.cycleRecorderLatestSampleCount = latest.summary.sampleCount;
        state.cycleRecorderLatestPeakPressureBar
            = latest.summary.peakPressurePa / 100000;
        state.cycleRecorderLatestPeakPressureAngleDeg
            = latest.summary.peakPressureAngleDeg;
        state.cycleRecorderLatestHeatReleasedJ
            = latest.summary.heatReleasedJ;
        state.cycleRecorderLatestWallHeatLossJ
            = latest.summary.wallHeatTransferJ;
        state.cycleRecorderLatestClosedWorkJ
            = latest.summary.closedBoundaryWorkJ;
        state.cycleRecorderLatestPumpingWorkJ
            = latest.summary.pumpingBoundaryWorkJ;
        state.cycleRecorderLatestNetIndicatedWorkJ
            = latest.summary.totalBoundaryWorkJ;
    }
}