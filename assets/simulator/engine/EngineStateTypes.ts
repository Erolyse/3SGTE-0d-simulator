// Contrats de données centraux du simulateur.
// Ces types décrivent la forme plate réellement stockée dans EngineState.
// Ils n'introduisent aucun changement de modèle ni de représentation runtime.

export type CylinderIndex = 0 | 1 | 2 | 3;
export type ExhaustScrollIndex = 0 | 1;

export type CylinderTuple<T> = [T, T, T, T];
export type TwinScrollTuple<T> = [T, T];

export type DynoMode = "inertia" | "braked" | "rpmHold";
export type EngineOperatingState =
    | "off"
    | "cranking"
    | "running"
    | "stopping"
    | "stalled";

/** Rotation moteur et géométrie instantanée des quatre pistons. */
export interface EngineKinematicsState {
    rpm: number;
    crankAngle: number;
    pistonPositions: CylinderTuple<number>;
    cylinderVolumes: CylinderTuple<number>;
    prevCylinderVolumes: CylinderTuple<number>;
}

/** État thermodynamique et énergétique des quatre cylindres. */
export interface CylinderState {
    cylinderPressures: CylinderTuple<number>;
    cylinderTemperatures: CylinderTuple<number>;
    cylinderGasMass: CylinderTuple<number>;
    cylinderInternalEnergies: CylinderTuple<number>;
    trappedAirMass: CylinderTuple<number>;
    burnedFuelMassInCylinder: CylinderTuple<number>;
    cylinderBurnedFraction: CylinderTuple<number>;
    cylinderHeatReleaseStep: CylinderTuple<number>;
    cylinderWallHeatTransferStep: CylinderTuple<number>;
    cylinderBoundaryWorkStep: CylinderTuple<number>;
    cylinderHeatReleaseRate: CylinderTuple<number>;
    cylinderWallHeatTransferRate: CylinderTuple<number>;
    cylinderBoundaryWorkRate: CylinderTuple<number>;
    cylinderHeatTransferCoefficient: CylinderTuple<number>;
    cylinderHeatTransferArea: CylinderTuple<number>;
    cylinderEffectiveWallTemperature: CylinderTuple<number>;
    totalCylinderHeatReleaseRate: number;
    totalCylinderWallHeatLossRate: number;
    totalCylinderBoundaryWorkRate: number;
    cumulativeCylinderWallHeatLoss: number;
    residualGasTemp: CylinderTuple<number>;
}

/** Collecteur d'admission, papillon et soupapes d'admission. */
export interface IntakeState {
    intakePressure: number;
    intakeTemperature: number;
    intakeManifoldMass: number;
    intakeManifoldInternalEnergy: number;
    intakeAirMassFlow: number;
    cylinderAirMassFlow: number;
    freshCylinderAirMassFlow: number;
    intakeReversionMassFlow: number;
    throttleEffectiveArea: number;
    intakeValveLift: CylinderTuple<number>;
    intakeValveEffectiveArea: CylinderTuple<number>;
    intakeValveMassFlow: CylinderTuple<number>;
    wasIntakeValveOpen: CylinderTuple<boolean>;
    cylinderFuelEnabled: CylinderTuple<boolean>;
}

/** Soupapes et deux scrolls du collecteur d'échappement twin-entry. */
export interface ExhaustState {
    exhaustValveLift: CylinderTuple<number>;
    exhaustValveEffectiveArea: CylinderTuple<number>;
    exhaustValveMassFlow: CylinderTuple<number>;
    wasExhaustValveOpen: CylinderTuple<boolean>;
    exhaustManifoldPressures: TwinScrollTuple<number>;
    exhaustManifoldTemperatures: TwinScrollTuple<number>;
    exhaustManifoldMasses: TwinScrollTuple<number>;
    exhaustManifoldInternalEnergies: TwinScrollTuple<number>;
    exhaustManifoldWallTemperatures: TwinScrollTuple<number>;
    exhaustManifoldWallEnergies: TwinScrollTuple<number>;
    exhaustGasToWallHeatTransferRate: TwinScrollTuple<number>;
    exhaustWallAmbientHeatLossRate: TwinScrollTuple<number>;
    exhaustGasWallConductance: TwinScrollTuple<number>;
    egtSensorTemperatures: TwinScrollTuple<number>;
    exhaustOutletMassFlow: TwinScrollTuple<number>;
    exhaustOutletReverseLeakMassFlow: TwinScrollTuple<number>;
    exhaustScrollThroughMassFlow: TwinScrollTuple<number>;
    exhaustAvailableTurbinePower: TwinScrollTuple<number>;
    filteredExhaustAvailableTurbinePower: TwinScrollTuple<number>;
    exhaustValveTotalMassFlow: number;
    exhaustMassFlow: number;
    exhaustReverseMassFlow: number;
    exhaustBackPressure: number;
    exhaustGasTemperature: number;
    exhaustWallTemperature: number;
    egtSensorTemperature: number;
    exhaustTemperature: number;
    totalExhaustAvailableTurbinePower: number;
    filteredTotalExhaustAvailableTurbinePower: number;
}

/** Combustion, carburant et consommation. */
export interface FuelState {
    afr: number;
    fuelMass: number;
    fuelMassBurnedStep: number;
    fuelMassChemicallyBurnedStep: number;
    instantFuelConsumptionLh: number;
    avgConsumptionL100km: number;
}

/** Arbre turbo, turbine, compresseur, charge air, wastegate et bypass. */
export interface TurboState {
    turboRPM: number;
    turboShaftAngularSpeed: number;
    turboAngularAcceleration: number;
    turboShaftInertia: number;
    turboNetTorque: number;
    turboNetPower: number;
    turboOverspeed: boolean;
    turbineMassFlow: TwinScrollTuple<number>;
    wastegateMassFlow: TwinScrollTuple<number>;
    turbineShaftTorques: TwinScrollTuple<number>;
    turbineShaftPowers: TwinScrollTuple<number>;
    turbineOutletTemperatures: TwinScrollTuple<number>;
    turbineTorque: number;
    turbinePower: number;
    turbineDesignSpeedFraction: number;
    turbineEffectivePeakEfficiency: number;
    turbineFlowUtilizationReference: number;
    turbineFlowUtilization: TwinScrollTuple<number>;
    turbineAerodynamicEfficiency: TwinScrollTuple<number>;
    wastegatePosition: number;
    wastegateTargetPosition: number;
    effectiveBoostTargetGaugePressure: number;
    wastegateEffectiveArea: TwinScrollTuple<number>;
    boostControllerIntegral: number;
    chargeAirPressure: number;
    chargeAirTemperature: number;
    chargeAirMass: number;
    chargeAirInternalEnergy: number;
    chargeAirBoostPressure: number;
    compressorMassFlow: number;
    compressorPressureRatio: number;
    compressorPressureRatioCapability: number;
    compressorRawPressureRatioCapability: number;
    compressorCorrectedFlowCoefficient: number;
    compressorCorrectedMassFlow: number;
    compressorChokeFraction: number;
    compressorTipMach: number;
    compressorTipMachLossFraction: number;
    compressorEffectiveLoadingCoefficient: number;
    compressorAerodynamicChokeMassFlow: number;
    compressorEfficiency: number;
    compressorOutletTemperature: number;
    compressorPower: number;
    compressorFluidPower: number;
    compressorAerodynamicLossPower: number;
    compressorTorque: number;
    compressorTipSpeed: number;
    intercoolerHeatTransferRate: number;
    intercoolerEffectiveness: number;
    compressorBypassValvePosition: number;
    compressorBypassValveTarget: number;
    compressorBypassMassFlow: number;
    boost: number;
    turboBearingFrictionTorque: number;
    turboBearingFrictionPower: number;
}

/** Banc, transmission, inerties et cinématique véhicule/rouleaux. */
export interface DynoState {
    dynoMode: DynoMode;
    dynoBrakeCommand: number;
    dynoTargetRpm: number;
    dynoRequestedBrakeCommand: number;
    dynoControllerCommand: number;
    dynoControllerIntegral: number;
    dynoCoastdownBrakeEnabled: boolean;
    dynoCoastdownBrakeCommand: number;
    dynoCoastdownBrakeTorqueAtCrank: number;
    dynoAppliedBrakeTorque: number;
    dynoBrakeTorqueAtCrank: number;
    dynoAbsorbedPower: number;
    dynoRoadLoadEnabled: boolean;
    roadLoadForce: number;
    roadLoadTorque: number;
    dynoCouplingFactor: number;
    engineInertia: number;
    drivelineEquivalentInertia: number;
    rollerEquivalentInertia: number;
    totalEquivalentInertia: number;
    physicalRollerInertia: number;
    virtualRollerInertia: number;
    physicalRollerEquivalentMass: number;
    virtualAddedMass: number;
    dynoEquivalentVehicleMass: number;
    overallDriveRatio: number;
    wheelAngularSpeed: number;
    rollerAngularSpeed: number;
    vehicleSpeedKmh: number;
    rollerSurfaceSpeedKmh: number;
    drivelineLossTorque: number;
    drivelineLossPower: number;
    wheelTorque: number;
    wheelPower: number;
    rollerDriveTorque: number;
    rollerDrivePower: number;
    netCrankshaftTorque: number;
    totalAppliedCrankTorque: number;
    crankshaftAngularAcceleration: number;
    distanceTraveled: number;
}

/** Couples indiqués, pompage, pertes mécaniques et performances arbre. */
export interface MechanicalState {
    indicatedTorque: number;
    closedCycleIndicatedTorque: number;
    pumpingTorque: number;
    smoothedIndicatedTorque: number;
    smoothedClosedCycleTorque: number;
    smoothedPumpingTorque: number;
    smoothedBrakeTorque: number;
    meanPistonSpeed: number;
    averageCyclePeakGaugePressure: number;
    frictionMeanEffectivePressure: number;
    baseFrictionTorque: number;
    speedFrictionTorque: number;
    loadFrictionTorque: number;
    mechanicalFrictionTorque: number;
    accessoryTorque: number;
    mechanicalLossTorque: number;
    mechanicalLossPower: number;
    pumpingPower: number;
    pumpingMeanEffectivePressure: number;
    closedCycleIndicatedPower: number;
    indicatedPower: number;
    pumpingLossPower: number;
    currentCyclePeakCylinderPressure: CylinderTuple<number>;
    lastCyclePeakCylinderPressure: CylinderTuple<number>;
    lossModelPreviousCylinderAngles: CylinderTuple<number>;
    fuelCutActive: boolean;
    engineBrakingActive: boolean;
    engineBrakingTorque: number;
    engineBrakingPower: number;
    torque: number;
    power: number;
    egt: number;
}

/** État de marche, démarreur, ralenti, rupteur et calage combustion. */
export interface EngineControlState {
    engineOperatingState: EngineOperatingState;
    engineRunning: boolean;
    ignitionOn: boolean;
    combustionEnabled: boolean;
    starterActive: boolean;
    starterTorqueAtCrank: number;
    starterPower: number;
    starterElapsedTime: number;
    starterCrankRevolutions: number;
    idleControlEnabled: boolean;
    idleAirControlCommand: number;
    idleAirControlTarget: number;
    idleControlIntegral: number;
    idleBypassEffectiveArea: number;
    runningElapsedTime: number;
    stallDetectionTimer: number;
    revLimiterActive: boolean;
    revLimiterEventCount: number;
    ignitionTimingDeg: number;
    highSpeedIgnitionAdvanceDeg: number;
    combustionPhasingIgnitionLimitDeg: number;
    ignitionPhasingLimited: boolean;
    combustionDurationDeg: number;
    combustionCA50DegAfterTdc: number;
    intakeValveDischargeCoefficient: number;
    exhaustValveDischargeCoefficient: number;
    combustionCA50TargetDegAfterTdc: number;
}

/** Bookkeeping et diagnostics de conservation masse/énergie. */
export interface ConservationState {
    cylinderFuelMassAddedStep: CylinderTuple<number>;
    cylinderIntakeEnthalpyTransferStep: CylinderTuple<number>;
    cylinderExhaustEnthalpyTransferStep: CylinderTuple<number>;
    cylinderOpenBoundaryWorkStep: CylinderTuple<number>;
    cylinderOpenWallHeatTransferStep: CylinderTuple<number>;
    cylinderMassCorrectionStep: CylinderTuple<number>;
    cylinderEnergyCorrectionStep: CylinderTuple<number>;
    intakeThrottleMassTransferStep: number;
    intakeThrottleEnthalpyTransferStep: number;
    intakeValveEnthalpyTransferStep: CylinderTuple<number>;
    intakeManifoldWallHeatTransferStep: number;
    intakeManifoldMassCorrectionStep: number;
    intakeManifoldEnergyCorrectionStep: number;
    chargeAirCompressorMassStep: number;
    chargeAirCompressorEnthalpyStep: number;
    chargeAirThrottleMassTransferStep: number;
    chargeAirThrottleEnthalpyTransferStep: number;
    chargeAirBypassMassStep: number;
    chargeAirBypassEnthalpyStep: number;
    chargeAirIntercoolerHeatTransferStep: number;
    chargeAirMassCorrectionStep: number;
    chargeAirEnergyCorrectionStep: number;
    exhaustScrollByCylinder: CylinderTuple<ExhaustScrollIndex>;
    exhaustScrollValveEnthalpyTransferStep: TwinScrollTuple<number>;
    exhaustScrollOutletMassStep: TwinScrollTuple<number>;
    exhaustScrollReverseLeakMassStep: TwinScrollTuple<number>;
    exhaustScrollOutletEnthalpyStep: TwinScrollTuple<number>;
    exhaustScrollReverseLeakEnthalpyStep: TwinScrollTuple<number>;
    exhaustScrollGasToWallHeatStep: TwinScrollTuple<number>;
    exhaustWallAmbientHeatLossStep: TwinScrollTuple<number>;
    exhaustScrollMassCorrectionStep: TwinScrollTuple<number>;
    exhaustScrollEnergyCorrectionStep: TwinScrollTuple<number>;
    exhaustWallEnergyCorrectionStep: TwinScrollTuple<number>;
    cylinderMassRawResidualStep: CylinderTuple<number>;
    cylinderMassResidualStep: CylinderTuple<number>;
    cylinderMassResidualRate: CylinderTuple<number>;
    cylinderMassResidualPercent: CylinderTuple<number>;
    cylinderEnergyRawResidualStep: CylinderTuple<number>;
    cylinderEnergyResidualStep: CylinderTuple<number>;
    cylinderEnergyResidualRate: CylinderTuple<number>;
    cylinderEnergyResidualPercent: CylinderTuple<number>;
    intakeManifoldMassRawResidualStep: number;
    intakeManifoldMassResidualStep: number;
    intakeManifoldMassResidualRate: number;
    intakeManifoldMassResidualPercent: number;
    intakeManifoldEnergyRawResidualStep: number;
    intakeManifoldEnergyResidualStep: number;
    intakeManifoldEnergyResidualRate: number;
    intakeManifoldEnergyResidualPercent: number;
    chargeAirMassRawResidualStep: number;
    chargeAirMassResidualStep: number;
    chargeAirMassResidualRate: number;
    chargeAirMassResidualPercent: number;
    chargeAirEnergyRawResidualStep: number;
    chargeAirEnergyResidualStep: number;
    chargeAirEnergyResidualRate: number;
    chargeAirEnergyResidualPercent: number;
    exhaustScrollMassRawResidualStep: TwinScrollTuple<number>;
    exhaustScrollMassResidualStep: TwinScrollTuple<number>;
    exhaustScrollMassResidualRate: TwinScrollTuple<number>;
    exhaustScrollMassResidualPercent: TwinScrollTuple<number>;
    exhaustScrollEnergyRawResidualStep: TwinScrollTuple<number>;
    exhaustScrollEnergyResidualStep: TwinScrollTuple<number>;
    exhaustScrollEnergyResidualRate: TwinScrollTuple<number>;
    exhaustScrollEnergyResidualPercent: TwinScrollTuple<number>;
    exhaustWallEnergyRawResidualStep: TwinScrollTuple<number>;
    exhaustWallEnergyResidualStep: TwinScrollTuple<number>;
    exhaustWallEnergyResidualRate: TwinScrollTuple<number>;
    exhaustWallEnergyResidualPercent: TwinScrollTuple<number>;
    globalMassRawResidualStep: number;
    globalMassRawResidualRate: number;
    globalMassCorrectionStep: number;
    globalMassCorrectionRate: number;
    globalMassResidualStep: number;
    globalMassResidualRate: number;
    globalMassResidualPercent: number;
    globalEnergyRawResidualStep: number;
    globalEnergyRawResidualRate: number;
    globalEnergyCorrectionStep: number;
    globalEnergyCorrectionRate: number;
    globalEnergyResidualStep: number;
    globalEnergyResidualRate: number;
    globalEnergyResidualPercent: number;
    throttleInterfaceMassMismatchStep: number;
    throttleInterfaceEnergyMismatchStep: number;
    throttleInterfaceMassMismatchRate: number;
    throttleInterfaceEnergyMismatchRate: number;
    maximumMassResidualPercent: number;
    maximumEnergyResidualPercent: number;
    cumulativeAbsoluteMassResidual: number;
    cumulativeAbsoluteEnergyResidual: number;
    conservationSubstepCount: number;
    conservationDiagnosticsStride: number;
    _conservationCaptureActive: boolean;
    _conservationInitialCylinderMass: CylinderTuple<number>;
    _conservationInitialCylinderEnergy: CylinderTuple<number>;
    _conservationInitialIntakeMass: number;
    _conservationInitialIntakeEnergy: number;
    _conservationInitialChargeMass: number;
    _conservationInitialChargeEnergy: number;
    _conservationInitialExhaustMass: TwinScrollTuple<number>;
    _conservationInitialExhaustEnergy: TwinScrollTuple<number>;
    _conservationInitialExhaustWallEnergy: TwinScrollTuple<number>;
    _conservationInitialTotalMass: number;
    _conservationInitialTotalEnergy: number;
}

/** Diagnostics du solveur angulaire adaptatif. */
export interface AngleSolverState {
    angleSolverBaseStepDeg: number;
    angleSolverCombustionStepDeg: number;
    angleSolverEventStepDeg: number;
    angleSolverMaximumTimeStepUs: number;
    angleSolverSubstepsLastUpdate: number;
    angleSolverTotalSubsteps: number;
    angleSolverMinimumTimeStepUs: number;
    angleSolverMaximumAngleAdvanceDeg: number;
    angleSolverMinimumRequestedStepDeg: number;
    angleSolverSaturated: boolean;
    angleSolverUnintegratedTime: number;
    angleSolverPendingTimeUs: number;
    lastUpdateAverageTorque: number;
    lastUpdateAveragePower: number;
    lastUpdateAverageTurbinePower: number;
    angleSolverResolutionScale: number;
}

/** Diagnostics de réduction et buffering de télémétrie. */
export interface TelemetryState {
    telemetryOutputRateHz: number;
    telemetryHistorySeconds: number;
    telemetryBufferCapacity: number;
    telemetryBufferedSamples: number;
    telemetrySamplesProduced: number;
    telemetryLastSampleTime: number;
    telemetryLastSampleSequence: number;
    telemetryInputRateHz: number;
}

/** Diagnostics du recorder haute résolution sur 720°. */
export interface CycleRecorderState {
    cycleRecorderEnabled: boolean;
    cycleRecorderCylinderIndex: CylinderIndex;
    cycleRecorderBufferedCycles: number;
    cycleRecorderCompletedCycles: number;
    cycleRecorderSamplesCurrentCycle: number;
    cycleRecorderLatestCycleRpm: number;
    cycleRecorderLatestCycleDurationMs: number;
    cycleRecorderLatestSampleCount: number;
    cycleRecorderLatestPeakPressureBar: number;
    cycleRecorderLatestPeakPressureAngleDeg: number;
    cycleRecorderLatestHeatReleasedJ: number;
    cycleRecorderLatestWallHeatLossJ: number;
    cycleRecorderLatestClosedWorkJ: number;
    cycleRecorderLatestPumpingWorkJ: number;
    cycleRecorderLatestNetIndicatedWorkJ: number;
    cycleRecorderAngularStepDeg: number;
    cycleRecorderCaptureIntervalMs: number;
}

/** Commandes utilisateur appliquées au modèle. */
export interface DriverInputState {
    throttle: number;
}

/** Contrat complet de l'état partagé du moteur. */
export interface EngineStateData extends
    EngineKinematicsState,
    CylinderState,
    IntakeState,
    ExhaustState,
    FuelState,
    TurboState,
    DynoState,
    MechanicalState,
    EngineControlState,
    ConservationState,
    AngleSolverState,
    TelemetryState,
    CycleRecorderState,
    DriverInputState
{}


/** État minimal lu par le solveur adaptatif d'angle vilebrequin. */
export type CrankAngleIntegratorState = Pick<
    EngineStateData,
    | "rpm"
    | "crankAngle"
    | "ignitionTimingDeg"
    | "angleSolverResolutionScale"
>;

// Contrats d'accès par sous-système.
// Ils gardent l'état runtime plat tout en documentant les domaines dont chaque
// gros module a réellement besoin pendant la migration TypeScript.
export type ThermodynamicsModuleState =
    EngineKinematicsState
    & CylinderState
    & IntakeState
    & FuelState
    & EngineControlState
    & ConservationState;

export type IntakeManifoldModuleState =
    EngineKinematicsState
    & CylinderState
    & IntakeState
    & TurboState
    & MechanicalState
    & EngineControlState
    & ConservationState
    & DriverInputState;

export type ExhaustManifoldModuleState =
    EngineKinematicsState
    & CylinderState
    & ExhaustState
    & TurboState
    & MechanicalState
    & EngineControlState
    & ConservationState;

export type TurbochargerModuleState =
    IntakeState
    & TurboState
    & DynoState
    & ConservationState
    & DriverInputState;

export type MechanicalLossesModuleState =
    EngineKinematicsState
    & CylinderState
    & MechanicalState
    & DriverInputState;

export type CrankshaftModuleState =
    EngineKinematicsState
    & CylinderState
    & MechanicalState;

export type DynoModuleState =
    EngineKinematicsState
    & DynoState
    & MechanicalState
    & EngineControlState
    & DriverInputState;