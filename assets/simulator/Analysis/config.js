import { DEFAULT_TELEMETRY_CHANNELS } from "../Telemetry/TelemetryRecorder.js";
import { CYLINDER_OFFSETS, getCylinderVolume } from "../Geometry/Geometry.js";

const HORSEPOWER_WATTS = 735.49875;
const PASCAL_TO_BAR = 1e-5;
const M3_TO_CM3 = 1e6;
const FULL_CYCLE_DEG = 720;
const CYLINDER_COUNT = CYLINDER_OFFSETS.length;
const SESSION_STORAGE_KEY = "3sgte.analysisSnapshot.v1";
const SAVED_SESSIONS_KEY = "3sgte.savedAnalysisSessions.v2";
const MAX_SAVED_SESSIONS = 8;
const MAX_DYNO_RPM = 7000;
const TELEMETRY_DISPLAY_SECONDS = 30;
const MAX_TELEMETRY_POINTS = 600;
const MINIMUM_LOG_VALUE = 1e-12;
const PV_MIN_VOLUME_CM3 = getCylinderVolume(0) * M3_TO_CM3;
const PV_MAX_VOLUME_CM3 = getCylinderVolume(Math.PI) * M3_TO_CM3;
const DEG_TO_RAD = Math.PI / 180;

const PHYSICS_CHUNK_SECONDS = 0.004;
const MAX_PHYSICS_CHUNKS_PER_FRAME = 8;
const MAX_PHYSICS_BUDGET_MS = 8.5;
const MAX_ACCUMULATED_TIME = 0.05;
const CHART_REFRESH_INTERVAL_MS = 250;
const HEADER_REFRESH_INTERVAL_MS = 150;

const REFERENCE_PROTOCOL = Object.freeze({
    physicsCallStepSeconds: 0.004,
    browserYieldBudgetMs: 12,
    maximumStartSeconds: 8,
    idleStabilizationSeconds: 1.0,
    throttleRampSeconds: 1.25,
    maximumSweepSeconds: 30,
    sweepStopRpm: 6950,
    validationTargetRpm: 4000,
    validationThrottle: 1,
    validationMaximumSeconds: 10,
    repeatabilityCycleCount: 6,
    convergenceStepsDeg: Object.freeze([1, 0.5, 0.25])
});

const MULTI_POINT_PROTOCOL = Object.freeze({
    stabilityWindowCycles: 4,
    capturedCyclesPerPoint: 4,

    // Les cylindres se stabilisent en quelques cycles, mais le turbo, les
    // collecteurs et les parois évoluent sur une échelle beaucoup plus lente.
    // Une fenêtre de quatre cycles seule pouvait donc accepter un faux plateau
    // pré-spool à 3 500 tr/min.
    minimumSettlingSeconds: 2.5,
    slowStabilityWindowSeconds: 1.5,
    maximumPointSeconds: 16,

    stabilityCvPercentPass: 0.20,
    stabilityCvPercentWarning: 0.50,
    rpmTrackingErrorPercentPass: 1.0,
    rpmTrackingErrorPercentWarning: 2.5,
    massResidualPercentPass: 1e-5,
    massResidualPercentWarning: 1e-2,
    energyResidualPercentPass: 1e-3,
    energyResidualPercentWarning: 1e-2,
    boostSpanBarPass: 0.01,
    boostSpanBarWarning: 0.03,
    boostSlopeBarPerSecondPass: 0.01,
    boostSlopeBarPerSecondWarning: 0.03,
    turboRpmSpanPercentPass: 0.50,
    turboRpmSpanPercentWarning: 2.00,

    points: Object.freeze([
        Object.freeze({
            id: "idle-900",
            label: "Ralenti",
            targetRpm: 900,
            throttle: 0,
            minimumSettlingSeconds: 2.5,
            description: "Régulation de ralenti, faible remplissage et pompage."
        }),
        Object.freeze({
            id: "partial-2000",
            label: "Charge légère",
            targetRpm: 2000,
            throttle: 0.25,
            minimumSettlingSeconds: 3.0,
            description: "Admission partiellement étranglée et faibles débits."
        }),
        Object.freeze({
            id: "medium-3000",
            label: "Charge intermédiaire",
            targetRpm: 3000,
            throttle: 0.50,
            minimumSettlingSeconds: 4.0,
            description: "Point stabilisé avant la zone de forte suralimentation."
        }),
        Object.freeze({
            id: "full-3500",
            label: "Pleine charge — 3 500 tr/min",
            targetRpm: 3500,
            throttle: 1,
            minimumSettlingSeconds: 8.0,
            description: "Point pleine charge stabilisé proche de la zone de spool. Le spool transitoire doit être évalué séparément."
        }),
        Object.freeze({
            id: "full-4000",
            label: "Pleine charge — référence",
            targetRpm: 4000,
            throttle: 1,
            minimumSettlingSeconds: 7.0,
            description: "Point pleine charge recalculé avec le même protocole que les autres points."
        }),
        Object.freeze({
            id: "full-5500",
            label: "Pleine charge — puissance",
            targetRpm: 5500,
            throttle: 1,
            minimumSettlingSeconds: 5.0,
            description: "Débit élevé, pertes mécaniques et puissance turbine."
        }),
        Object.freeze({
            id: "full-6500",
            label: "Pleine charge — haut régime",
            targetRpm: 6500,
            throttle: 1,
            minimumSettlingSeconds: 5.0,
            description: "Stabilité numérique proche de la zone de puissance maximale."
        })
    ])
});

const TRANSIENT_PROTOCOL = Object.freeze({
    spoolPointId: "full-3500",
    liftOffPointId: "full-4000",
    wastegatePointId: "full-5500",
    revLimiterPointId: "full-6500",

    liftOffSeconds: 2.0,
    reapplicationSeconds: 3.0,
    reapplicationRampSeconds: 0.15,
    revLimiterMaximumSeconds: 4.0,

    spoolStartBoostBar: 0.10,
    spoolTargetBoostBar: 0.65,
    reapplicationTargetBoostBar: 0.50,
    boostReleasedThresholdBar: 0.10,
    bypassOpenThreshold: 0.80,
    bypassClosedThreshold: 0.10,
    wastegateOpenThreshold: 0.05,
    wastegateInitialClosedMaximum: 0.01,

    spoolCommandToTargetSecondsPass: 8.0,
    spoolCommandToTargetSecondsWarning: 10.0,
    spoolRiseSecondsPass: 3.5,
    spoolRiseSecondsWarning: 5.0,
    maximumBoostBarPass: 0.95,
    maximumBoostBarWarning: 1.10,
    maximumTurboRpmPass: 165000,
    maximumTurboRpmWarning: 185000,

    wastegateResponseSecondsPass: 0.20,
    wastegateResponseSecondsWarning: 0.50,
    wastegateMinimumMassFlowKgS: 0.005,

    bypassOpeningSecondsPass: 0.20,
    bypassOpeningSecondsWarning: 0.50,
    boostReleaseSecondsPass: 0.50,
    boostReleaseSecondsWarning: 1.00,
    fuelCutSecondsPass: 0.20,
    fuelCutSecondsWarning: 0.50,
    finalFuelConsumptionLhPass: 0.05,
    finalFuelConsumptionLhWarning: 0.50,

    bypassClosingSecondsPass: 0.25,
    bypassClosingSecondsWarning: 0.60,
    boostRecoverySecondsPass: 2.0,
    boostRecoverySecondsWarning: 4.0,

    revLimiterActivationSecondsPass: 0.02,
    revLimiterActivationSecondsWarning: 0.10,
    revLimiterResumeSecondsPass: 3.5,
    revLimiterResumeSecondsWarning: 4.0,
    maximumEngineRpmPass: 7100,
    maximumEngineRpmWarning: 7300,

    massResidualPercentPass: 1e-5,
    massResidualPercentWarning: 1e-2,
    energyResidualPercentPass: 1e-3,
    energyResidualPercentWarning: 1e-2
});

const ANALYSIS_CHANNELS = Object.freeze([
    ...DEFAULT_TELEMETRY_CHANNELS,
    Object.freeze({
        key: "cumulativeAbsoluteMassResidual",
        aggregation: "last",
        select: state => state.cumulativeAbsoluteMassResidual
    }),
    Object.freeze({
        key: "cumulativeAbsoluteEnergyResidual",
        aggregation: "last",
        select: state => state.cumulativeAbsoluteEnergyResidual
    })
]);

const TRANSIENT_TELEMETRY_KEYS = new Set([
    "rpm",
    "throttle",
    "torque",
    "netCrankshaftTorque",
    "boost",
    "chargeAirPressure",
    "turboRPM",
    "turboAngularAcceleration",
    "wastegatePosition",
    "wastegateMassFlow",
    "effectiveBoostTargetGaugePressure",
    "compressorBypassValvePosition",
    "compressorBypassMassFlow",
    "revLimiterActive",
    "fuelCutActive",
    "instantFuelConsumptionLh",
    "maximumMassResidualPercent",
    "maximumEnergyResidualPercent"
]);

const TRANSIENT_TELEMETRY_CHANNELS = Object.freeze(
    ANALYSIS_CHANNELS.filter(channel =>
        TRANSIENT_TELEMETRY_KEYS.has(channel.key)
    )
);


export {
    HORSEPOWER_WATTS,
    PASCAL_TO_BAR,
    M3_TO_CM3,
    FULL_CYCLE_DEG,
    CYLINDER_COUNT,
    SESSION_STORAGE_KEY,
    SAVED_SESSIONS_KEY,
    MAX_SAVED_SESSIONS,
    MAX_DYNO_RPM,
    TELEMETRY_DISPLAY_SECONDS,
    MAX_TELEMETRY_POINTS,
    MINIMUM_LOG_VALUE,
    PV_MIN_VOLUME_CM3,
    PV_MAX_VOLUME_CM3,
    DEG_TO_RAD,
    PHYSICS_CHUNK_SECONDS,
    MAX_PHYSICS_CHUNKS_PER_FRAME,
    MAX_PHYSICS_BUDGET_MS,
    MAX_ACCUMULATED_TIME,
    CHART_REFRESH_INTERVAL_MS,
    HEADER_REFRESH_INTERVAL_MS,
    REFERENCE_PROTOCOL,
    MULTI_POINT_PROTOCOL,
    TRANSIENT_PROTOCOL,
    ANALYSIS_CHANNELS,
    TRANSIENT_TELEMETRY_KEYS,
    TRANSIENT_TELEMETRY_CHANNELS
};
