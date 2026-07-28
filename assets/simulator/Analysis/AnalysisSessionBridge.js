import DynoSweepRecorder from "../Charts/DynoSweepRecorder.js";

const STORAGE_KEY = "3sgte.analysisSnapshot.v1";
const MAX_TELEMETRY_POINTS = 450;

const SNAPSHOT_KEYS = Object.freeze([
    "sequence",
    "time",
    "duration",
    "rpm",
    "throttle",
    "torque",
    "power",
    "closedCycleIndicatedTorque",
    "pumpingTorque",
    "mechanicalFrictionTorque",
    "accessoryTorque",
    "crankshaftAngularAcceleration",
    "boost",
    "intakePressure",
    "chargeAirPressure",
    "chargeAirTemperature",
    "compressorMassFlow",
    "compressorPressureRatio",
    "compressorEfficiency",
    "intercoolerEffectiveness",
    "turboRPM",
    "turbineAvailablePower",
    "turbinePower",
    "compressorPower",
    "turboBearingFrictionPower",
    "turboNetPower",
    "wastegatePosition",
    "wastegateMassFlow",
    "maximumMassResidualPercent",
    "maximumEnergyResidualPercent",
    "globalMassResidualPercent",
    "globalEnergyResidualPercent",
    "engineOperatingState",
    "engineRunning",
    "revLimiterActive",
    "fuelCutActive"
]);

function compactSample(sample) {
    const compact = {};
    for (const key of SNAPSHOT_KEYS) {
        if (sample?.[key] !== undefined) {
            compact[key] = sample[key];
        }
    }
    return compact;
}

function safeWriteSnapshot(snapshot) {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        return true;
    } catch (error) {
        console.warn("La session d’analyse n’a pas pu être enregistrée.", error);
        return false;
    }
}

export default function installAnalysisSessionBridge({
                                                         motor,
                                                         linkSelector = "a[data-Analysis-link], a.command-link"
                                                     }) {
    if (!motor?.telemetry || !motor?.cycleRecorder) {
        return null;
    }

    const sweep = new DynoSweepRecorder({
        rpmBinSize: 100,
        minimumRpm: 1000,
        maximumRpm: 7000,
        minimumThrottle: 0.65,
        minimumAngularAcceleration: -2
    });
    sweep.start({ clear: true });

    const unsubscribe = motor.telemetry.subscribe(sample => {
        sweep.ingest(sample);
    });

    function createSnapshot() {
        const history = motor.telemetry.getHistory();
        const stride = Math.max(
            Math.ceil(history.length / MAX_TELEMETRY_POINTS),
            1
        );
        const telemetry = [];

        for (let index = 0; index < history.length; index += stride) {
            telemetry.push(compactSample(history[index]));
        }

        const latest = history.at(-1);

        return {
            version: 1,
            createdAt: new Date().toISOString(),
            meta: {
                rpm: latest?.rpm ?? motor.state.rpm,
                engineOperatingState: motor.state.engineOperatingState,
                dynoMode: motor.state.dynoMode === "braked"
                    ? "Freiné"
                    : motor.state.dynoMode === "rpm_hold"
                        ? "Régime régulé"
                        : "Inertiel"
            },
            telemetry,
            dynoPoints: sweep.getPoints(),
            cycle: motor.cycleRecorder.getLatestCycle()
        };
    }

    function persist() {
        return safeWriteSnapshot(createSnapshot());
    }

    function handleNavigation(event) {
        const link = event.target?.closest?.(linkSelector);
        if (!link) return;
        persist();
    }

    document.addEventListener("click", handleNavigation, true);

    return {
        persist,
        createSnapshot,
        destroy() {
            unsubscribe?.();
            document.removeEventListener("click", handleNavigation, true);
        }
    };
}
