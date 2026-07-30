// Modèle 0D dynamique du collecteur situé APRÈS le papillon.
// Trois phénomènes couplés sont résolus :
// 1. Débit compressible à travers le papillon.
// 2. Stockage de masse et d'énergie dans le collecteur.
// 3. Débit compressible bidirectionnel à travers les soupapes d'admission.
// La pression du collecteur et la pression des cylindres ne sont donc plus
// imposées pendant l'admission. Elles résultent des bilans de masse et d'énergie.

import { CYLINDER_OFFSETS } from "../Geometry/Geometry.js";
import type { IntakeManifoldModuleState } from "../engine/EngineStateTypes.js";
import {
    R_AIR,
    CV_AIR,
    CP_AIR,
    CV_CYLINDER_GAS,
    CP_CYLINDER_GAS,
    calculateBidirectionalCompressibleMassFlow
} from "../Physics/CompressibleFlow.js";
import {
    getIntakeValveLift,
    getIntakeValveFlowArea,
    isIntakeValveOpen,
    getIntakeValveDischargeCoefficient
} from "../Valvetrain/IntakeValves.js";

// Conditions amont de secours

// L'amont du papillon est le volume de suralimentation géré par
// Turbocharger.js. Ces valeurs servent uniquement de repli avant son premier pas
// d'initialisation ou si le module turbo est volontairement désactivé.
const DEFAULT_UPSTREAM_PRESSURE = 101325; // Pa
const DEFAULT_UPSTREAM_TEMPERATURE = 293; // K, environ 20°C

// Géométrie du collecteur et du papillon

// Volume 0D équivalent du plénum et des conduits jusqu'aux soupapes.
// Valeur initiale de calibration : 3 litres.
export const INTAKE_MANIFOLD_VOLUME = 0.0030; // m³

// Diamètre équivalent du corps de papillon.
const THROTTLE_DIAMETER = 0.060; // m — valeur de travail : 60 mm
const THROTTLE_MAX_AREA = Math.PI
    * Math.pow(THROTTLE_DIAMETER, 2)
    / 4; // m²

// Fuite minimale lorsque le papillon et l'actuateur de ralenti sont fermés.
// Elle représente les jeux mécaniques et empêche un volume parfaitement isolé.
const CLOSED_THROTTLE_LEAK_AREA = 2e-6; // m² — 2 mm²

// Aire maximale du circuit de dérivation piloté par le correcteur de ralenti.
// La commande state.idleAirControlCommand varie entre 0 et 1.
const IDLE_CONTROL_MAX_AREA = 34e-6; // m² — 34 mm²

// Relation non linéaire commande → aire. Une commande de 10 % ne découvre pas
// 10 % de l'aire maximale d'un vrai papillon circulaire.
const THROTTLE_AREA_EXPONENT = 1.70;

// Pertes de contraction et de turbulence au corps de papillon.
const THROTTLE_DISCHARGE_COEFFICIENT = 0.72;

// Échanges thermiques du collecteur

// Température équivalente des parois du collecteur.
// Elle maintient progressivement l'air proche de la température du compartiment
// moteur sans imposer instantanément sa température.
const MANIFOLD_WALL_TEMPERATURE = 315; // K, environ 42°C

// Constante de temps du retour thermique vers la paroi.
// Une valeur élevée limite l'influence thermique et conserve des transitoires doux.
const MANIFOLD_HEAT_TRANSFER_TAU = 0.50; // s

// Gardes numériques

const MIN_MANIFOLD_PRESSURE = 1000; // Pa
const MIN_CYLINDER_PRESSURE = 1000; // Pa
const MIN_TEMPERATURE = 150;        // K
const MAX_TEMPERATURE = 2000;       // K
const MIN_GAS_MASS = 1e-9;          // kg

// Fraction maximale de la masse d'un volume transférable en un seul pas.
// À dt = 0.1 ms, cette limite ne doit normalement jamais être atteinte ; elle
// protège uniquement le solveur d'un saut de pression ou d'un mauvais dt.
const MAX_SOURCE_MASS_FRACTION_PER_STEP = 0.25;

// Aire effective du papillon

interface ThrottleEffectiveArea {
    totalArea: number;
    idleBypassArea: number;
}

function getThrottleEffectiveArea(
    throttle: number,
    idleAirControlCommand: number
): ThrottleEffectiveArea {
    const clampedThrottle = Math.max(0, Math.min(1, throttle));
    const clampedIdleCommand = Math.max(
        0,
        Math.min(1, idleAirControlCommand || 0)
    );

    // Partie commandée directement par la pédale.
    const movableArea = (THROTTLE_MAX_AREA - CLOSED_THROTTLE_LEAK_AREA)
        * Math.pow(clampedThrottle, THROTTLE_AREA_EXPONENT);

    // Circuit de dérivation indépendant du papillon. C'est cette aire que le
    // correcteur PI de EngineControl.js module pour stabiliser le ralenti.
    const idleBypassArea = IDLE_CONTROL_MAX_AREA * clampedIdleCommand;

    return {
        totalArea: CLOSED_THROTTLE_LEAK_AREA
            + idleBypassArea
            + movableArea,
        idleBypassArea
    };
}

// Initialisation des volumes 0D

function initializeManifoldIfNeeded(state: IntakeManifoldModuleState): void {
    const initialTemperature = Math.max(
        state.intakeTemperature,
        MIN_TEMPERATURE
    );

    if (!Number.isFinite(state.intakeManifoldMass)
        || state.intakeManifoldMass <= 0) {
        state.intakeManifoldMass = Math.max(
                state.intakePressure,
                MIN_MANIFOLD_PRESSURE
            ) * INTAKE_MANIFOLD_VOLUME
            / (R_AIR * initialTemperature);
    }

    if (!Number.isFinite(state.intakeManifoldInternalEnergy)
        || state.intakeManifoldInternalEnergy <= 0) {
        state.intakeManifoldInternalEnergy = state.intakeManifoldMass
            * CV_AIR
            * initialTemperature;
    }
}

/**
 * Réinitialise l'état gazeux du cylindre au moment où la soupape d'admission
 * commence un nouveau cycle.
 *
 * La masse résiduelle est déduite de P, V et T à la fin de l'échappement.
 * La masse d'air frais est remise à zéro puis intégrée à partir
 * du débit réel traversant les soupapes.
 */
function initializeCylinderForIntake(
    state: IntakeManifoldModuleState,
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
        MIN_CYLINDER_PRESSURE
    );
    const T = Math.max(
        state.cylinderTemperatures[cylinderIndex],
        MIN_TEMPERATURE
    );

    const residualGasMass = P * V / (R_AIR * T);

    state.cylinderGasMass[cylinderIndex] = Math.max(
        residualGasMass,
        MIN_GAS_MASS
    );

    state.cylinderInternalEnergies[cylinderIndex]
        = state.cylinderGasMass[cylinderIndex] * CV_CYLINDER_GAS * T;

    // Cette variable représente uniquement la masse d'air frais
    // admise pendant le cycle courant. Elle servira au calcul du carburant.
    state.trappedAirMass[cylinderIndex] = 0;
    state.burnedFuelMassInCylinder[cylinderIndex] = 0;

    // La décision d'injection reste figée pour le cycle : un lever de pied
    // ultérieur ne supprime pas un mélange déjà admis.
    state.cylinderFuelEnabled[cylinderIndex] = state.combustionEnabled
        && !state.fuelCutActive
        && !state.revLimiterActive;

    // La remise à l'état résiduel est une correction explicite du modèle, pas
    // un débit traversant une soupape. Elle est donc publiée séparément afin que
    // le résidu de fermeture ne la confonde pas avec une erreur numérique.
    if (Array.isArray(state.cylinderMassCorrectionStep)) {
        const newControlMass = state.cylinderGasMass[cylinderIndex]
            + state.burnedFuelMassInCylinder[cylinderIndex];
        state.cylinderMassCorrectionStep[cylinderIndex]
            += newControlMass - previousControlMass;
    }
    if (Array.isArray(state.cylinderEnergyCorrectionStep)) {
        state.cylinderEnergyCorrectionStep[cylinderIndex]
            += state.cylinderInternalEnergies[cylinderIndex]
            - previousInternalEnergy;
    }
}

// Outils d'état thermodynamique

function getTemperatureFromMassAndEnergy(
    mass: number,
    internalEnergy: number,
    specificHeatAtConstantVolume: number = CV_AIR
): number {
    if (mass <= MIN_GAS_MASS) {
        return MIN_TEMPERATURE;
    }

    return Math.max(
        MIN_TEMPERATURE,
        Math.min(
            MAX_TEMPERATURE,
            internalEnergy / (mass * specificHeatAtConstantVolume)
        )
    );
}

function getPressureFromMassTemperatureVolume(
    mass: number,
    temperature: number,
    volume: number
): number {
    return Math.max(
        MIN_CYLINDER_PRESSURE,
        mass * R_AIR * temperature / Math.max(volume, 1e-9)
    );
}

// Transfert à travers une soupape d'admission

/**
 * Met à jour un cylindre ouvert vers le collecteur.
 *
 * Le bilan d'énergie du cylindre pendant le pas est :
 *
 *     dU = -P dV + dm_entrant Cp T_amont - dm_sortant Cp T_cylindre
 *
 * Le premier terme représente le travail du piston. Les termes en Cp*T sont
 * les flux d'enthalpie transportés par la masse à travers la soupape.
 *
 * @returns {object} Masses transférées et débit signé pour les diagnostics
 */
interface IntakeValveTransferResult {
    signedMassFlow: number;
    freshAirIntoCylinder: number;
    reversionMassToManifold: number;
}

function updateCylinderIntakeValve(
    state: IntakeManifoldModuleState,
    cylinderIndex: number,
    dt: number
): IntakeValveTransferResult {
    const thetaLocal = (
        state.crankAngle + CYLINDER_OFFSETS[cylinderIndex]
    ) % (4 * Math.PI);

    const valveOpen = isIntakeValveOpen(thetaLocal);
    const valveLift = getIntakeValveLift(thetaLocal);
    const valveArea = getIntakeValveFlowArea(thetaLocal);

    state.intakeValveLift[cylinderIndex] = valveLift;
    state.intakeValveEffectiveArea[cylinderIndex] = valveArea;

    // Détection du front d'ouverture. L'état est stocké dans EngineState afin que
    // plusieurs instances de moteur restent totalement indépendantes.
    if (valveOpen && !state.wasIntakeValveOpen[cylinderIndex]) {
        initializeCylinderForIntake(state, cylinderIndex);
    }

    state.wasIntakeValveOpen[cylinderIndex] = valveOpen;

    if (!valveOpen || valveArea <= 0) {
        state.intakeValveMassFlow[cylinderIndex] = 0;
        return {
            signedMassFlow: 0,
            freshAirIntoCylinder: 0,
            reversionMassToManifold: 0
        };
    }

    // Sécurité en cas de démarrage de la simulation directement au milieu d'une
    // admission, sans avoir encore détecté le front d'ouverture.
    if (!Number.isFinite(state.cylinderGasMass[cylinderIndex])
        || state.cylinderGasMass[cylinderIndex] <= 0
        || !Number.isFinite(state.cylinderInternalEnergies[cylinderIndex])
        || state.cylinderInternalEnergies[cylinderIndex] <= 0) {
        initializeCylinderForIntake(state, cylinderIndex);
    }

    const V = Math.max(state.cylinderVolumes[cylinderIndex], 1e-9);
    const previousV = state.prevCylinderVolumes[cylinderIndex] > 0
        ? state.prevCylinderVolumes[cylinderIndex]
        : V;
    const dV = V - previousV;

    let cylinderMass = state.cylinderGasMass[cylinderIndex];
    let cylinderEnergy = state.cylinderInternalEnergies[cylinderIndex];
    let cylinderPressure = Math.max(
        state.cylinderPressures[cylinderIndex],
        MIN_CYLINDER_PRESSURE
    );

    // Travail de frontière dû au déplacement du piston.
    // Si le volume augmente, le gaz fournit du travail et son énergie diminue.
    const boundaryWork = cylinderPressure * dV;
    cylinderEnergy -= boundaryWork;
    if (Array.isArray(state.cylinderOpenBoundaryWorkStep)) {
        state.cylinderOpenBoundaryWorkStep[cylinderIndex] += boundaryWork;
    }
    cylinderEnergy = Math.max(
        cylinderEnergy,
        MIN_GAS_MASS * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );

    let cylinderTemperature = getTemperatureFromMassAndEnergy(
        cylinderMass,
        cylinderEnergy,
        CV_CYLINDER_GAS
    );

    cylinderPressure = getPressureFromMassTemperatureVolume(
        cylinderMass,
        cylinderTemperature,
        V
    );

    let manifoldMass = state.intakeManifoldMass;
    let manifoldEnergy = state.intakeManifoldInternalEnergy;
    let manifoldTemperature = getTemperatureFromMassAndEnergy(
        manifoldMass,
        manifoldEnergy
    );
    let manifoldPressure = manifoldMass
        * R_AIR
        * manifoldTemperature
        / INTAKE_MANIFOLD_VOLUME;

    // Débit positif : collecteur → cylindre.
    // Débit négatif : cylindre → collecteur, donc reflux d'admission.
    const valveDischargeCoefficient
        = getIntakeValveDischargeCoefficient(state.rpm, thetaLocal);
    state.intakeValveDischargeCoefficient = valveDischargeCoefficient;

    const requestedMassFlow = calculateBidirectionalCompressibleMassFlow(
        manifoldPressure,
        manifoldTemperature,
        cylinderPressure,
        cylinderTemperature,
        valveArea,
        valveDischargeCoefficient
    );

    let actualMassFlow = requestedMassFlow;
    let freshAirIntoCylinder = 0;
    let reversionMassToManifold = 0;
    let signedEnthalpyToCylinder = 0;

    if (requestedMassFlow > 0) {
        const requestedMass = requestedMassFlow * dt;
        const maximumTransferableMass = manifoldMass
            * MAX_SOURCE_MASS_FRACTION_PER_STEP;
        const transferredMass = Math.min(
            requestedMass,
            maximumTransferableMass
        );

        // L'enthalpie quitte le collecteur et entre dans le cylindre.
        const transferredEnthalpy = transferredMass
            * CP_AIR
            * manifoldTemperature;

        manifoldMass -= transferredMass;
        manifoldEnergy -= transferredEnthalpy;

        cylinderMass += transferredMass;
        cylinderEnergy += transferredEnthalpy;

        // Toute masse issue du collecteur est considérée comme de l'air frais.
        state.trappedAirMass[cylinderIndex] += transferredMass;
        freshAirIntoCylinder = transferredMass;
        actualMassFlow = transferredMass / dt;
        signedEnthalpyToCylinder = transferredEnthalpy;
    } else if (requestedMassFlow < 0) {
        const requestedMass = -requestedMassFlow * dt;
        const maximumTransferableMass = cylinderMass
            * MAX_SOURCE_MASS_FRACTION_PER_STEP;
        const transferredMass = Math.min(
            requestedMass,
            maximumTransferableMass
        );

        // Composition moyenne du gaz dans le cylindre. Le reflux retire la même
        // proportion d'air frais et de gaz résiduel que celle présente dans le volume.
        const freshAirFraction = Math.max(
            0,
            Math.min(
                1,
                state.trappedAirMass[cylinderIndex] / cylinderMass
            )
        );

        const freshAirReturned = transferredMass * freshAirFraction;
        const transferredEnthalpy = transferredMass
            * CP_CYLINDER_GAS
            * cylinderTemperature;

        cylinderMass -= transferredMass;
        cylinderEnergy -= transferredEnthalpy;
        state.trappedAirMass[cylinderIndex] = Math.max(
            0,
            state.trappedAirMass[cylinderIndex] - freshAirReturned
        );

        manifoldMass += transferredMass;
        manifoldEnergy += transferredEnthalpy;

        reversionMassToManifold = transferredMass;
        actualMassFlow = -transferredMass / dt;
        signedEnthalpyToCylinder = -transferredEnthalpy;
    }

    // Gardes de positivité après le transfert. Toute correction effectivement
    // appliquée est séparée du flux physique pour le diagnostic de conservation.
    const unclampedCylinderMass = cylinderMass;
    const unclampedCylinderEnergy = cylinderEnergy;
    cylinderMass = Math.max(cylinderMass, MIN_GAS_MASS);
    cylinderEnergy = Math.max(
        cylinderEnergy,
        cylinderMass * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );

    const unclampedManifoldMass = manifoldMass;
    const unclampedManifoldEnergy = manifoldEnergy;
    manifoldMass = Math.max(manifoldMass, MIN_GAS_MASS);
    manifoldEnergy = Math.max(
        manifoldEnergy,
        manifoldMass * CV_AIR * MIN_TEMPERATURE
    );

    if (Array.isArray(state.cylinderMassCorrectionStep)) {
        state.cylinderMassCorrectionStep[cylinderIndex]
            += cylinderMass - unclampedCylinderMass;
    }
    if (Array.isArray(state.cylinderEnergyCorrectionStep)) {
        state.cylinderEnergyCorrectionStep[cylinderIndex]
            += cylinderEnergy - unclampedCylinderEnergy;
    }
    state.intakeManifoldMassCorrectionStep
        += manifoldMass - unclampedManifoldMass;
    state.intakeManifoldEnergyCorrectionStep
        += manifoldEnergy - unclampedManifoldEnergy;

    cylinderTemperature = getTemperatureFromMassAndEnergy(
        cylinderMass,
        cylinderEnergy,
        CV_CYLINDER_GAS
    );
    cylinderPressure = getPressureFromMassTemperatureVolume(
        cylinderMass,
        cylinderTemperature,
        V
    );

    state.cylinderGasMass[cylinderIndex] = cylinderMass;
    state.cylinderInternalEnergies[cylinderIndex] = cylinderEnergy;
    state.cylinderTemperatures[cylinderIndex] = cylinderTemperature;
    state.cylinderPressures[cylinderIndex] = cylinderPressure;

    state.intakeManifoldMass = manifoldMass;
    state.intakeManifoldInternalEnergy = manifoldEnergy;
    state.intakeValveMassFlow[cylinderIndex] = actualMassFlow;

    if (Array.isArray(state.cylinderIntakeEnthalpyTransferStep)) {
        state.cylinderIntakeEnthalpyTransferStep[cylinderIndex]
            += signedEnthalpyToCylinder;
    }
    if (Array.isArray(state.intakeValveEnthalpyTransferStep)) {
        state.intakeValveEnthalpyTransferStep[cylinderIndex]
            += signedEnthalpyToCylinder;
    }

    return {
        signedMassFlow: actualMassFlow,
        freshAirIntoCylinder,
        reversionMassToManifold
    };
}

// Mise à jour complète du circuit d'admission

/**
 * Met à jour le papillon, le collecteur et toutes les soupapes d'admission.
 *
 * @param {object} state État global du moteur
 * @param {number} dt Pas de temps en secondes
 */
export function updateIntakeManifold(
    state: IntakeManifoldModuleState,
    dt: number
): void {
    if (dt <= 0) {
        return;
    }

    const massBeforeInitialization = Number.isFinite(state.intakeManifoldMass)
        ? state.intakeManifoldMass
        : 0;
    const energyBeforeInitialization = Number.isFinite(
        state.intakeManifoldInternalEnergy
    ) ? state.intakeManifoldInternalEnergy : 0;

    initializeManifoldIfNeeded(state);

    state.intakeManifoldMassCorrectionStep
        += state.intakeManifoldMass - massBeforeInitialization;
    state.intakeManifoldEnergyCorrectionStep
        += state.intakeManifoldInternalEnergy - energyBeforeInitialization;

    let manifoldMass = state.intakeManifoldMass;
    let manifoldEnergy = state.intakeManifoldInternalEnergy;
    let manifoldTemperature = getTemperatureFromMassAndEnergy(
        manifoldMass,
        manifoldEnergy
    );
    let manifoldPressure = manifoldMass
        * R_AIR
        * manifoldTemperature
        / INTAKE_MANIFOLD_VOLUME;

    // A. Débit à travers le papillon

    const throttleGeometry = getThrottleEffectiveArea(
        state.throttle,
        state.idleAirControlCommand
    );
    const throttleArea = throttleGeometry.totalArea;

    // L'amont du papillon est le volume compresseur + intercooler. Avant le
    // spool, sa pression reste proche de l'atmosphère et le moteur se comporte
    // naturellement comme un moteur atmosphérique. Sous boost, le même orifice
    // transmet davantage de masse sans aucune table de rendement volumétrique.
    const upstreamPressure = Number.isFinite(state.chargeAirPressure)
        ? Math.max(state.chargeAirPressure, MIN_MANIFOLD_PRESSURE)
        : DEFAULT_UPSTREAM_PRESSURE;
    const upstreamTemperature = Number.isFinite(state.chargeAirTemperature)
        ? Math.max(state.chargeAirTemperature, MIN_TEMPERATURE)
        : DEFAULT_UPSTREAM_TEMPERATURE;

    // Convention positive : volume de charge → collecteur d'admission.
    // Le débit reste bidirectionnel afin qu'un retour de pression vers la
    // tuyauterie de suralimentation soit conservé physiquement.
    const requestedThrottleMassFlow
        = calculateBidirectionalCompressibleMassFlow(
        upstreamPressure,
        upstreamTemperature,
        manifoldPressure,
        manifoldTemperature,
        throttleArea,
        THROTTLE_DISCHARGE_COEFFICIENT
    );

    let actualThrottleMassFlow = requestedThrottleMassFlow;
    let throttleMassTransfer = 0;
    let throttleEnthalpyTransfer = 0;

    if (requestedThrottleMassFlow >= 0) {
        const incomingMass = requestedThrottleMassFlow * dt;
        const incomingEnthalpy = incomingMass * CP_AIR * upstreamTemperature;
        manifoldMass += incomingMass;
        manifoldEnergy += incomingEnthalpy;
        throttleMassTransfer = incomingMass;
        throttleEnthalpyTransfer = incomingEnthalpy;
    } else {
        const requestedOutgoingMass = -requestedThrottleMassFlow * dt;
        const maximumOutgoingMass = manifoldMass
            * MAX_SOURCE_MASS_FRACTION_PER_STEP;
        const outgoingMass = Math.min(
            requestedOutgoingMass,
            maximumOutgoingMass
        );

        const outgoingEnthalpy = outgoingMass
            * CP_AIR
            * manifoldTemperature;
        manifoldMass -= outgoingMass;
        manifoldEnergy -= outgoingEnthalpy;
        actualThrottleMassFlow = -outgoingMass / dt;
        throttleMassTransfer = -outgoingMass;
        throttleEnthalpyTransfer = -outgoingEnthalpy;
    }

    state.intakeThrottleMassTransferStep += throttleMassTransfer;
    state.intakeThrottleEnthalpyTransferStep += throttleEnthalpyTransfer;

    const throttleUnclampedMass = manifoldMass;
    const throttleUnclampedEnergy = manifoldEnergy;
    state.intakeManifoldMass = Math.max(manifoldMass, MIN_GAS_MASS);
    state.intakeManifoldInternalEnergy = Math.max(
        manifoldEnergy,
        state.intakeManifoldMass * CV_AIR * MIN_TEMPERATURE
    );
    state.intakeManifoldMassCorrectionStep
        += state.intakeManifoldMass - throttleUnclampedMass;
    state.intakeManifoldEnergyCorrectionStep
        += state.intakeManifoldInternalEnergy - throttleUnclampedEnergy;

    // B. Débits à travers les soupapes d'admission

    let totalNetCylinderMassFlow = 0;
    let totalFreshAirMass = 0;
    let totalReversionMass = 0;

    for (let i = 0; i < 4; i++) {
        const transfer = updateCylinderIntakeValve(state, i, dt);

        totalNetCylinderMassFlow += transfer.signedMassFlow;
        totalFreshAirMass += transfer.freshAirIntoCylinder;
        totalReversionMass += transfer.reversionMassToManifold;
    }

    // C. Échange thermique avec les parois du collecteur

    manifoldMass = state.intakeManifoldMass;
    manifoldEnergy = state.intakeManifoldInternalEnergy;
    manifoldTemperature = getTemperatureFromMassAndEnergy(
        manifoldMass,
        manifoldEnergy
    );

    const targetWallEnergy = manifoldMass
        * CV_AIR
        * MANIFOLD_WALL_TEMPERATURE;

    const manifoldWallHeatTransfer = (
        targetWallEnergy - manifoldEnergy
    ) / MANIFOLD_HEAT_TRANSFER_TAU * dt;
    manifoldEnergy += manifoldWallHeatTransfer;
    state.intakeManifoldWallHeatTransferStep
        += manifoldWallHeatTransfer;

    // Masse minimale équivalente à la pression minimale de garde.
    const minimumManifoldMass = MIN_MANIFOLD_PRESSURE
        * INTAKE_MANIFOLD_VOLUME
        / (R_AIR * Math.max(manifoldTemperature, MIN_TEMPERATURE));

    const finalUnclampedMass = manifoldMass;
    const finalUnclampedEnergy = manifoldEnergy;
    manifoldMass = Math.max(manifoldMass, minimumManifoldMass);
    manifoldEnergy = Math.max(
        manifoldEnergy,
        manifoldMass * CV_AIR * MIN_TEMPERATURE
    );
    state.intakeManifoldMassCorrectionStep
        += manifoldMass - finalUnclampedMass;
    state.intakeManifoldEnergyCorrectionStep
        += manifoldEnergy - finalUnclampedEnergy;

    manifoldTemperature = getTemperatureFromMassAndEnergy(
        manifoldMass,
        manifoldEnergy
    );
    manifoldPressure = manifoldMass
        * R_AIR
        * manifoldTemperature
        / INTAKE_MANIFOLD_VOLUME;

    state.intakeManifoldMass = manifoldMass;
    state.intakeManifoldInternalEnergy = manifoldEnergy;
    state.intakeTemperature = manifoldTemperature;
    state.intakePressure = manifoldPressure;

    // Diagnostics utiles pour Chart.js et la calibration.
    state.throttleEffectiveArea = throttleArea;
    state.idleBypassEffectiveArea = throttleGeometry.idleBypassArea;
    state.intakeAirMassFlow = actualThrottleMassFlow;
    state.cylinderAirMassFlow = totalNetCylinderMassFlow;
    state.freshCylinderAirMassFlow = totalFreshAirMass / dt;
    state.intakeReversionMassFlow = totalReversionMass / dt;
}