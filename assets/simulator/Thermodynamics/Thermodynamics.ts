// Thermodynamique 0D des phases fermées du cylindre.
// Premier principe : dU = dQ_combustion - dQ_parois - P·dV.
// P et T sont reconstruits depuis U, la masse gazeuse et le volume instantané.

import { CYLINDER_OFFSETS } from "../Geometry/Geometry.js";
import type { ThermodynamicsModuleState } from "../engine/EngineStateTypes.js";
import {
    R_AIR,
    CV_CYLINDER_GAS
} from "../Physics/CompressibleFlow.js";
import { isIntakeValveOpen } from "../Valvetrain/IntakeValves.js";
import { isExhaustValveOpen } from "../Valvetrain/ExhaustValves.js";
import {
    calculateCylinderWallHeatTransfer
} from "./CylinderHeatTransfer.js";
import {
    COMBUSTION_HEAT_RELEASE_EFFICIENCY,
    LHV_FUEL,
    STOICHIOMETRIC_AFR
} from "../Fuel/FuelConstants.js";
import {
    WIEBE_CA50_NORMALIZED_POSITION,
    getCombustionDurationDegForRpm,
    getWiebeFraction
} from "../Combustion/Combustion.js";

export {
    getCombustionDurationDegForRpm,
    getIgnitionAdvanceForTargetCA50
} from "../Combustion/Combustion.js";

// Constantes de combustion

// Un mélange enrichi injecte davantage de carburant, mais l'oxygène disponible
// limite la masse pouvant réellement libérer son PCI. Sans cette garde, passer
// de 14.7 à 11.8 augmenterait artificiellement la puissance de 25 %, alors que
// le carburant excédentaire sert surtout au refroidissement et à la protection.
const RICH_MIXTURE_MAX_ADDITIONAL_HEAT_LOSS = 0.03;

// Gardes numériques

const MIN_PRESSURE = 1000;    // Pa
const MIN_TEMPERATURE = 150;  // K
const MAX_TEMPERATURE = 4500; // K — garde, pas une cible physique
const MIN_GAS_MASS = 1e-9;    // kg

// À dt = 0.1 ms, le transfert thermique normal est très inférieur à cette
// limite. Cette garde protège seulement le solveur lors d'une mauvaise
// initialisation ou d'une calibration extrême du coefficient thermique.
const MAX_WALL_ENERGY_FRACTION_PER_STEP = 0.08;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

// Outils d'état thermodynamique

function getTemperatureFromEnergy(mass: number, internalEnergy: number): number {
    const safeMass = Math.max(mass, MIN_GAS_MASS);

    return clamp(
        internalEnergy / (safeMass * CV_CYLINDER_GAS),
        MIN_TEMPERATURE,
        MAX_TEMPERATURE
    );
}

function getPressureFromState(
    mass: number,
    temperature: number,
    volume: number
): number {
    return Math.max(
        mass * R_AIR * temperature / Math.max(volume, 1e-9),
        MIN_PRESSURE
    );
}

/**
 * Initialise l'énergie interne si la simulation démarre directement dans une
 * phase fermée, ou si un état incomplet a été fourni par l'interface.
 */
function initializeClosedCylinderIfNeeded(
    state: ThermodynamicsModuleState,
    cylinderIndex: number
): void {
    const previousControlMass = Math.max(
        Number.isFinite(state.cylinderGasMass[cylinderIndex])
            ? state.cylinderGasMass[cylinderIndex]
            : 0,
        0
    ) + Math.max(
        Number.isFinite(state.burnedFuelMassInCylinder[cylinderIndex])
            ? state.burnedFuelMassInCylinder[cylinderIndex]
            : 0,
        0
    );
    const previousInternalEnergy = Number.isFinite(
        state.cylinderInternalEnergies[cylinderIndex]
    ) ? state.cylinderInternalEnergies[cylinderIndex] : 0;

    const V = Math.max(state.cylinderVolumes[cylinderIndex], 1e-9);
    const P = Math.max(
        state.cylinderPressures[cylinderIndex],
        MIN_PRESSURE
    );
    const T = Math.max(
        state.cylinderTemperatures[cylinderIndex],
        MIN_TEMPERATURE
    );

    if (!Number.isFinite(state.cylinderGasMass[cylinderIndex])
        || state.cylinderGasMass[cylinderIndex] <= 0) {
        state.cylinderGasMass[cylinderIndex] = Math.max(
            P * V / (R_AIR * T),
            MIN_GAS_MASS
        );
    }

    if (!Number.isFinite(state.cylinderInternalEnergies[cylinderIndex])
        || state.cylinderInternalEnergies[cylinderIndex] <= 0) {
        state.cylinderInternalEnergies[cylinderIndex]
            = state.cylinderGasMass[cylinderIndex]
            * CV_CYLINDER_GAS
            * T;
    }

    const newControlMass = Math.max(
        state.cylinderGasMass[cylinderIndex],
        0
    ) + Math.max(state.burnedFuelMassInCylinder[cylinderIndex], 0);
    if (Array.isArray(state.cylinderMassCorrectionStep)) {
        state.cylinderMassCorrectionStep[cylinderIndex]
            += newControlMass - previousControlMass;
    }
    if (Array.isArray(state.cylinderEnergyCorrectionStep)) {
        state.cylinderEnergyCorrectionStep[cylinderIndex]
            += state.cylinderInternalEnergies[cylinderIndex]
            - previousInternalEnergy;
    }
}

// Bilan d'énergie d'un cylindre fermé

function updateClosedCylinder(
    state: ThermodynamicsModuleState,
    cylinderIndex: number,
    theta: number,
    dV: number,
    dt: number,
    omega: number
): void {
    initializeClosedCylinderIfNeeded(state, cylinderIndex);

    const V = Math.max(state.cylinderVolumes[cylinderIndex], 1e-9);

    const initialPressure = Math.max(
        state.cylinderPressures[cylinderIndex],
        MIN_PRESSURE
    );
    const initialTemperature = Math.max(
        state.cylinderTemperatures[cylinderIndex],
        MIN_TEMPERATURE
    );
    const initialInternalEnergy = Math.max(
        state.cylinderInternalEnergies[cylinderIndex],
        MIN_GAS_MASS * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );

    // A. Dégagement de chaleur par la loi de Wiebe

    const ignitionTimingDeg = clamp(
        Number.isFinite(state.ignitionTimingDeg)
            ? state.ignitionTimingDeg
            : 15,
        -10,
        45
    );
    const combustionDurationDeg
        = getCombustionDurationDegForRpm(state.rpm);

    const ignitionStart = (360 - ignitionTimingDeg) * Math.PI / 180;
    const ignitionEnd = ignitionStart
        + combustionDurationDeg * Math.PI / 180;

    state.combustionDurationDeg = combustionDurationDeg;
    state.combustionCA50DegAfterTdc = -ignitionTimingDeg
        + WIEBE_CA50_NORMALIZED_POSITION * combustionDurationDeg;

    const previousTheta = theta - omega * dt;
    const previousBurnedFraction = getWiebeFraction(
        previousTheta,
        ignitionStart,
        ignitionEnd,
        combustionDurationDeg
    );
    const currentBurnedFraction = getWiebeFraction(
        theta,
        ignitionStart,
        ignitionEnd,
        combustionDurationDeg
    );

    const requestedBurnedFractionStep = Math.max(
        currentBurnedFraction - previousBurnedFraction,
        0
    );

    // En coupure de décélération, le cylindre continue de comprimer et
    // d'expanser l'air admis, mais aucun carburant n'est ajouté au cycle.
    // La décision a été mémorisée au front d'ouverture de l'admission.
    const combustionAllowed = state.cylinderFuelEnabled[cylinderIndex]
        && state.combustionEnabled
        && !state.revLimiterActive;

    const commandedFuelMass = combustionAllowed
        ? Math.max(
            state.trappedAirMass[cylinderIndex] / state.afr,
            0
        )
        : 0;
    const remainingCommandedFuelMass = Math.max(
        commandedFuelMass
        - state.burnedFuelMassInCylinder[cylinderIndex],
        0
    );

    // La progression de Wiebe est utilisée à la fois pour l'injection consommée
    // sur ce cycle et pour la masse qui participe chimiquement à la combustion.
    const requestedInjectedFuelMass
        = commandedFuelMass * requestedBurnedFractionStep;
    const injectedFuelMass = Math.min(
        requestedInjectedFuelMass,
        remainingCommandedFuelMass
    );

    // Fraction du carburant disposant réellement de suffisamment d'oxygène.
    // - AFR >= 14.7 : tout le carburant commandé peut brûler ;
    // - AFR < 14.7  : seule la fraction AFR/14.7 libère son PCI complet.
    const oxygenLimitedBurnFraction = clamp(
        state.afr / STOICHIOMETRIC_AFR,
        0,
        1
    );
    const chemicallyBurnedFuelMass = injectedFuelMass
        * oxygenLimitedBurnFraction;

    const richFraction = clamp(
        (STOICHIOMETRIC_AFR - state.afr)
        / (STOICHIOMETRIC_AFR - 11.0),
        0,
        1
    );
    const mixtureHeatReleaseEfficiency
        = COMBUSTION_HEAT_RELEASE_EFFICIENCY
        - RICH_MIXTURE_MAX_ADDITIONAL_HEAT_LOSS * richFraction;

    const chemicalEnergyReleased = chemicallyBurnedFuelMass * LHV_FUEL;
    const heatReleasedToGas = chemicalEnergyReleased
        * mixtureHeatReleaseEfficiency;

    // La consommation compte tout le carburant injecté, y compris la fraction
    // riche qui ne libère pas son PCI complet dans le cylindre.
    state.fuelMassBurnedStep += injectedFuelMass;
    state.fuelMassChemicallyBurnedStep += chemicallyBurnedFuelMass;
    state.burnedFuelMassInCylinder[cylinderIndex] += injectedFuelMass;
    if (Array.isArray(state.cylinderFuelMassAddedStep)) {
        state.cylinderFuelMassAddedStep[cylinderIndex] += injectedFuelMass;
    }

    // La masse thermodynamique contient la masse gazeuse admise/résiduelle et
    // la masse de carburant déjà transformée en produits de combustion.
    const thermodynamicMass = Math.max(
        state.cylinderGasMass[cylinderIndex]
        + state.burnedFuelMassInCylinder[cylinderIndex],
        MIN_GAS_MASS
    );

    // B. Première estimation : pertes parois et travail P dV

    const middleBurnedFraction = 0.5
        * (previousBurnedFraction + currentBurnedFraction);

    const initialWallTransfer = calculateCylinderWallHeatTransfer(
        initialPressure,
        initialTemperature,
        V,
        state.rpm,
        middleBurnedFraction
    );

    // Prédicteur explicite. Il sert uniquement à obtenir une pression et une
    // température de fin de pas pour moyenner ensuite le travail et les pertes.
    let predictedInternalEnergy = initialInternalEnergy
        + heatReleasedToGas
        - initialWallTransfer.heatTransferRateToWalls * dt
        - initialPressure * dV;

    const minimumInternalEnergy = thermodynamicMass
        * CV_CYLINDER_GAS
        * MIN_TEMPERATURE;
    const maximumInternalEnergy = thermodynamicMass
        * CV_CYLINDER_GAS
        * MAX_TEMPERATURE;

    predictedInternalEnergy = clamp(
        predictedInternalEnergy,
        minimumInternalEnergy,
        maximumInternalEnergy
    );

    const predictedTemperature = getTemperatureFromEnergy(
        thermodynamicMass,
        predictedInternalEnergy
    );
    const predictedPressure = getPressureFromState(
        thermodynamicMass,
        predictedTemperature,
        V
    );

    // C. Correcteur trapézoïdal

    const predictedWallTransfer = calculateCylinderWallHeatTransfer(
        predictedPressure,
        predictedTemperature,
        V,
        state.rpm,
        middleBurnedFraction
    );

    // Puissance moyenne sur le pas, puis énergie réellement perdue aux parois.
    const averageWallHeatTransferRate = 0.5 * (
        initialWallTransfer.heatTransferRateToWalls
        + predictedWallTransfer.heatTransferRateToWalls
    );

    let wallHeatTransfer = averageWallHeatTransferRate * dt;

    // Limite de sécurité symétrique : elle s'applique aussi lorsque la paroi
    // réchauffe le gaz et que wallHeatTransfer devient négatif.
    const maximumWallEnergyMagnitude = Math.max(
        Math.abs(initialInternalEnergy + heatReleasedToGas)
        * MAX_WALL_ENERGY_FRACTION_PER_STEP,
        1
    );

    wallHeatTransfer = clamp(
        wallHeatTransfer,
        -maximumWallEnergyMagnitude,
        maximumWallEnergyMagnitude
    );

    // Travail de frontière positif pendant la détente et négatif pendant la
    // compression. La pression moyenne réduit l'erreur d'intégration par rapport
    // à l'utilisation de la seule pression de début de pas.
    const boundaryWork = 0.5
        * (initialPressure + predictedPressure)
        * dV;

    let finalInternalEnergy = initialInternalEnergy
        + heatReleasedToGas
        - wallHeatTransfer
        - boundaryWork;

    const unclampedFinalInternalEnergy = finalInternalEnergy;
    finalInternalEnergy = clamp(
        finalInternalEnergy,
        minimumInternalEnergy,
        maximumInternalEnergy
    );
    if (Array.isArray(state.cylinderEnergyCorrectionStep)) {
        state.cylinderEnergyCorrectionStep[cylinderIndex]
            += finalInternalEnergy - unclampedFinalInternalEnergy;
    }

    const finalTemperature = getTemperatureFromEnergy(
        thermodynamicMass,
        finalInternalEnergy
    );
    const finalPressure = getPressureFromState(
        thermodynamicMass,
        finalTemperature,
        V
    );

    // D. Écriture de l'état et diagnostics

    state.cylinderInternalEnergies[cylinderIndex]
        = finalInternalEnergy;
    state.cylinderTemperatures[cylinderIndex]
        = finalTemperature;
    state.cylinderPressures[cylinderIndex]
        = finalPressure;

    state.cylinderHeatReleaseStep[cylinderIndex]
        = heatReleasedToGas;
    state.cylinderWallHeatTransferStep[cylinderIndex]
        = wallHeatTransfer;
    state.cylinderBoundaryWorkStep[cylinderIndex]
        = boundaryWork;

    state.cylinderHeatReleaseRate[cylinderIndex]
        = heatReleasedToGas / dt;
    state.cylinderWallHeatTransferRate[cylinderIndex]
        = wallHeatTransfer / dt;
    state.cylinderBoundaryWorkRate[cylinderIndex]
        = boundaryWork / dt;

    state.cylinderHeatTransferCoefficient[cylinderIndex]
        = 0.5 * (
        initialWallTransfer.heatTransferCoefficient
        + predictedWallTransfer.heatTransferCoefficient
    );
    state.cylinderHeatTransferArea[cylinderIndex]
        = predictedWallTransfer.totalWallArea;
    state.cylinderEffectiveWallTemperature[cylinderIndex]
        = predictedWallTransfer.effectiveWallTemperature;

    // Le cumul ne compte que la chaleur réellement perdue par le gaz.
    // Une valeur négative correspond à un réchauffement par les parois et ne
    // ne réduit donc pas le cumul des pertes thermiques positives.
    state.cumulativeCylinderWallHeatLoss += Math.max(
        wallHeatTransfer,
        0
    );

    state.totalCylinderHeatReleaseRate
        += heatReleasedToGas / dt;
    state.totalCylinderWallHeatLossRate
        += wallHeatTransfer / dt;
    state.totalCylinderBoundaryWorkRate
        += boundaryWork / dt;
}

// Mise à jour thermodynamique complète

export function updateThermodynamics(
    state: ThermodynamicsModuleState,
    dt: number
): void {
    if (dt <= 0) {
        return;
    }

    // Remise à zéro à chaque pas. Fuel.js intègre uniquement la masse réellement
    // brûlée pendant ce dt, tandis que les diagnostics Chart.js affichent des
    // puissances instantanées non cumulées.
    state.fuelMassBurnedStep = 0;
    state.fuelMassChemicallyBurnedStep = 0;
    state.totalCylinderHeatReleaseRate = 0;
    state.totalCylinderWallHeatLossRate = 0;
    state.totalCylinderBoundaryWorkRate = 0;

    const omega = state.rpm * 2 * Math.PI / 60;

    for (let i = 0; i < 4; i++) {
        state.cylinderHeatReleaseStep[i] = 0;
        state.cylinderWallHeatTransferStep[i] = 0;
        state.cylinderBoundaryWorkStep[i] = 0;
        state.cylinderHeatReleaseRate[i] = 0;
        state.cylinderWallHeatTransferRate[i] = 0;
        state.cylinderBoundaryWorkRate[i] = 0;
        state.cylinderHeatTransferCoefficient[i] = 0;
        state.cylinderHeatTransferArea[i] = 0;

        const theta = (
            state.crankAngle + CYLINDER_OFFSETS[i]
        ) % (4 * Math.PI);

        // Fraction cumulée exposée au recorder 720°. Elle utilise exactement la
        // même loi de Wiebe, la même avance et la même durée que le bilan fermé.
        // Pendant l'admission du cycle suivant, l'angle repasse sous l'allumage
        // et la fraction revient naturellement à zéro.
        const recorderIgnitionTimingDeg = clamp(
            Number.isFinite(state.ignitionTimingDeg)
                ? state.ignitionTimingDeg
                : 15,
            -10,
            45
        );
        const recorderCombustionDurationDeg
            = getCombustionDurationDegForRpm(state.rpm);
        const recorderIgnitionStart = (
            360 - recorderIgnitionTimingDeg
        ) * Math.PI / 180;
        const recorderIgnitionEnd = recorderIgnitionStart
            + recorderCombustionDurationDeg * Math.PI / 180;
        const recorderCombustionAllowed
            = state.cylinderFuelEnabled[i]
            && state.combustionEnabled
            && !state.revLimiterActive;

        state.cylinderBurnedFraction[i] = recorderCombustionAllowed
            ? getWiebeFraction(
                theta,
                recorderIgnitionStart,
                recorderIgnitionEnd,
                recorderCombustionDurationDeg
            )
            : 0;

        const V = Math.max(state.cylinderVolumes[i], 1e-9);
        const previousV = state.prevCylinderVolumes[i] > 0
            ? state.prevCylinderVolumes[i]
            : V;
        const dV = V - previousV;

        // A. Phases ouvertes vers les collecteurs

        // IntakeManifold.js et ExhaustManifold.js ont déjà calculé pour les
        // phases ouvertes :
        // - le travail du piston ;
        // - les flux de masse ;
        // - les flux d'enthalpie ;
        // - la nouvelle pression et la nouvelle température.
        // Le module fermé doit impérativement les ignorer afin de ne pas
        // appliquer une seconde fois le terme P dV.
        if (isIntakeValveOpen(theta) || isExhaustValveOpen(theta)) {
            continue;
        }

        // B. Compression, combustion et détente fermées

        updateClosedCylinder(
            state,
            i,
            theta,
            dV,
            dt,
            omega
        );
    }
}