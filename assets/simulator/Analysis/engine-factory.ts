import Engine from "../engine/Engine.js";
import { DYNO_MODES } from "../Dyno/Dyno.js";
import { ANALYSIS_CHANNELS } from "./config.js";

function createAnalysisEngine({
                                  baseAngleStepDeg = 0.5,
                                  cycleAngleStepDeg = 0.5,
                                  cycleHistory = 10,
                                  captureIntervalSeconds = 0.18,
                                  telemetryHistorySeconds = 45,
                                  telemetryChannels = ANALYSIS_CHANNELS,
                                  cycleRecorderEnabled = true
                              } = {}) {
    const engine = new Engine({
        telemetryOptions: {
            outputRateHz: 30,
            inputRateHz: 2000,
            historySeconds: telemetryHistorySeconds,
            channels: telemetryChannels
        },
        cycleRecorderOptions: {
            cylinderIndex: 0,
            enabled: cycleRecorderEnabled,
            historyCycles: cycleHistory,
            angularSampleStepDeg: cycleAngleStepDeg,
            captureIntervalSeconds,
            maximumSamplesPerCycle: Math.ceil(720 / cycleAngleStepDeg) + 16
        },
        conservationDiagnosticsStride: 16,
        angleSolverBaseStepDeg: baseAngleStepDeg
    });

    engine.state.rpm = 0;
    engine.state.throttle = 0;
    engine.state.dynoMode = DYNO_MODES.INERTIA;
    engine.state.dynoBrakeCommand = 0;
    engine.state.dynoTargetRpm = 3000;
    engine.state.dynoRoadLoadEnabled = false;

    return engine;
}

const motor = createAnalysisEngine();

export { createAnalysisEngine };