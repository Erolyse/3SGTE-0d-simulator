// Réduction passive des sous-pas physiques vers une fréquence fixe d'affichage.
// Les moyennes sont pondérées par le temps et les sous-pas sont répartis aux
// frontières de fenêtre sans réinjecter la télémétrie dans la physique.

export const DEFAULT_TELEMETRY_RATE_HZ = 30;
export const DEFAULT_TELEMETRY_HISTORY_SECONDS = 30;
export const DEFAULT_TELEMETRY_INPUT_RATE_HZ = 2000;

const AGGREGATION_MODES = Object.freeze({
    AVERAGE: "average",
    LAST: "last",
    MINIMUM: "minimum",
    MAXIMUM: "maximum",
    RMS: "rms",
    INTEGRAL: "integral"
});

export { AGGREGATION_MODES };

function clampFinite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function arrayValue(array, index, fallback = 0) {
    return Array.isArray(array)
        ? clampFinite(array[index], fallback)
        : fallback;
}

function sumFiniteArray(array) {
    if (!Array.isArray(array)) {
        return 0;
    }

    return array.reduce(
        (sum, value) => sum + clampFinite(value, 0),
        0
    );
}

function maxFiniteArray(array) {
    if (!Array.isArray(array)) {
        return 0;
    }

    return array.reduce(
        (maximum, value) => Math.max(
            maximum,
            Math.abs(clampFinite(value, 0))
        ),
        0
    );
}

function radiansToDegrees(radians) {
    return clampFinite(radians, 0) * 180 / Math.PI;
}

function createChannel(
    key,
    select,
    aggregation = AGGREGATION_MODES.AVERAGE
) {
    return Object.freeze({ key, select, aggregation });
}

// Canaux temps réel par défaut
// Canaux temporels du dashboard. Les diagrammes pression-angle et P-V utilisent
// CycleRecorder afin de conserver la résolution angulaire native.

export const DEFAULT_TELEMETRY_CHANNELS = Object.freeze([
    // Cinématique et commande
    createChannel("rpm", state => state.rpm),
    createChannel("crankAngleDeg", state => radiansToDegrees(state.crankAngle), AGGREGATION_MODES.LAST),
    createChannel("throttle", state => state.throttle),
    createChannel("vehicleSpeedKmh", state => state.vehicleSpeedKmh),
    createChannel("crankshaftAngularAcceleration", state => state.crankshaftAngularAcceleration),

    // Couple et puissance moteur
    createChannel("torque", state => state.torque),
    createChannel("power", state => state.power),
    createChannel("indicatedTorque", state => state.indicatedTorque),
    createChannel("closedCycleIndicatedTorque", state => state.closedCycleIndicatedTorque),
    createChannel("pumpingTorque", state => state.pumpingTorque),
    createChannel("mechanicalFrictionTorque", state => state.mechanicalFrictionTorque),
    createChannel("accessoryTorque", state => state.accessoryTorque),
    createChannel("mechanicalLossTorque", state => state.mechanicalLossTorque),
    createChannel("drivelineLossTorque", state => state.drivelineLossTorque),
    createChannel("netCrankshaftTorque", state => state.netCrankshaftTorque),
    createChannel("wheelTorque", state => state.wheelTorque),
    createChannel("wheelPower", state => state.wheelPower),

    // Puissances de bilan haute vitesse
    createChannel("closedCycleIndicatedPower", state => state.closedCycleIndicatedPower),
    createChannel("indicatedPower", state => state.indicatedPower),
    createChannel("pumpingLossPower", state => state.pumpingLossPower),
    createChannel("mechanicalLossPower", state => state.mechanicalLossPower),
    createChannel("drivelineLossPower", state => state.drivelineLossPower),

    // Fermeture des bilans de conservation. Les pourcentages utilisent le
    // maximum observé dans la fenêtre de 1/60 s afin de ne pas masquer un pic
    // local par une moyenne temporelle proche de zéro.
    createChannel(
        "maximumMassResidualPercent",
        state => state.maximumMassResidualPercent,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "maximumEnergyResidualPercent",
        state => state.maximumEnergyResidualPercent,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "globalMassResidualPercent",
        state => state.globalMassResidualPercent,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "globalEnergyResidualPercent",
        state => state.globalEnergyResidualPercent,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel("globalMassResidualRate", state => state.globalMassResidualRate),
    createChannel("globalEnergyResidualRate", state => state.globalEnergyResidualRate),
    createChannel("globalMassRawResidualRate", state => state.globalMassRawResidualRate),
    createChannel("globalEnergyRawResidualRate", state => state.globalEnergyRawResidualRate),
    createChannel("globalMassCorrectionRate", state => state.globalMassCorrectionRate),
    createChannel("globalEnergyCorrectionRate", state => state.globalEnergyCorrectionRate),
    createChannel(
        "cylinderMassResidualMaxPercent",
        state => maxFiniteArray(state.cylinderMassResidualPercent),
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "cylinderEnergyResidualMaxPercent",
        state => maxFiniteArray(state.cylinderEnergyResidualPercent),
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "intakeManifoldMassResidualPercent",
        state => state.intakeManifoldMassResidualPercent,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "intakeManifoldEnergyResidualPercent",
        state => state.intakeManifoldEnergyResidualPercent,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "chargeAirMassResidualPercent",
        state => state.chargeAirMassResidualPercent,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "chargeAirEnergyResidualPercent",
        state => state.chargeAirEnergyResidualPercent,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "exhaustScrollMassResidualMaxPercent",
        state => maxFiniteArray(state.exhaustScrollMassResidualPercent),
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "exhaustScrollEnergyResidualMaxPercent",
        state => maxFiniteArray(state.exhaustScrollEnergyResidualPercent),
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "exhaustWallEnergyResidualMaxPercent",
        state => maxFiniteArray(state.exhaustWallEnergyResidualPercent),
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "throttleInterfaceMassMismatchRate",
        state => state.throttleInterfaceMassMismatchRate
    ),
    createChannel(
        "throttleInterfaceEnergyMismatchRate",
        state => state.throttleInterfaceEnergyMismatchRate
    ),

    // Admission et suralimentation
    createChannel("intakePressure", state => state.intakePressure),
    createChannel("intakeTemperature", state => state.intakeTemperature),
    createChannel("boost", state => state.boost),
    createChannel("chargeAirPressure", state => state.chargeAirPressure),
    createChannel("chargeAirTemperature", state => state.chargeAirTemperature),
    createChannel("intakeAirMassFlow", state => state.intakeAirMassFlow),
    createChannel("compressorMassFlow", state => state.compressorMassFlow),

    // Pressions cylindre : moyenne pour le dashboard + maximum de la fenêtre
    // pour ne pas masquer complètement les pointes de combustion à 60 Hz.
    ...Array.from({ length: 4 }, (_, index) => [
        createChannel(
            `cylinderPressure${index + 1}`,
            state => arrayValue(state.cylinderPressures, index)
        ),
        createChannel(
            `cylinderPressure${index + 1}Max`,
            state => arrayValue(state.cylinderPressures, index),
            AGGREGATION_MODES.MAXIMUM
        )
    ]).flat(),

    // Échappement
    createChannel("exhaustBackPressure", state => state.exhaustBackPressure),
    createChannel("exhaustGasTemperature", state => state.exhaustGasTemperature),
    createChannel("egtSensorTemperature", state => state.egtSensorTemperature),
    createChannel("exhaustWallTemperature", state => state.exhaustWallTemperature),
    createChannel("exhaustMassFlow", state => state.exhaustMassFlow),
    createChannel("exhaustReverseMassFlow", state => state.exhaustReverseMassFlow),
    createChannel("exhaustScroll1Pressure", state => arrayValue(state.exhaustManifoldPressures, 0)),
    createChannel("exhaustScroll2Pressure", state => arrayValue(state.exhaustManifoldPressures, 1)),
    createChannel("exhaustScroll1Temperature", state => arrayValue(state.exhaustManifoldTemperatures, 0, 293)),
    createChannel("exhaustScroll2Temperature", state => arrayValue(state.exhaustManifoldTemperatures, 1, 293)),

    // Turbo : moyennes physiques sur 1/60 s et maximum instantané de fenêtre.
    createChannel("turboRPM", state => state.turboRPM),
    createChannel("turboAngularAcceleration", state => state.turboAngularAcceleration),
    createChannel("turbineAvailablePower", state => state.totalExhaustAvailableTurbinePower),
    createChannel(
        "turbineAvailablePowerMax",
        state => state.totalExhaustAvailableTurbinePower,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel("turbinePower", state => state.turbinePower),
    createChannel("compressorPower", state => state.compressorPower),
    createChannel("compressorFluidPower", state => state.compressorFluidPower),
    createChannel(
        "compressorAerodynamicLossPower",
        state => state.compressorAerodynamicLossPower
    ),
    createChannel("turboBearingFrictionPower", state => state.turboBearingFrictionPower),
    createChannel("turboNetPower", state => state.turboNetPower),
    createChannel("turboNetTorque", state => state.turboNetTorque),
    createChannel("compressorPressureRatio", state => state.compressorPressureRatio),
    createChannel(
        "compressorRawPressureRatioCapability",
        state => state.compressorRawPressureRatioCapability
    ),
    createChannel("compressorEfficiency", state => state.compressorEfficiency),
    createChannel(
        "compressorCorrectedMassFlow",
        state => state.compressorCorrectedMassFlow
    ),
    createChannel(
        "compressorCorrectedFlowCoefficient",
        state => state.compressorCorrectedFlowCoefficient
    ),
    createChannel(
        "compressorChokeFraction",
        state => state.compressorChokeFraction,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel("compressorTipMach", state => state.compressorTipMach),
    createChannel(
        "compressorTipMachLossFraction",
        state => state.compressorTipMachLossFraction,
        AGGREGATION_MODES.MAXIMUM
    ),
    createChannel(
        "compressorEffectiveLoadingCoefficient",
        state => state.compressorEffectiveLoadingCoefficient
    ),
    createChannel("wastegatePosition", state => state.wastegatePosition),
    createChannel(
        "effectiveBoostTargetGaugePressure",
        state => state.effectiveBoostTargetGaugePressure
    ),
    createChannel("wastegateMassFlow", state => sumFiniteArray(state.wastegateMassFlow)),
    createChannel("compressorBypassValvePosition", state => state.compressorBypassValvePosition),
    createChannel("compressorBypassMassFlow", state => state.compressorBypassMassFlow),
    createChannel("intercoolerEffectiveness", state => state.intercoolerEffectiveness),

    // Carburant et gestion moteur
    createChannel("instantFuelConsumptionLh", state => state.instantFuelConsumptionLh),
    createChannel("avgConsumptionL100km", state => state.avgConsumptionL100km, AGGREGATION_MODES.LAST),
    createChannel("afr", state => state.afr),
    createChannel("ignitionTimingDeg", state => state.ignitionTimingDeg),
    createChannel(
        "combustionPhasingIgnitionLimitDeg",
        state => state.combustionPhasingIgnitionLimitDeg
    ),
    createChannel(
        "ignitionPhasingLimited",
        state => state.ignitionPhasingLimited,
        AGGREGATION_MODES.LAST
    ),
    createChannel("combustionDurationDeg", state => state.combustionDurationDeg),
    createChannel("combustionCA50DegAfterTdc", state => state.combustionCA50DegAfterTdc),
    createChannel(
        "intakeValveDischargeCoefficient",
        state => state.intakeValveDischargeCoefficient
    ),
    createChannel(
        "exhaustValveDischargeCoefficient",
        state => state.exhaustValveDischargeCoefficient
    ),

    // États discrets : dernière valeur observée dans la fenêtre.
    createChannel("engineOperatingState", state => state.engineOperatingState, AGGREGATION_MODES.LAST),
    createChannel("engineRunning", state => state.engineRunning, AGGREGATION_MODES.LAST),
    createChannel("starterActive", state => state.starterActive, AGGREGATION_MODES.LAST),
    createChannel("revLimiterActive", state => state.revLimiterActive, AGGREGATION_MODES.LAST),
    createChannel("fuelCutActive", state => state.fuelCutActive, AGGREGATION_MODES.LAST),
    createChannel("idleAirControlCommand", state => state.idleAirControlCommand),
    createChannel("dynoCouplingFactor", state => state.dynoCouplingFactor),
    createChannel("totalEquivalentInertia", state => state.totalEquivalentInertia),
    createChannel("roadLoadTorque", state => state.roadLoadTorque),
    createChannel("dynoBrakeTorqueAtCrank", state => state.dynoBrakeTorqueAtCrank),
    createChannel("dynoCoastdownBrakeTorqueAtCrank", state => state.dynoCoastdownBrakeTorqueAtCrank)
]);

// Profil temps réel : uniquement les canaux réellement consommés par le
// dashboard, les graphiques et l'enregistreur de tir. Le profil scientifique
// complet reste disponible via DEFAULT_TELEMETRY_CHANNELS.
const REALTIME_TELEMETRY_KEYS = new Set([
    "rpm", "crankAngleDeg", "throttle", "vehicleSpeedKmh",
    "crankshaftAngularAcceleration", "torque", "power",
    "closedCycleIndicatedTorque", "pumpingTorque",
    "mechanicalFrictionTorque", "accessoryTorque", "wheelTorque",
    "wheelPower", "maximumMassResidualPercent",
    "maximumEnergyResidualPercent", "intakePressure", "boost",
    "chargeAirPressure", "chargeAirTemperature", "compressorMassFlow",
    "cylinderPressure1Max", "cylinderPressure2Max",
    "cylinderPressure3Max", "cylinderPressure4Max",
    "exhaustBackPressure", "exhaustGasTemperature",
    "egtSensorTemperature", "exhaustWallTemperature", "exhaustMassFlow",
    "exhaustReverseMassFlow", "exhaustScroll1Pressure",
    "exhaustScroll2Pressure", "exhaustScroll1Temperature",
    "exhaustScroll2Temperature", "turboRPM", "turbineAvailablePower",
    "turbinePower", "compressorPower", "turboBearingFrictionPower",
    "turboNetPower", "turboNetTorque", "compressorPressureRatio",
    "compressorEfficiency", "wastegatePosition", "wastegateMassFlow",
    "compressorBypassValvePosition", "intercoolerEffectiveness",
    "instantFuelConsumptionLh", "avgConsumptionL100km",
    "engineOperatingState", "engineRunning", "starterActive",
    "revLimiterActive", "fuelCutActive", "idleAirControlCommand",
    "dynoCouplingFactor", "totalEquivalentInertia", "roadLoadTorque"
]);

export const REALTIME_TELEMETRY_CHANNELS = Object.freeze(
    DEFAULT_TELEMETRY_CHANNELS.filter(channel =>
        REALTIME_TELEMETRY_KEYS.has(channel.key)
    )
);

function createAccumulator(channel) {
    return {
        channel,
        weightedSum: 0,
        squaredWeightedSum: 0,
        weight: 0,
        integral: 0,
        minimum: Number.POSITIVE_INFINITY,
        maximum: Number.NEGATIVE_INFINITY,
        lastValue: null,
        hasValue: false,
        hasReportedError: false
    };
}

function resetAccumulator(accumulator) {
    accumulator.weightedSum = 0;
    accumulator.squaredWeightedSum = 0;
    accumulator.weight = 0;
    accumulator.integral = 0;
    accumulator.minimum = Number.POSITIVE_INFINITY;
    accumulator.maximum = Number.NEGATIVE_INFINITY;
    accumulator.lastValue = null;
    accumulator.hasValue = false;
}

function accumulateValue(accumulator, rawValue, dt) {
    const mode = accumulator.channel.aggregation;

    // LAST accepte volontairement les chaînes et booléens, contrairement aux
    // autres modes qui demandent une grandeur numérique finie.
    if (mode === AGGREGATION_MODES.LAST) {
        if (rawValue !== undefined && rawValue !== null) {
            accumulator.lastValue = rawValue;
            accumulator.hasValue = true;
        }
        return;
    }

    if (!Number.isFinite(rawValue)) {
        return;
    }

    accumulator.hasValue = true;
    accumulator.lastValue = rawValue;
    accumulator.minimum = Math.min(accumulator.minimum, rawValue);
    accumulator.maximum = Math.max(accumulator.maximum, rawValue);

    switch (mode) {
        case AGGREGATION_MODES.MINIMUM:
        case AGGREGATION_MODES.MAXIMUM:
            break;

        case AGGREGATION_MODES.RMS:
            accumulator.squaredWeightedSum += rawValue * rawValue * dt;
            accumulator.weight += dt;
            break;

        case AGGREGATION_MODES.INTEGRAL:
            accumulator.integral += rawValue * dt;
            break;

        case AGGREGATION_MODES.AVERAGE:
        default:
            accumulator.weightedSum += rawValue * dt;
            accumulator.weight += dt;
            break;
    }
}

function finalizeAccumulator(accumulator) {
    if (!accumulator.hasValue) {
        return null;
    }

    switch (accumulator.channel.aggregation) {
        case AGGREGATION_MODES.LAST:
            return accumulator.lastValue;

        case AGGREGATION_MODES.MINIMUM:
            return accumulator.minimum;

        case AGGREGATION_MODES.MAXIMUM:
            return accumulator.maximum;

        case AGGREGATION_MODES.RMS:
            return accumulator.weight > 0
                ? Math.sqrt(
                    accumulator.squaredWeightedSum / accumulator.weight
                )
                : null;

        case AGGREGATION_MODES.INTEGRAL:
            return accumulator.integral;

        case AGGREGATION_MODES.AVERAGE:
        default:
            return accumulator.weight > 0
                ? accumulator.weightedSum / accumulator.weight
                : accumulator.lastValue;
    }
}

// Buffer circulaire

class CircularSampleBuffer {
    constructor(capacity) {
        if (!Number.isInteger(capacity) || capacity <= 0) {
            throw new RangeError(
                "La capacité du buffer de télémétrie doit être positive."
            );
        }

        this.capacity = capacity;
        this.storage = new Array(capacity);
        this.writeIndex = 0;
        this.size = 0;
    }

    push(sample) {
        this.storage[this.writeIndex] = sample;
        this.writeIndex = (this.writeIndex + 1) % this.capacity;
        this.size = Math.min(this.size + 1, this.capacity);
    }

    clear() {
        this.storage.fill(undefined);
        this.writeIndex = 0;
        this.size = 0;
    }

    toArray() {
        const result = new Array(this.size);
        const start = (
            this.writeIndex - this.size + this.capacity
        ) % this.capacity;

        for (let i = 0; i < this.size; i++) {
            result[i] = this.storage[(start + i) % this.capacity];
        }

        return result;
    }

    latest() {
        if (this.size === 0) {
            return null;
        }

        const index = (
            this.writeIndex - 1 + this.capacity
        ) % this.capacity;

        return this.storage[index] ?? null;
    }

    samplesAfter(sequence = -1) {
        const result = [];
        const start = (
            this.writeIndex - this.size + this.capacity
        ) % this.capacity;

        for (let i = 0; i < this.size; i++) {
            const sample = this.storage[(start + i) % this.capacity];
            if (sample && sample.sequence > sequence) {
                result.push(sample);
            }
        }

        return result;
    }
}

// Enregistreur

export default class TelemetryRecorder {
    constructor({
                    outputRateHz = DEFAULT_TELEMETRY_RATE_HZ,
                    historySeconds = DEFAULT_TELEMETRY_HISTORY_SECONDS,
                    channels = DEFAULT_TELEMETRY_CHANNELS,
                    inputRateHz = DEFAULT_TELEMETRY_INPUT_RATE_HZ,
                    enabled = true
                } = {}) {
        if (!Number.isFinite(outputRateHz) || outputRateHz <= 0) {
            throw new RangeError(
                "La fréquence de télémétrie doit être strictement positive."
            );
        }

        if (!Number.isFinite(historySeconds) || historySeconds <= 0) {
            throw new RangeError(
                "La durée d'historique doit être strictement positive."
            );
        }

        if (!Number.isFinite(inputRateHz) || inputRateHz <= 0) {
            throw new RangeError(
                "La fréquence d'échantillonnage interne doit être positive."
            );
        }

        if (!Array.isArray(channels) || channels.length === 0) {
            throw new TypeError(
                "TelemetryRecorder demande au moins un canal."
            );
        }

        const duplicateKeys = channels
            .map(channel => channel.key)
            .filter((key, index, keys) => keys.indexOf(key) !== index);

        if (duplicateKeys.length > 0) {
            throw new Error(
                `Canaux de télémétrie dupliqués : ${duplicateKeys.join(", ")}`
            );
        }

        this.outputRateHz = outputRateHz;
        this.samplePeriod = 1 / outputRateHz;
        this.historySeconds = historySeconds;
        this.channels = channels;
        this.inputRateHz = Math.max(inputRateHz, outputRateHz);
        this.inputSamplePeriod = 1 / this.inputRateHz;
        this.enabled = Boolean(enabled);

        const capacity = Math.max(
            Math.ceil(outputRateHz * historySeconds),
            1
        );

        this.buffer = new CircularSampleBuffer(capacity);
        this.accumulators = channels.map(createAccumulator);
        this.listeners = new Set();

        this.simulationTime = 0;
        this.windowElapsedTime = 0;
        this.inputElapsedTime = 0;
        this.sequence = 0;
        this.totalSamplesProduced = 0;
    }

    get size() {
        return this.buffer.size;
    }

    get capacity() {
        return this.buffer.capacity;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);

        // Une fenêtre partielle est annulée lors d'une pause d'acquisition.
        if (!this.enabled) {
            this.resetCurrentWindow();
        }
    }

    resetCurrentWindow() {
        this.windowElapsedTime = 0;
        this.inputElapsedTime = 0;
        this.accumulators.forEach(resetAccumulator);
    }

    clear({ resetTime = false } = {}) {
        this.buffer.clear();
        this.resetCurrentWindow();
        this.sequence = 0;
        this.totalSamplesProduced = 0;

        if (resetTime) {
            this.simulationTime = 0;
        }
    }

    subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError(
                "Le listener de télémétrie doit être une fonction."
            );
        }

        this.listeners.add(listener);

        // Fonction pratique de désabonnement.
        return () => {
            this.listeners.delete(listener);
        };
    }

    getLatestSample() {
        return this.buffer.latest();
    }

    getHistory() {
        return this.buffer.toArray();
    }

    /**
     * Retourne les échantillons postérieurs à une séquence donnée.
     *
     * Chaque graphique peut conserver son propre curseur, donc plusieurs
     * consommateurs Chart.js peuvent lire le même recorder sans se voler les
     * données comme avec une file `consume()` destructive.
     */
    getSamplesAfter(sequence = -1) {
        return this.buffer.samplesAfter(sequence);
    }

    recordSubstep(state, dt) {
        if (!Number.isFinite(dt) || dt <= 0) {
            return 0;
        }

        if (!this.enabled) {
            this.simulationTime += dt;
            return 0;
        }

        // Les sous-pas peuvent descendre à quelques dizaines de µs ; les durées
        // sont regroupées pour limiter l'échantillonnage à inputRateHz.
        this.inputElapsedTime += dt;

        if (this.inputElapsedTime + 1e-12 < this.inputSamplePeriod) {
            return 0;
        }

        const observedDuration = this.inputElapsedTime;
        this.inputElapsedTime = 0;
        return this.recordObservedState(state, observedDuration);
    }

    recordObservedState(state, duration) {
        let remainingTime = duration;
        let emittedSamples = 0;
        const epsilon = 1e-12;

        while (remainingTime > epsilon) {
            const availableInWindow = Math.max(
                this.samplePeriod - this.windowElapsedTime,
                0
            );
            const chunkDuration = Math.min(
                remainingTime,
                availableInWindow > epsilon
                    ? availableInWindow
                    : remainingTime
            );

            for (let index = 0; index < this.accumulators.length; index++) {
                const accumulator = this.accumulators[index];
                let value = null;

                try {
                    value = accumulator.channel.select(state);
                } catch (error) {
                    if (!accumulator.hasReportedError) {
                        console.error(
                            `Erreur dans le canal de télémétrie "${accumulator.channel.key}".`,
                            error
                        );
                        accumulator.hasReportedError = true;
                    }
                }

                accumulateValue(accumulator, value, chunkDuration);
            }

            this.windowElapsedTime += chunkDuration;
            this.simulationTime += chunkDuration;
            remainingTime -= chunkDuration;

            if (this.windowElapsedTime + epsilon >= this.samplePeriod) {
                this.emitCurrentWindow();
                emittedSamples++;
            }
        }

        return emittedSamples;
    }

    emitCurrentWindow() {
        const sample = {
            sequence: this.sequence,
            time: this.simulationTime,
            duration: this.samplePeriod,
            sampleRateHz: this.outputRateHz
        };

        for (const accumulator of this.accumulators) {
            sample[accumulator.channel.key] = finalizeAccumulator(
                accumulator
            );
        }

        this.buffer.push(sample);
        this.sequence++;
        this.totalSamplesProduced++;

        for (const listener of this.listeners) {
            try {
                listener(sample, this);
            } catch (error) {
                // Un graphique défaillant ne doit jamais arrêter la physique.
                console.error(
                    "Erreur dans un listener de télémétrie.",
                    error
                );
            }
        }

        this.resetCurrentWindow();
    }

    exportJson({ pretty = true } = {}) {
        return JSON.stringify(
            this.getHistory(),
            null,
            pretty ? 2 : 0
        );
    }

    exportCsv(keys = null) {
        const samples = this.getHistory();

        if (samples.length === 0) {
            return "";
        }

        const selectedKeys = Array.isArray(keys) && keys.length > 0
            ? ["sequence", "time", ...keys]
            : Object.keys(samples[0]);

        const escapeCell = value => {
            if (value === null || value === undefined) {
                return "";
            }

            const text = String(value);

            if (/[",\n]/.test(text)) {
                return `"${text.replaceAll('"', '""')}"`;
            }

            return text;
        };

        const rows = [selectedKeys.join(",")];

        for (const sample of samples) {
            rows.push(
                selectedKeys
                    .map(key => escapeCell(sample[key]))
                    .join(",")
            );
        }

        return rows.join("\n");
    }
}
