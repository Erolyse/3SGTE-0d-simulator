import type { EngineStateData } from "../engine/EngineStateTypes.js";
import type { CycleRecorderLike, RecordedCycle } from "../Charts/VisualizationTypes.js";

export type PlaybackMode = "live" | "replay";

export interface EngineReplayState {
    crankAngle: number;
    rpm: number;
    throttle: number;
    boost: number;
    turboRPM: number;
    pistonPositions: number[];
    cylinderVolumes: number[];
    cylinderPressures: number[];
    cylinderTemperatures: number[];
    cylinderBurnedFraction: number[];
    cylinderHeatReleaseRate: number[];
    intakeValveLift: number[];
    exhaustValveLift: number[];
    intakeValveMassFlow: number[];
    exhaustValveMassFlow: number[];
}

export type EngineVisualInputState = EngineStateData;
export type EngineVisualOutputState = EngineStateData | EngineReplayState;

export interface PlaybackStatus {
    mode: PlaybackMode;
    paused: boolean;
    cycleDurationSeconds: number;
    visualCrankAngleDeg: number | null;
    cycleSequence: number | null;
}

export interface EngineVisualPlaybackOptions {
    canvas: HTMLCanvasElement;
    cycleRecorder?: CycleRecorderLike | null;
    defaultCycleDurationSeconds?: number;
}

export interface EngineViewerOptions extends EngineVisualPlaybackOptions {
    pixelRatioCap?: number;
    shadows?: boolean;
}

export type { CycleRecorderLike, RecordedCycle };
