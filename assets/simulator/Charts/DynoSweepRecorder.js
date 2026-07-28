// Courbe de banc reconstruite depuis la télémétrie temporelle.
// Les grandeurs périodiques sont d'abord moyennées sur 720° afin d'éviter
// l'aliasing de phase avant leur classement par tranches de régime.

const DEFAULT_RPM_BIN_SIZE = 100;
const DEFAULT_MINIMUM_RPM = 1200;
const DEFAULT_MAXIMUM_RPM = 7500;
const DEFAULT_MINIMUM_THROTTLE = 0.65;
const DEFAULT_MINIMUM_ACCELERATION = -2.0;

const ENGINE_CYCLE_ANGLE_DEG = 720;
const DEGREES_PER_SECOND_PER_RPM = 6; // RPM * 360 / 60
const ANGLE_EPSILON_DEG = 1e-9;

const AVERAGED_FIELDS = Object.freeze([
    "closedCycleIndicatedTorque",
    "pumpingTorque",
    "mechanicalFrictionTorque",
    "accessoryTorque",
    "torque",
    "wheelTorque",
    "power",
    "wheelPower",
    "boost",
    "turboRPM",
    "exhaustBackPressure",
    "intakePressure"
]);

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function createSums() {
    return Object.fromEntries(AVERAGED_FIELDS.map(key => [key, 0]));
}

function createBin(rpmCenter) {
    return {
        rpm: rpmCenter,
        totalWeight: 0,
        cycleCount: 0,

        closedCycleIndicatedTorque: 0,
        pumpingTorque: 0,
        mechanicalFrictionTorque: 0,
        accessoryTorque: 0,
        torque: 0,
        wheelTorque: 0,

        power: 0,
        wheelPower: 0,
        boost: 0,
        turboRPM: 0,
        exhaustBackPressure: 0,
        intakePressure: 0
    };
}

function addWeighted(target, key, value, weight) {
    target[key] += finite(value) * weight;
}

export default class DynoSweepRecorder {
    constructor({
                    rpmBinSize = DEFAULT_RPM_BIN_SIZE,
                    minimumRpm = DEFAULT_MINIMUM_RPM,
                    maximumRpm = DEFAULT_MAXIMUM_RPM,
                    minimumThrottle = DEFAULT_MINIMUM_THROTTLE,
                    minimumAngularAcceleration = DEFAULT_MINIMUM_ACCELERATION
                } = {}) {
        this.rpmBinSize = Math.max(Math.round(rpmBinSize), 25);
        this.minimumRpm = Math.max(minimumRpm, 0);
        this.maximumRpm = Math.max(maximumRpm, this.minimumRpm + 100);
        this.minimumThrottle = Math.min(Math.max(minimumThrottle, 0), 1);
        this.minimumAngularAcceleration = minimumAngularAcceleration;

        this.bins = new Map();
        this.capturing = false;
        this.dirty = true;
        this.acceptedSamples = 0;
        this.acceptedCycles = 0;
        this.lastAcceptedRpm = null;

        this.resetCycleAccumulator();
    }

    resetCycleAccumulator() {
        this.cycleAngleDeg = 0;
        this.cycleDuration = 0;
        this.cycleRpmIntegral = 0;
        this.cycleSums = createSums();
        this.cycleTelemetrySegmentCount = 0;
    }

    start({ clear = true } = {}) {
        if (clear) {
            this.clear();
        }

        this.capturing = true;
        this.resetCycleAccumulator();
        this.dirty = true;
    }

    stop() {
        this.capturing = false;
        this.resetCycleAccumulator();
        this.dirty = true;
    }

    toggle() {
        if (this.capturing) {
            this.stop();
        } else {
            this.start({ clear: this.bins.size === 0 });
        }
    }

    clear() {
        this.bins.clear();
        this.acceptedSamples = 0;
        this.acceptedCycles = 0;
        this.lastAcceptedRpm = null;
        this.resetCycleAccumulator();
        this.dirty = true;
    }

    shouldAccept(sample) {
        if (!this.capturing || !sample) {
            return false;
        }

        const rpm = finite(sample.rpm, -1);
        const throttle = finite(sample.throttle, 0);
        const angularAcceleration = finite(
            sample.crankshaftAngularAcceleration,
            0
        );

        if (sample.engineRunning !== true) {
            return false;
        }

        if (sample.fuelCutActive === true
            || sample.revLimiterActive === true) {
            return false;
        }

        if (rpm < this.minimumRpm || rpm > this.maximumRpm) {
            return false;
        }

        if (throttle < this.minimumThrottle) {
            return false;
        }

        if (angularAcceleration < this.minimumAngularAcceleration) {
            return false;
        }

        if (this.lastAcceptedRpm !== null
            && rpm < this.lastAcceptedRpm - this.rpmBinSize * 0.75) {
            return false;
        }

        return true;
    }

    addSegmentToCycle(sample, duration) {
        if (duration <= 0) {
            return;
        }

        const rpm = Math.max(finite(sample.rpm), 0);

        this.cycleDuration += duration;
        this.cycleRpmIntegral += rpm * duration;
        this.cycleTelemetrySegmentCount++;

        for (const key of AVERAGED_FIELDS) {
            addWeighted(this.cycleSums, key, sample[key], duration);
        }
    }

    finalizeCycle() {
        if (this.cycleDuration <= 0) {
            this.resetCycleAccumulator();
            return false;
        }

        const averageRpm = this.cycleRpmIntegral / this.cycleDuration;

        if (averageRpm < this.minimumRpm
            || averageRpm > this.maximumRpm) {
            this.resetCycleAccumulator();
            return false;
        }

        const cycle = {
            rpm: averageRpm,
            duration: this.cycleDuration,
            telemetrySegmentCount: this.cycleTelemetrySegmentCount
        };

        for (const key of AVERAGED_FIELDS) {
            cycle[key] = this.cycleSums[key] / this.cycleDuration;
        }

        const binIndex = Math.round(averageRpm / this.rpmBinSize);
        const rpmCenter = binIndex * this.rpmBinSize;

        let bin = this.bins.get(binIndex);
        if (!bin) {
            bin = createBin(rpmCenter);
            this.bins.set(binIndex, bin);
        }

        // Chaque cycle représente une mesure physique complète. La durée sert
        // de poids afin qu'un cycle légèrement plus long à faible régime garde
        // sa moyenne temporelle exacte.
        const weight = cycle.duration;
        bin.totalWeight += weight;
        bin.cycleCount++;

        for (const key of AVERAGED_FIELDS) {
            addWeighted(bin, key, cycle[key], weight);
        }

        this.acceptedCycles++;
        this.lastAcceptedRpm = averageRpm;
        this.dirty = true;
        this.resetCycleAccumulator();

        return true;
    }

    ingest(sample) {
        if (!this.shouldAccept(sample)) {
            // Ne jamais mélanger dans un même cycle une phase pleine charge et
            // une coupure, un lever de pied ou une décélération.
            this.resetCycleAccumulator();
            return false;
        }

        const rpm = Math.max(finite(sample.rpm), 0);
        let remainingDuration = Math.max(
            finite(sample.duration, 1 / 60),
            1e-9
        );
        const angularSpeedDegPerSecond = rpm
            * DEGREES_PER_SECOND_PER_RPM;

        if (angularSpeedDegPerSecond <= 0) {
            this.resetCycleAccumulator();
            return false;
        }

        let emittedCycle = false;
        let safety = 0;

        while (remainingDuration > 1e-12 && safety < 4) {
            const remainingCycleAngle = Math.max(
                ENGINE_CYCLE_ANGLE_DEG - this.cycleAngleDeg,
                0
            );
            const durationToCycleEnd = remainingCycleAngle
                / angularSpeedDegPerSecond;
            const segmentDuration = Math.min(
                remainingDuration,
                durationToCycleEnd
            );

            this.addSegmentToCycle(sample, segmentDuration);
            this.cycleAngleDeg += angularSpeedDegPerSecond
                * segmentDuration;
            remainingDuration -= segmentDuration;

            if (this.cycleAngleDeg
                >= ENGINE_CYCLE_ANGLE_DEG - ANGLE_EPSILON_DEG) {
                emittedCycle = this.finalizeCycle() || emittedCycle;
            }

            safety++;
        }

        this.acceptedSamples++;
        return emittedCycle;
    }

    getPointCount() {
        return this.bins.size;
    }

    getPoints() {
        return [...this.bins.values()]
            .filter(bin => bin.totalWeight > 0 && bin.cycleCount > 0)
            .sort((a, b) => a.rpm - b.rpm)
            .map(bin => {
                const divisor = bin.totalWeight;
                const point = {
                    rpm: bin.rpm,
                    cycleCount: bin.cycleCount
                };

                for (const key of AVERAGED_FIELDS) {
                    point[key] = bin[key] / divisor;
                }

                return point;
            });
    }
}
