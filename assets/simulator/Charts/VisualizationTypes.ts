export interface CycleSample {
    angleDeg: number;
    rpm?: number;
    throttle?: number;
    cylinderPressurePa?: number;
    cylinderVolumeM3?: number;
    cylinderTemperatureK?: number;
    intakePressurePa?: number;
    exhaustPressurePa?: number;
    intakeValveLiftM?: number;
    exhaustValveLiftM?: number;
    burnedFraction?: number;
    heatReleaseRateW?: number;
    intakeValveMassFlowKgS?: number;
    exhaustValveMassFlowKgS?: number;
    closedCycleTorqueNm?: number;
    indicatedTorqueNm?: number;
    pumpingTorqueNm?: number;
    boostBarGauge?: number;
    // PVDiagram utilise également ses propres noms normalisés après conversion.
    pressurePa?: number;
    volumeM3?: number;
    boostBar?: number;
    [key: string]: number | string | boolean | undefined;
}

export interface CycleEvents {
    intakeValveOpenDeg?: number;
    intakeValveCloseDeg?: number;
    ignitionStartDeg?: number;
    ignitionEndDeg?: number;
    ca10Deg?: number;
    ca50Deg?: number;
    ca90Deg?: number;
    exhaustValveOpenDeg?: number;
    exhaustValveCloseDeg?: number;
}

export interface CycleSummary {
    meanRpm?: number;
    meanBoostBarGauge?: number;
    peakPressurePa?: number;
    peakPressureAngleDeg?: number;
    meanCA50DegAfterTdc?: number;
    netIndicatedMeanEffectivePressurePa?: number;
    sampleCount?: number;
    durationSeconds?: number;
}

export interface RecordedCycle {
    sequence: number;
    cylinderIndex: number;
    cylinderNumber: number;
    angularStepDeg?: number;
    samples: CycleSample[];
    events?: CycleEvents;
    summary?: CycleSummary;
}

export interface CycleRecorderLike {
    cylinderIndex: number;
    subscribe(callback: (cycle: RecordedCycle) => void): () => void;
    setCylinder(cylinderIndex: number): void;
    getLatestCycle(): RecordedCycle | null;
    getHistory(): RecordedCycle[];
    exportCsv(cycle?: RecordedCycle | null, fields?: string[] | null): string;
}

export interface TelemetrySample {
    duration?: number;
    rpm?: number;
    throttle?: number;
    crankshaftAngularAcceleration?: number;
    engineRunning?: boolean;
    fuelCutActive?: boolean;
    revLimiterActive?: boolean;
    [key: string]: number | boolean | string | null | undefined;
}

export interface TelemetryRecorderLike {
    subscribe(callback: (sample: TelemetrySample) => void): () => void;
    clear(): void;
}