import type { EngineStateData } from "../engine/EngineStateTypes.js";

// Diagnostic passif de fermeture des bilans masse/énergie des volumes 0D.
// Les corrections numériques explicites sont publiées séparément des résidus.

const CYLINDER_COUNT = 4;
const EXHAUST_SCROLL_COUNT = 2;

const MIN_MASS_REFERENCE = 1e-12;   // kg
const MIN_ENERGY_REFERENCE = 1e-6;  // J

function finite(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function arrayValue(array: readonly unknown[] | null | undefined, index: number, fallback = 0): number {
    return Array.isArray(array)
        ? finite(array[index], fallback)
        : fallback;
}

function sum(array: readonly unknown[] | null | undefined): number {
    if (!Array.isArray(array)) return 0;
    let total = 0;
    for (let index = 0; index < array.length; index++) {
        total += finite(array[index]);
    }
    return total;
}

function maximumAbsolute(array: readonly unknown[] | null | undefined): number {
    if (!Array.isArray(array)) return 0;
    let maximum = 0;
    for (let index = 0; index < array.length; index++) {
        maximum = Math.max(maximum, Math.abs(finite(array[index])));
    }
    return maximum;
}

// Calcul sans allocation temporaire dans la boucle haute fréquence.
function normalizedPercent(
    residual: unknown,
    storageChange: unknown,
    minimumReference: number,
    t1: unknown = 0, t2: unknown = 0, t3: unknown = 0,
    t4: unknown = 0, t5: unknown = 0, t6: unknown = 0,
    t7: unknown = 0, t8: unknown = 0, t9: unknown = 0,
    t10: unknown = 0, t11: unknown = 0
): number {
    const termMagnitude = Math.abs(finite(t1)) + Math.abs(finite(t2))
        + Math.abs(finite(t3)) + Math.abs(finite(t4))
        + Math.abs(finite(t5)) + Math.abs(finite(t6))
        + Math.abs(finite(t7)) + Math.abs(finite(t8))
        + Math.abs(finite(t9)) + Math.abs(finite(t10))
        + Math.abs(finite(t11));
    const reference = Math.max(
        Math.abs(finite(storageChange)),
        termMagnitude,
        minimumReference
    );
    return Math.abs(finite(residual)) / reference * 100;
}

function totalCylinderMass(state: EngineStateData, cylinderIndex: number): number {
    return Math.max(arrayValue(state.cylinderGasMass, cylinderIndex), 0)
        + Math.max(
            arrayValue(state.burnedFuelMassInCylinder, cylinderIndex),
            0
        );
}

function totalStoredMass(state: EngineStateData): number {
    let total = finite(state.intakeManifoldMass)
        + finite(state.chargeAirMass)
        + sum(state.exhaustManifoldMasses);

    for (let cylinder = 0; cylinder < CYLINDER_COUNT; cylinder++) {
        total += totalCylinderMass(state, cylinder);
    }

    return total;
}

function totalStoredEnergy(state: EngineStateData): number {
    return sum(state.cylinderInternalEnergies)
        + finite(state.intakeManifoldInternalEnergy)
        + finite(state.chargeAirInternalEnergy)
        + sum(state.exhaustManifoldInternalEnergies)
        + sum(state.exhaustManifoldWallEnergies);
}

function resetArray<T extends number[]>(array: T, length: number): T {
    if (!Array.isArray(array) || array.length !== length) {
        return new Array(length).fill(0) as T;
    }

    array.fill(0);
    return array;
}

function prepareBookkeepingArrays(state: EngineStateData): void {
    state.cylinderFuelMassAddedStep = resetArray(
        state.cylinderFuelMassAddedStep,
        CYLINDER_COUNT
    );
    state.cylinderIntakeEnthalpyTransferStep = resetArray(
        state.cylinderIntakeEnthalpyTransferStep,
        CYLINDER_COUNT
    );
    state.cylinderExhaustEnthalpyTransferStep = resetArray(
        state.cylinderExhaustEnthalpyTransferStep,
        CYLINDER_COUNT
    );
    state.cylinderOpenBoundaryWorkStep = resetArray(
        state.cylinderOpenBoundaryWorkStep,
        CYLINDER_COUNT
    );
    state.cylinderOpenWallHeatTransferStep = resetArray(
        state.cylinderOpenWallHeatTransferStep,
        CYLINDER_COUNT
    );
    state.cylinderMassCorrectionStep = resetArray(
        state.cylinderMassCorrectionStep,
        CYLINDER_COUNT
    );
    state.cylinderEnergyCorrectionStep = resetArray(
        state.cylinderEnergyCorrectionStep,
        CYLINDER_COUNT
    );

    state.intakeValveEnthalpyTransferStep = resetArray(
        state.intakeValveEnthalpyTransferStep,
        CYLINDER_COUNT
    );
    state.exhaustScrollValveEnthalpyTransferStep = resetArray(
        state.exhaustScrollValveEnthalpyTransferStep,
        EXHAUST_SCROLL_COUNT
    );

    state.exhaustScrollMassCorrectionStep = resetArray(
        state.exhaustScrollMassCorrectionStep,
        EXHAUST_SCROLL_COUNT
    );
    state.exhaustScrollEnergyCorrectionStep = resetArray(
        state.exhaustScrollEnergyCorrectionStep,
        EXHAUST_SCROLL_COUNT
    );
    state.exhaustWallEnergyCorrectionStep = resetArray(
        state.exhaustWallEnergyCorrectionStep,
        EXHAUST_SCROLL_COUNT
    );
    state.exhaustScrollOutletMassStep = resetArray(
        state.exhaustScrollOutletMassStep,
        EXHAUST_SCROLL_COUNT
    );
    state.exhaustScrollReverseLeakMassStep = resetArray(
        state.exhaustScrollReverseLeakMassStep,
        EXHAUST_SCROLL_COUNT
    );
    state.exhaustScrollOutletEnthalpyStep = resetArray(
        state.exhaustScrollOutletEnthalpyStep,
        EXHAUST_SCROLL_COUNT
    );
    state.exhaustScrollReverseLeakEnthalpyStep = resetArray(
        state.exhaustScrollReverseLeakEnthalpyStep,
        EXHAUST_SCROLL_COUNT
    );
    state.exhaustScrollGasToWallHeatStep = resetArray(
        state.exhaustScrollGasToWallHeatStep,
        EXHAUST_SCROLL_COUNT
    );
    state.exhaustWallAmbientHeatLossStep = resetArray(
        state.exhaustWallAmbientHeatLossStep,
        EXHAUST_SCROLL_COUNT
    );

    state.intakeThrottleMassTransferStep = 0;
    state.intakeThrottleEnthalpyTransferStep = 0;
    state.intakeManifoldWallHeatTransferStep = 0;
    state.intakeManifoldMassCorrectionStep = 0;
    state.intakeManifoldEnergyCorrectionStep = 0;

    state.chargeAirCompressorMassStep = 0;
    state.chargeAirCompressorEnthalpyStep = 0;
    state.chargeAirThrottleMassTransferStep = 0;
    state.chargeAirThrottleEnthalpyTransferStep = 0;
    state.chargeAirBypassMassStep = 0;
    state.chargeAirBypassEnthalpyStep = 0;
    state.chargeAirIntercoolerHeatTransferStep = 0;
    state.chargeAirMassCorrectionStep = 0;
    state.chargeAirEnergyCorrectionStep = 0;
}

/**
 * Capture l'état initial et remet à zéro les termes de bilan du sous-pas.
 */
export function beginConservationStep(state: EngineStateData, captureResiduals = true): boolean {
    // Les termes de sous-pas doivent toujours être remis à zéro car ils sont
    // aussi consommés par le CycleRecorder. Seule la capture diagnostique peut
    // être décimée sans toucher à la physique.
    prepareBookkeepingArrays(state);
    state._conservationCaptureActive = Boolean(captureResiduals);

    if (!state._conservationCaptureActive) {
        return false;
    }

    state._conservationInitialCylinderMass = resetArray(
        state._conservationInitialCylinderMass,
        CYLINDER_COUNT
    );
    state._conservationInitialCylinderEnergy = resetArray(
        state._conservationInitialCylinderEnergy,
        CYLINDER_COUNT
    );
    for (let index = 0; index < CYLINDER_COUNT; index++) {
        state._conservationInitialCylinderMass[index]
            = totalCylinderMass(state, index);
        state._conservationInitialCylinderEnergy[index]
            = arrayValue(state.cylinderInternalEnergies, index);
    }

    state._conservationInitialIntakeMass = finite(state.intakeManifoldMass);
    state._conservationInitialIntakeEnergy
        = finite(state.intakeManifoldInternalEnergy);
    state._conservationInitialChargeMass = finite(state.chargeAirMass);
    state._conservationInitialChargeEnergy
        = finite(state.chargeAirInternalEnergy);

    state._conservationInitialExhaustMass = resetArray(
        state._conservationInitialExhaustMass,
        EXHAUST_SCROLL_COUNT
    );
    state._conservationInitialExhaustEnergy = resetArray(
        state._conservationInitialExhaustEnergy,
        EXHAUST_SCROLL_COUNT
    );
    state._conservationInitialExhaustWallEnergy = resetArray(
        state._conservationInitialExhaustWallEnergy,
        EXHAUST_SCROLL_COUNT
    );
    for (let index = 0; index < EXHAUST_SCROLL_COUNT; index++) {
        state._conservationInitialExhaustMass[index]
            = arrayValue(state.exhaustManifoldMasses, index);
        state._conservationInitialExhaustEnergy[index]
            = arrayValue(state.exhaustManifoldInternalEnergies, index);
        state._conservationInitialExhaustWallEnergy[index]
            = arrayValue(state.exhaustManifoldWallEnergies, index);
    }

    state._conservationInitialTotalMass = totalStoredMass(state);
    state._conservationInitialTotalEnergy = totalStoredEnergy(state);
    return true;
}

function writeCylinderResiduals(state: EngineStateData, dt: number): { maximumMassPercent: number; maximumEnergyPercent: number } {
    let maximumMassPercent = 0;
    let maximumEnergyPercent = 0;

    for (let cylinder = 0; cylinder < CYLINDER_COUNT; cylinder++) {
        const initialMass = arrayValue(
            state._conservationInitialCylinderMass,
            cylinder
        );
        const finalMass = totalCylinderMass(state, cylinder);
        const massStorageChange = finalMass - initialMass;

        const intakeMass = arrayValue(state.intakeValveMassFlow, cylinder) * dt;
        const exhaustMass = arrayValue(state.exhaustValveMassFlow, cylinder) * dt;
        const fuelMass = arrayValue(state.cylinderFuelMassAddedStep, cylinder);
        const massCorrection = arrayValue(
            state.cylinderMassCorrectionStep,
            cylinder
        );

        const physicalMassChange = intakeMass - exhaustMass + fuelMass;
        const rawMassResidual = massStorageChange - physicalMassChange;
        const closureMassResidual = rawMassResidual - massCorrection;

        const massPercent = normalizedPercent(
            closureMassResidual, massStorageChange, MIN_MASS_REFERENCE,
            intakeMass, -exhaustMass, fuelMass, massCorrection
        );

        state.cylinderMassRawResidualStep[cylinder] = rawMassResidual;
        state.cylinderMassResidualStep[cylinder] = closureMassResidual;
        state.cylinderMassResidualRate[cylinder]
            = closureMassResidual / dt;
        state.cylinderMassResidualPercent[cylinder] = massPercent;

        const initialEnergy = arrayValue(
            state._conservationInitialCylinderEnergy,
            cylinder
        );
        const finalEnergy = arrayValue(
            state.cylinderInternalEnergies,
            cylinder
        );
        const energyStorageChange = finalEnergy - initialEnergy;

        const intakeEnthalpy = arrayValue(
            state.cylinderIntakeEnthalpyTransferStep,
            cylinder
        );
        const exhaustEnthalpy = arrayValue(
            state.cylinderExhaustEnthalpyTransferStep,
            cylinder
        );
        const heatRelease = arrayValue(
            state.cylinderHeatReleaseStep,
            cylinder
        );
        const closedWallHeat = arrayValue(
            state.cylinderWallHeatTransferStep,
            cylinder
        );
        const closedBoundaryWork = arrayValue(
            state.cylinderBoundaryWorkStep,
            cylinder
        );
        const openWallHeat = arrayValue(
            state.cylinderOpenWallHeatTransferStep,
            cylinder
        );
        const openBoundaryWork = arrayValue(
            state.cylinderOpenBoundaryWorkStep,
            cylinder
        );
        const energyCorrection = arrayValue(
            state.cylinderEnergyCorrectionStep,
            cylinder
        );

        const physicalEnergyChange = intakeEnthalpy
            - exhaustEnthalpy
            + heatRelease
            - closedWallHeat
            - openWallHeat
            - closedBoundaryWork
            - openBoundaryWork;

        const rawEnergyResidual = energyStorageChange
            - physicalEnergyChange;
        const closureEnergyResidual = rawEnergyResidual
            - energyCorrection;

        const energyPercent = normalizedPercent(
            closureEnergyResidual, energyStorageChange, MIN_ENERGY_REFERENCE,
            intakeEnthalpy, -exhaustEnthalpy, heatRelease,
            -closedWallHeat, -openWallHeat, -closedBoundaryWork,
            -openBoundaryWork, energyCorrection
        );

        state.cylinderEnergyRawResidualStep[cylinder] = rawEnergyResidual;
        state.cylinderEnergyResidualStep[cylinder] = closureEnergyResidual;
        state.cylinderEnergyResidualRate[cylinder]
            = closureEnergyResidual / dt;
        state.cylinderEnergyResidualPercent[cylinder] = energyPercent;

        maximumMassPercent = Math.max(maximumMassPercent, massPercent);
        maximumEnergyPercent = Math.max(maximumEnergyPercent, energyPercent);
    }

    return { maximumMassPercent, maximumEnergyPercent };
}

function writeIntakeResiduals(state: EngineStateData, dt: number): void {
    const initialMass = finite(state._conservationInitialIntakeMass);
    const finalMass = finite(state.intakeManifoldMass);
    const storageMassChange = finalMass - initialMass;
    const throttleMass = finite(state.intakeThrottleMassTransferStep);
    const valveMass = sum(state.intakeValveMassFlow) * dt;
    const correctionMass = finite(state.intakeManifoldMassCorrectionStep);

    const physicalMassChange = throttleMass - valveMass;
    const rawMassResidual = storageMassChange - physicalMassChange;
    const closureMassResidual = rawMassResidual - correctionMass;

    state.intakeManifoldMassRawResidualStep = rawMassResidual;
    state.intakeManifoldMassResidualStep = closureMassResidual;
    state.intakeManifoldMassResidualRate = closureMassResidual / dt;
    state.intakeManifoldMassResidualPercent = normalizedPercent(
        closureMassResidual, storageMassChange, MIN_MASS_REFERENCE,
        throttleMass, -valveMass, correctionMass
    );

    const initialEnergy = finite(state._conservationInitialIntakeEnergy);
    const finalEnergy = finite(state.intakeManifoldInternalEnergy);
    const storageEnergyChange = finalEnergy - initialEnergy;
    const throttleEnthalpy = finite(
        state.intakeThrottleEnthalpyTransferStep
    );
    const valveEnthalpy = sum(state.intakeValveEnthalpyTransferStep);
    const wallHeat = finite(state.intakeManifoldWallHeatTransferStep);
    const correctionEnergy = finite(
        state.intakeManifoldEnergyCorrectionStep
    );

    const physicalEnergyChange = throttleEnthalpy
        - valveEnthalpy
        + wallHeat;
    const rawEnergyResidual = storageEnergyChange - physicalEnergyChange;
    const closureEnergyResidual = rawEnergyResidual - correctionEnergy;

    state.intakeManifoldEnergyRawResidualStep = rawEnergyResidual;
    state.intakeManifoldEnergyResidualStep = closureEnergyResidual;
    state.intakeManifoldEnergyResidualRate = closureEnergyResidual / dt;
    state.intakeManifoldEnergyResidualPercent = normalizedPercent(
        closureEnergyResidual, storageEnergyChange, MIN_ENERGY_REFERENCE,
        throttleEnthalpy, -valveEnthalpy, wallHeat, correctionEnergy
    );
}

function writeChargeAirResiduals(state: EngineStateData, dt: number): void {
    const initialMass = finite(state._conservationInitialChargeMass);
    const finalMass = finite(state.chargeAirMass);
    const storageMassChange = finalMass - initialMass;
    const compressorMass = finite(state.chargeAirCompressorMassStep);
    const throttleMass = finite(state.chargeAirThrottleMassTransferStep);
    const bypassMass = finite(state.chargeAirBypassMassStep);
    const correctionMass = finite(state.chargeAirMassCorrectionStep);

    const physicalMassChange = compressorMass - throttleMass - bypassMass;
    const rawMassResidual = storageMassChange - physicalMassChange;
    const closureMassResidual = rawMassResidual - correctionMass;

    state.chargeAirMassRawResidualStep = rawMassResidual;
    state.chargeAirMassResidualStep = closureMassResidual;
    state.chargeAirMassResidualRate = closureMassResidual / dt;
    state.chargeAirMassResidualPercent = normalizedPercent(
        closureMassResidual, storageMassChange, MIN_MASS_REFERENCE,
        compressorMass, -throttleMass, -bypassMass, correctionMass
    );

    const initialEnergy = finite(state._conservationInitialChargeEnergy);
    const finalEnergy = finite(state.chargeAirInternalEnergy);
    const storageEnergyChange = finalEnergy - initialEnergy;
    const compressorEnthalpy = finite(
        state.chargeAirCompressorEnthalpyStep
    );
    const throttleEnthalpy = finite(
        state.chargeAirThrottleEnthalpyTransferStep
    );
    const bypassEnthalpy = finite(state.chargeAirBypassEnthalpyStep);
    const intercoolerHeat = finite(
        state.chargeAirIntercoolerHeatTransferStep
    );
    const correctionEnergy = finite(state.chargeAirEnergyCorrectionStep);

    const physicalEnergyChange = compressorEnthalpy
        - throttleEnthalpy
        - bypassEnthalpy
        - intercoolerHeat;
    const rawEnergyResidual = storageEnergyChange - physicalEnergyChange;
    const closureEnergyResidual = rawEnergyResidual - correctionEnergy;

    state.chargeAirEnergyRawResidualStep = rawEnergyResidual;
    state.chargeAirEnergyResidualStep = closureEnergyResidual;
    state.chargeAirEnergyResidualRate = closureEnergyResidual / dt;
    state.chargeAirEnergyResidualPercent = normalizedPercent(
        closureEnergyResidual, storageEnergyChange, MIN_ENERGY_REFERENCE,
        compressorEnthalpy, -throttleEnthalpy, -bypassEnthalpy,
        -intercoolerHeat, correctionEnergy
    );
}

function writeExhaustResiduals(state: EngineStateData, dt: number): void {
    for (let scroll = 0; scroll < EXHAUST_SCROLL_COUNT; scroll++) {
        const initialMass = arrayValue(
            state._conservationInitialExhaustMass,
            scroll
        );
        const finalMass = arrayValue(state.exhaustManifoldMasses, scroll);
        const storageMassChange = finalMass - initialMass;

        let valveMass = 0;
        for (let cylinder = 0; cylinder < CYLINDER_COUNT; cylinder++) {
            if (arrayValue(state.exhaustScrollByCylinder, cylinder, -1)
                === scroll) {
                valveMass += arrayValue(
                    state.exhaustValveMassFlow,
                    cylinder
                ) * dt;
            }
        }

        if (!Array.isArray(state.exhaustScrollByCylinder)) {
            const mapping = [0, 1, 1, 0];
            valveMass = 0;
            for (let cylinder = 0; cylinder < CYLINDER_COUNT; cylinder++) {
                if (mapping[cylinder] === scroll) {
                    valveMass += arrayValue(
                        state.exhaustValveMassFlow,
                        cylinder
                    ) * dt;
                }
            }
        }

        const outletMass = arrayValue(
            state.exhaustScrollOutletMassStep,
            scroll
        );
        const reverseLeakMass = arrayValue(
            state.exhaustScrollReverseLeakMassStep,
            scroll
        );
        const correctionMass = arrayValue(
            state.exhaustScrollMassCorrectionStep,
            scroll
        );

        const physicalMassChange = valveMass
            - outletMass
            + reverseLeakMass;
        const rawMassResidual = storageMassChange - physicalMassChange;
        const closureMassResidual = rawMassResidual - correctionMass;

        state.exhaustScrollMassRawResidualStep[scroll] = rawMassResidual;
        state.exhaustScrollMassResidualStep[scroll] = closureMassResidual;
        state.exhaustScrollMassResidualRate[scroll]
            = closureMassResidual / dt;
        state.exhaustScrollMassResidualPercent[scroll] = normalizedPercent(
            closureMassResidual, storageMassChange, MIN_MASS_REFERENCE,
            valveMass, -outletMass, reverseLeakMass, correctionMass
        );

        const initialEnergy = arrayValue(
            state._conservationInitialExhaustEnergy,
            scroll
        );
        const finalEnergy = arrayValue(
            state.exhaustManifoldInternalEnergies,
            scroll
        );
        const storageEnergyChange = finalEnergy - initialEnergy;
        const valveEnthalpy = arrayValue(
            state.exhaustScrollValveEnthalpyTransferStep,
            scroll
        );
        const outletEnthalpy = arrayValue(
            state.exhaustScrollOutletEnthalpyStep,
            scroll
        );
        const reverseLeakEnthalpy = arrayValue(
            state.exhaustScrollReverseLeakEnthalpyStep,
            scroll
        );
        const gasToWallHeat = arrayValue(
            state.exhaustScrollGasToWallHeatStep,
            scroll
        );
        const correctionEnergy = arrayValue(
            state.exhaustScrollEnergyCorrectionStep,
            scroll
        );

        const physicalEnergyChange = valveEnthalpy
            - outletEnthalpy
            + reverseLeakEnthalpy
            - gasToWallHeat;
        const rawEnergyResidual = storageEnergyChange
            - physicalEnergyChange;
        const closureEnergyResidual = rawEnergyResidual - correctionEnergy;

        state.exhaustScrollEnergyRawResidualStep[scroll]
            = rawEnergyResidual;
        state.exhaustScrollEnergyResidualStep[scroll]
            = closureEnergyResidual;
        state.exhaustScrollEnergyResidualRate[scroll]
            = closureEnergyResidual / dt;
        state.exhaustScrollEnergyResidualPercent[scroll]
            = normalizedPercent(
            closureEnergyResidual, storageEnergyChange, MIN_ENERGY_REFERENCE,
            valveEnthalpy, -outletEnthalpy, reverseLeakEnthalpy,
            -gasToWallHeat, correctionEnergy
        );

        const initialWallEnergy = arrayValue(
            state._conservationInitialExhaustWallEnergy,
            scroll
        );
        const finalWallEnergy = arrayValue(
            state.exhaustManifoldWallEnergies,
            scroll
        );
        const wallStorageChange = finalWallEnergy - initialWallEnergy;
        const ambientHeat = arrayValue(
            state.exhaustWallAmbientHeatLossStep,
            scroll
        );
        const wallCorrection = arrayValue(
            state.exhaustWallEnergyCorrectionStep,
            scroll
        );

        const wallPhysicalEnergyChange = gasToWallHeat - ambientHeat;
        const wallRawResidual = wallStorageChange - wallPhysicalEnergyChange;
        const wallClosureResidual = wallRawResidual - wallCorrection;

        state.exhaustWallEnergyRawResidualStep[scroll] = wallRawResidual;
        state.exhaustWallEnergyResidualStep[scroll] = wallClosureResidual;
        state.exhaustWallEnergyResidualRate[scroll]
            = wallClosureResidual / dt;
        state.exhaustWallEnergyResidualPercent[scroll] = normalizedPercent(
            wallClosureResidual, wallStorageChange, MIN_ENERGY_REFERENCE,
            gasToWallHeat, -ambientHeat, wallCorrection
        );
    }
}

function writeGlobalResiduals(state: EngineStateData, dt: number): void {
    const initialMass = finite(state._conservationInitialTotalMass);
    const finalMass = totalStoredMass(state);
    const storageMassChange = finalMass - initialMass;

    const compressorMass = finite(state.chargeAirCompressorMassStep);
    const fuelMass = sum(state.cylinderFuelMassAddedStep);
    const reverseLeakMass = sum(state.exhaustScrollReverseLeakMassStep);
    const outletMass = sum(state.exhaustScrollOutletMassStep);
    const bypassMass = finite(state.chargeAirBypassMassStep);

    const physicalMassChange = compressorMass
        + fuelMass
        + reverseLeakMass
        - outletMass
        - bypassMass;

    const totalMassCorrection = sum(state.cylinderMassCorrectionStep)
        + finite(state.intakeManifoldMassCorrectionStep)
        + finite(state.chargeAirMassCorrectionStep)
        + sum(state.exhaustScrollMassCorrectionStep);

    const rawMassResidual = storageMassChange - physicalMassChange;
    const closureMassResidual = rawMassResidual - totalMassCorrection;

    state.globalMassRawResidualStep = rawMassResidual;
    state.globalMassRawResidualRate = rawMassResidual / dt;
    state.globalMassCorrectionStep = totalMassCorrection;
    state.globalMassCorrectionRate = totalMassCorrection / dt;
    state.globalMassResidualStep = closureMassResidual;
    state.globalMassResidualRate = closureMassResidual / dt;
    state.globalMassResidualPercent = normalizedPercent(
        closureMassResidual, storageMassChange, MIN_MASS_REFERENCE,
        compressorMass, fuelMass, reverseLeakMass, -outletMass,
        -bypassMass, totalMassCorrection
    );

    const initialEnergy = finite(state._conservationInitialTotalEnergy);
    const finalEnergy = totalStoredEnergy(state);
    const storageEnergyChange = finalEnergy - initialEnergy;

    const compressorEnthalpy = finite(
        state.chargeAirCompressorEnthalpyStep
    );
    const reverseLeakEnthalpy = sum(
        state.exhaustScrollReverseLeakEnthalpyStep
    );
    const outletEnthalpy = sum(state.exhaustScrollOutletEnthalpyStep);
    const bypassEnthalpy = finite(state.chargeAirBypassEnthalpyStep);
    const heatRelease = sum(state.cylinderHeatReleaseStep);
    const intakeWallHeat = finite(
        state.intakeManifoldWallHeatTransferStep
    );
    const cylinderWallHeat = sum(state.cylinderWallHeatTransferStep)
        + sum(state.cylinderOpenWallHeatTransferStep);
    const cylinderBoundaryWork = sum(state.cylinderBoundaryWorkStep)
        + sum(state.cylinderOpenBoundaryWorkStep);
    const intercoolerHeat = finite(
        state.chargeAirIntercoolerHeatTransferStep
    );
    const exhaustAmbientHeat = sum(state.exhaustWallAmbientHeatLossStep);

    const physicalEnergyChange = compressorEnthalpy
        + reverseLeakEnthalpy
        + heatRelease
        + intakeWallHeat
        - outletEnthalpy
        - bypassEnthalpy
        - cylinderWallHeat
        - cylinderBoundaryWork
        - intercoolerHeat
        - exhaustAmbientHeat;

    const totalEnergyCorrection = sum(state.cylinderEnergyCorrectionStep)
        + finite(state.intakeManifoldEnergyCorrectionStep)
        + finite(state.chargeAirEnergyCorrectionStep)
        + sum(state.exhaustScrollEnergyCorrectionStep)
        + sum(state.exhaustWallEnergyCorrectionStep);

    const rawEnergyResidual = storageEnergyChange - physicalEnergyChange;
    const closureEnergyResidual = rawEnergyResidual - totalEnergyCorrection;

    state.globalEnergyRawResidualStep = rawEnergyResidual;
    state.globalEnergyRawResidualRate = rawEnergyResidual / dt;
    state.globalEnergyCorrectionStep = totalEnergyCorrection;
    state.globalEnergyCorrectionRate = totalEnergyCorrection / dt;
    state.globalEnergyResidualStep = closureEnergyResidual;
    state.globalEnergyResidualRate = closureEnergyResidual / dt;
    state.globalEnergyResidualPercent = normalizedPercent(
        closureEnergyResidual, storageEnergyChange, MIN_ENERGY_REFERENCE,
        compressorEnthalpy, reverseLeakEnthalpy, heatRelease,
        intakeWallHeat, -outletEnthalpy, -bypassEnthalpy,
        -cylinderWallHeat, -cylinderBoundaryWork, -intercoolerHeat,
        -exhaustAmbientHeat, totalEnergyCorrection
    );

    // Écart d'interface entre le débit ajouté au collecteur et celui retiré du
    // volume de suralimentation. Il doit rester presque nul en fonctionnement
    // normal et révèle immédiatement une saturation de source asymétrique.
    state.throttleInterfaceMassMismatchStep
        = finite(state.intakeThrottleMassTransferStep)
        - finite(state.chargeAirThrottleMassTransferStep);
    state.throttleInterfaceEnergyMismatchStep
        = finite(state.intakeThrottleEnthalpyTransferStep)
        - finite(state.chargeAirThrottleEnthalpyTransferStep);
    state.throttleInterfaceMassMismatchRate
        = state.throttleInterfaceMassMismatchStep / dt;
    state.throttleInterfaceEnergyMismatchRate
        = state.throttleInterfaceEnergyMismatchStep / dt;
}

/**
 * Ferme les bilans du sous-pas et publie les diagnostics dans EngineState.
 */
export function finalizeConservationStep(state: EngineStateData, dt: number): void {
    if (!state._conservationCaptureActive
        || !Number.isFinite(dt) || dt <= 0) {
        return;
    }

    const cylinderMaxima = writeCylinderResiduals(state, dt);
    writeIntakeResiduals(state, dt);
    writeChargeAirResiduals(state, dt);
    writeExhaustResiduals(state, dt);
    writeGlobalResiduals(state, dt);

    state.maximumMassResidualPercent = Math.max(
        cylinderMaxima.maximumMassPercent,
        finite(state.intakeManifoldMassResidualPercent),
        finite(state.chargeAirMassResidualPercent),
        maximumAbsolute(state.exhaustScrollMassResidualPercent),
        finite(state.globalMassResidualPercent)
    );

    state.maximumEnergyResidualPercent = Math.max(
        cylinderMaxima.maximumEnergyPercent,
        finite(state.intakeManifoldEnergyResidualPercent),
        finite(state.chargeAirEnergyResidualPercent),
        maximumAbsolute(state.exhaustScrollEnergyResidualPercent),
        maximumAbsolute(state.exhaustWallEnergyResidualPercent),
        finite(state.globalEnergyResidualPercent)
    );

    state.cumulativeAbsoluteMassResidual += Math.abs(
        finite(state.globalMassResidualStep)
    );
    state.cumulativeAbsoluteEnergyResidual += Math.abs(
        finite(state.globalEnergyResidualStep)
    );
    state.conservationSubstepCount += 1;
}