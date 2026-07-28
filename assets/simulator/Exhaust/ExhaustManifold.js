// Échappement 0D twin-entry : blowdown, deux scrolls, contre-pression,
// bilans masse/énergie et débits séparés vers turbine et wastegate.

import { CYLINDER_OFFSETS } from "../Geometry/Geometry.js";
import {
    R_AIR,
    GAMMA_CYLINDER_GAS,
    CV_CYLINDER_GAS,
    CP_CYLINDER_GAS,
    calculateOneWayCompressibleMassFlow,
    calculateBidirectionalCompressibleMassFlow
} from "../Physics/CompressibleFlow.js";
import {
    getExhaustValveLift,
    getExhaustValveFlowArea,
    isExhaustValveOpen,
    getExhaustValveDischargeCoefficient
} from "../Valvetrain/ExhaustValves.js";
import {
    calculateCylinderWallHeatTransfer
} from "../Thermodynamics/CylinderHeatTransfer.js";
import {
    calculateTurboExhaustBoundary
} from "../Turbo/Turbocharger.js";

// Architecture twin-entry du 3s-gte

// Les cylindres sont indexés dans le code : 0=1, 1=2, 2=3, 3=4.
// Le collecteur twin-entry sépare les groupes 1+4 et 2+3. Cette séparation
// conserve les impulsions d'échappement pour la turbine twin-entry.
export const EXHAUST_SCROLL_BY_CYLINDER = [0, 1, 1, 0];
export const EXHAUST_SCROLL_COUNT = 2;

// Volume 0D équivalent d'un demi-collecteur : conduits courts + entrée de la
// volute turbine équivalente. La valeur de 0.75 L par scroll est une calibration de
// départ, pas une mesure constructeur certifiée.
export const EXHAUST_SCROLL_VOLUME = 0.00075; // m³ par scroll

// Frontière aval et fuite de repos

const ATMOSPHERIC_PRESSURE = 101325; // Pa absolus
const ATMOSPHERIC_TEMPERATURE = 293; // K, environ 20°C

// Une très petite fuite inverse reste autorisée pour égaliser lentement la
// pression lorsque le moteur est arrêté. Elle représente la diffusion et les
// échanges faibles à travers la ligne d'échappement, pas un reflux libre par
// toute la section de sortie. Son diamètre équivalent est volontairement minime.
const TAILPIPE_REVERSE_LEAK_DIAMETER = 0.0015; // m, soit 1.5 mm équivalents
const TAILPIPE_REVERSE_LEAK_AREA = Math.PI
    * Math.pow(TAILPIPE_REVERSE_LEAK_DIAMETER, 2)
    / 4;
const TAILPIPE_REVERSE_LEAK_DISCHARGE_COEFFICIENT = 0.35;

// Modèle thermique du collecteur et de la sonde EGT

// Capacité thermique équivalente du métal associé à UN scroll : conduits en
// fonte, bride et partie de volute proche. Cette constante produit une montée en
// température sur plusieurs secondes et un refroidissement sur plusieurs dizaines
// de secondes, au lieu d'imposer une température de paroi fixe.
const EXHAUST_WALL_THERMAL_CAPACITY = 1100; // J/K par scroll

// Échange gaz → métal. Le terme de base représente la convection naturelle et
// les faibles mouvements de gaz ; le second terme augmente avec la racine du
// débit traversant le scroll, approximation robuste pour un modèle temps réel.
const EXHAUST_GAS_WALL_BASE_CONDUCTANCE = 4.0; // W/K
const EXHAUST_GAS_WALL_FLOW_CONDUCTANCE = 170; // W/K par sqrt(kg/s)

// Refroidissement du métal vers le compartiment moteur. Cette valeur regroupe
// convection et rayonnement dans un coefficient linéarisé simple.
const EXHAUST_WALL_AMBIENT_CONDUCTANCE = 6.0; // W/K

// Limites physiques et numériques de la paroi.
const MIN_WALL_TEMPERATURE = ATMOSPHERIC_TEMPERATURE; // K
const MAX_WALL_TEMPERATURE = 1350; // K, environ 1077°C
const MAX_GAS_WALL_ENERGY_FRACTION_PER_STEP = 0.08;

// Modèle de sonde EGT. À fort débit, la sonde suit assez vite le gaz. À faible
// débit, elle est surtout influencée par le métal chaud et sa réponse devient
// beaucoup plus lente. Ces constantes concernent l'affichage/monitoring : elles
// ne modifient jamais l'énergie utilisée par la turbine.
const EGT_SENSOR_HIGH_FLOW_TIME_CONSTANT = 0.35; // s
const EGT_SENSOR_LOW_FLOW_TIME_CONSTANT = 2.50;  // s
const EGT_SENSOR_FLOW_REFERENCE = 0.010;         // kg/s par scroll

// Filtre de monitoring de la puissance disponible. La dynamique d’arbre utilise
// toujours la valeur instantanée ; ce filtre sert uniquement aux courbes et aux
// nombres lisibles dans l'interface.
const TURBINE_POWER_MONITOR_TIME_CONSTANT = 0.080; // s

// Gardes numériques

const MIN_PRESSURE = 1000; // Pa
const MIN_TEMPERATURE = 180; // K
const MAX_TEMPERATURE = 2600; // K
const MIN_GAS_MASS = 1e-9; // kg
const MAX_SOURCE_MASS_FRACTION_PER_STEP = 0.25;
const MAX_CYLINDER_WALL_ENERGY_FRACTION_PER_STEP = 0.08;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function firstOrderResponse(currentValue, targetValue, dt, timeConstant) {
    const safeTimeConstant = Math.max(timeConstant, 1e-6);
    const alpha = 1 - Math.exp(-Math.max(dt, 0) / safeTimeConstant);
    return currentValue + (targetValue - currentValue) * alpha;
}

function getTemperatureFromMassAndEnergy(mass, energy) {
    const safeMass = Math.max(mass, MIN_GAS_MASS);

    return clamp(
        energy / (safeMass * CV_CYLINDER_GAS),
        MIN_TEMPERATURE,
        MAX_TEMPERATURE
    );
}

function getPressureFromMassTemperatureVolume(mass, temperature, volume) {
    return Math.max(
        mass * R_AIR * temperature / Math.max(volume, 1e-9),
        MIN_PRESSURE
    );
}

// Initialisation

function initializeExhaustScrollsIfNeeded(state) {
    for (let scroll = 0; scroll < EXHAUST_SCROLL_COUNT; scroll++) {
        const previousMass = Number.isFinite(
            state.exhaustManifoldMasses[scroll]
        ) ? state.exhaustManifoldMasses[scroll] : 0;
        const previousEnergy = Number.isFinite(
            state.exhaustManifoldInternalEnergies[scroll]
        ) ? state.exhaustManifoldInternalEnergies[scroll] : 0;
        const previousWallEnergy = Number.isFinite(
            state.exhaustManifoldWallEnergies[scroll]
        ) ? state.exhaustManifoldWallEnergies[scroll] : 0;

        const initialTemperature = Math.max(
            state.exhaustManifoldTemperatures[scroll],
            MIN_TEMPERATURE
        );
        const initialPressure = Math.max(
            state.exhaustManifoldPressures[scroll],
            MIN_PRESSURE
        );

        if (!Number.isFinite(state.exhaustManifoldMasses[scroll])
            || state.exhaustManifoldMasses[scroll] <= 0) {
            state.exhaustManifoldMasses[scroll] = initialPressure
                * EXHAUST_SCROLL_VOLUME
                / (R_AIR * initialTemperature);
        }

        if (!Number.isFinite(state.exhaustManifoldInternalEnergies[scroll])
            || state.exhaustManifoldInternalEnergies[scroll] <= 0) {
            state.exhaustManifoldInternalEnergies[scroll]
                = state.exhaustManifoldMasses[scroll]
                * CV_CYLINDER_GAS
                * initialTemperature;
        }

        // Le métal et la sonde ont leurs propres états thermiques. Ils ne sont
        // donc plus confondus avec la température instantanée du gaz.
        if (!Number.isFinite(state.exhaustManifoldWallTemperatures[scroll])) {
            state.exhaustManifoldWallTemperatures[scroll]
                = ATMOSPHERIC_TEMPERATURE;
        }

        if (!Number.isFinite(state.exhaustManifoldWallEnergies[scroll])
            || state.exhaustManifoldWallEnergies[scroll] <= 0) {
            state.exhaustManifoldWallEnergies[scroll]
                = EXHAUST_WALL_THERMAL_CAPACITY
                * clamp(
                    state.exhaustManifoldWallTemperatures[scroll],
                    MIN_WALL_TEMPERATURE,
                    MAX_WALL_TEMPERATURE
                );
        }

        if (!Number.isFinite(state.egtSensorTemperatures[scroll])) {
            state.egtSensorTemperatures[scroll] = ATMOSPHERIC_TEMPERATURE;
        }

        if (!Number.isFinite(
            state.filteredExhaustAvailableTurbinePower[scroll]
        )) {
            state.filteredExhaustAvailableTurbinePower[scroll] = 0;
        }

        if (Array.isArray(state.exhaustScrollMassCorrectionStep)) {
            state.exhaustScrollMassCorrectionStep[scroll]
                += state.exhaustManifoldMasses[scroll] - previousMass;
        }
        if (Array.isArray(state.exhaustScrollEnergyCorrectionStep)) {
            state.exhaustScrollEnergyCorrectionStep[scroll]
                += state.exhaustManifoldInternalEnergies[scroll]
                - previousEnergy;
        }
        if (Array.isArray(state.exhaustWallEnergyCorrectionStep)) {
            state.exhaustWallEnergyCorrectionStep[scroll]
                += state.exhaustManifoldWallEnergies[scroll]
                - previousWallEnergy;
        }
    }
}

function initializeCylinderIfNeeded(state, cylinderIndex) {
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
    const P = Math.max(state.cylinderPressures[cylinderIndex], MIN_PRESSURE);
    const T = Math.max(state.cylinderTemperatures[cylinderIndex], MIN_TEMPERATURE);

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

/**
 * Au cours de la combustion, la masse de carburant brûlée est suivie séparément
 * de cylinderGasMass. Au premier front d'ouverture de l'échappement, elle est
 * fusionnée dans la masse totale des produits afin que le bilan de vidange
 * conserve bien toute la masse gazeuse.
 */
function mergeBurnedFuelIntoExhaustGas(state, cylinderIndex) {
    const burnedFuelMass = Math.max(
        state.burnedFuelMassInCylinder[cylinderIndex],
        0
    );

    state.cylinderGasMass[cylinderIndex] += burnedFuelMass;
    state.burnedFuelMassInCylinder[cylinderIndex] = 0;
}

// Soupape d'échappement d'un cylindre

function updateCylinderExhaustValve(state, cylinderIndex, dt) {
    const thetaLocal = (
        state.crankAngle + CYLINDER_OFFSETS[cylinderIndex]
    ) % (4 * Math.PI);

    const valveOpen = isExhaustValveOpen(thetaLocal);
    const valveLift = getExhaustValveLift(thetaLocal);
    const valveArea = getExhaustValveFlowArea(thetaLocal);

    state.exhaustValveLift[cylinderIndex] = valveLift;
    state.exhaustValveEffectiveArea[cylinderIndex] = valveArea;

    const openingEdge = valveOpen
        && !state.wasExhaustValveOpen[cylinderIndex];

    if (openingEdge) {
        initializeCylinderIfNeeded(state, cylinderIndex);
        mergeBurnedFuelIntoExhaustGas(state, cylinderIndex);
    }

    state.wasExhaustValveOpen[cylinderIndex] = valveOpen;

    if (!valveOpen || valveArea <= 0) {
        state.exhaustValveMassFlow[cylinderIndex] = 0;
        return 0;
    }

    initializeCylinderIfNeeded(state, cylinderIndex);

    const scrollIndex = EXHAUST_SCROLL_BY_CYLINDER[cylinderIndex];
    const V = Math.max(state.cylinderVolumes[cylinderIndex], 1e-9);
    const previousV = state.prevCylinderVolumes[cylinderIndex] > 0
        ? state.prevCylinderVolumes[cylinderIndex]
        : V;
    const dV = V - previousV;

    let cylinderMass = Math.max(
        state.cylinderGasMass[cylinderIndex],
        MIN_GAS_MASS
    );
    let cylinderEnergy = Math.max(
        state.cylinderInternalEnergies[cylinderIndex],
        cylinderMass * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );
    let cylinderPressure = Math.max(
        state.cylinderPressures[cylinderIndex],
        MIN_PRESSURE
    );
    let cylinderTemperature = Math.max(
        state.cylinderTemperatures[cylinderIndex],
        MIN_TEMPERATURE
    );

    // A. Travail du piston et pertes aux parois

    // Pendant la fin de détente dV > 0 : le gaz fournit encore du travail.
    // Pendant la remontée d'échappement dV < 0 : le piston rend de l'énergie
    // au gaz afin de le chasser, ce qui constitue naturellement du pompage.
    const boundaryWork = cylinderPressure * dV;
    cylinderEnergy -= boundaryWork;
    if (Array.isArray(state.cylinderOpenBoundaryWorkStep)) {
        state.cylinderOpenBoundaryWorkStep[cylinderIndex] += boundaryWork;
    }

    const wallTransfer = calculateCylinderWallHeatTransfer(
        cylinderPressure,
        cylinderTemperature,
        V,
        state.rpm,
        1
    );

    let wallEnergy = wallTransfer.heatTransferRateToWalls * dt;
    const maximumWallEnergy = Math.max(
        cylinderEnergy * MAX_CYLINDER_WALL_ENERGY_FRACTION_PER_STEP,
        1
    );
    wallEnergy = clamp(wallEnergy, -maximumWallEnergy, maximumWallEnergy);
    cylinderEnergy -= wallEnergy;
    if (Array.isArray(state.cylinderOpenWallHeatTransferStep)) {
        state.cylinderOpenWallHeatTransferStep[cylinderIndex] += wallEnergy;
    }

    cylinderEnergy = Math.max(
        cylinderEnergy,
        cylinderMass * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );
    cylinderTemperature = getTemperatureFromMassAndEnergy(
        cylinderMass,
        cylinderEnergy
    );
    cylinderPressure = getPressureFromMassTemperatureVolume(
        cylinderMass,
        cylinderTemperature,
        V
    );

    // B. Débit cylindre ↔ scroll

    let scrollMass = Math.max(
        state.exhaustManifoldMasses[scrollIndex],
        MIN_GAS_MASS
    );
    let scrollEnergy = Math.max(
        state.exhaustManifoldInternalEnergies[scrollIndex],
        scrollMass * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );
    const scrollTemperature = getTemperatureFromMassAndEnergy(
        scrollMass,
        scrollEnergy
    );
    const scrollPressure = getPressureFromMassTemperatureVolume(
        scrollMass,
        scrollTemperature,
        EXHAUST_SCROLL_VOLUME
    );

    // Convention positive : cylindre → collecteur.
    // Une valeur négative représente une réaspiration depuis le collecteur.
    const valveDischargeCoefficient
        = getExhaustValveDischargeCoefficient(state.rpm);
    state.exhaustValveDischargeCoefficient = valveDischargeCoefficient;

    const requestedMassFlow = calculateBidirectionalCompressibleMassFlow(
        cylinderPressure,
        cylinderTemperature,
        scrollPressure,
        scrollTemperature,
        valveArea,
        valveDischargeCoefficient,
        GAMMA_CYLINDER_GAS,
        R_AIR
    );

    let actualMassFlow = requestedMassFlow;
    let signedEnthalpyOutOfCylinder = 0;

    if (requestedMassFlow > 0) {
        const requestedMass = requestedMassFlow * dt;
        const transferredMass = Math.min(
            requestedMass,
            cylinderMass * MAX_SOURCE_MASS_FRACTION_PER_STEP
        );
        const transferredEnthalpy = transferredMass
            * CP_CYLINDER_GAS
            * cylinderTemperature;

        cylinderMass -= transferredMass;
        cylinderEnergy -= transferredEnthalpy;
        scrollMass += transferredMass;
        scrollEnergy += transferredEnthalpy;
        actualMassFlow = transferredMass / dt;
        signedEnthalpyOutOfCylinder = transferredEnthalpy;
    } else if (requestedMassFlow < 0) {
        const requestedMass = -requestedMassFlow * dt;
        const transferredMass = Math.min(
            requestedMass,
            scrollMass * MAX_SOURCE_MASS_FRACTION_PER_STEP
        );
        const transferredEnthalpy = transferredMass
            * CP_CYLINDER_GAS
            * scrollTemperature;

        scrollMass -= transferredMass;
        scrollEnergy -= transferredEnthalpy;
        cylinderMass += transferredMass;
        cylinderEnergy += transferredEnthalpy;
        actualMassFlow = -transferredMass / dt;
        signedEnthalpyOutOfCylinder = -transferredEnthalpy;
    }

    const unclampedCylinderMass = cylinderMass;
    const unclampedCylinderEnergy = cylinderEnergy;
    const unclampedScrollMass = scrollMass;
    const unclampedScrollEnergy = scrollEnergy;

    cylinderMass = Math.max(cylinderMass, MIN_GAS_MASS);
    cylinderEnergy = Math.max(
        cylinderEnergy,
        cylinderMass * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );
    scrollMass = Math.max(scrollMass, MIN_GAS_MASS);
    scrollEnergy = Math.max(
        scrollEnergy,
        scrollMass * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );

    if (Array.isArray(state.cylinderMassCorrectionStep)) {
        state.cylinderMassCorrectionStep[cylinderIndex]
            += cylinderMass - unclampedCylinderMass;
    }
    if (Array.isArray(state.cylinderEnergyCorrectionStep)) {
        state.cylinderEnergyCorrectionStep[cylinderIndex]
            += cylinderEnergy - unclampedCylinderEnergy;
    }
    if (Array.isArray(state.exhaustScrollMassCorrectionStep)) {
        state.exhaustScrollMassCorrectionStep[scrollIndex]
            += scrollMass - unclampedScrollMass;
    }
    if (Array.isArray(state.exhaustScrollEnergyCorrectionStep)) {
        state.exhaustScrollEnergyCorrectionStep[scrollIndex]
            += scrollEnergy - unclampedScrollEnergy;
    }

    cylinderTemperature = getTemperatureFromMassAndEnergy(
        cylinderMass,
        cylinderEnergy
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

    state.exhaustManifoldMasses[scrollIndex] = scrollMass;
    state.exhaustManifoldInternalEnergies[scrollIndex] = scrollEnergy;
    state.exhaustValveMassFlow[cylinderIndex] = actualMassFlow;

    if (Array.isArray(state.cylinderExhaustEnthalpyTransferStep)) {
        state.cylinderExhaustEnthalpyTransferStep[cylinderIndex]
            += signedEnthalpyOutOfCylinder;
    }
    if (Array.isArray(state.exhaustScrollValveEnthalpyTransferStep)) {
        state.exhaustScrollValveEnthalpyTransferStep[scrollIndex]
            += signedEnthalpyOutOfCylinder;
    }

    // La dernière température rencontrée pendant l'échappement sert à
    // initialiser la charge résiduelle au cycle d'admission suivant.
    state.residualGasTemp[cylinderIndex] = cylinderTemperature;

    // La perte thermique d'échappement alimente le cumul global, hors bilan fermé.
    state.cumulativeCylinderWallHeatLoss += Math.max(wallEnergy, 0);

    return actualMassFlow;
}

// Sortie D'un Scroll, Paroi et Sonde EGT

/**
 * Met à jour l'échange thermique entre le gaz, le métal et l'ambiance.
 *
 * La chaleur gaz → paroi est retirée explicitement de l'énergie interne du gaz
 * puis ajoutée à la capacité thermique métallique. La conservation de l'énergie
 * est donc respectée au niveau de ce sous-modèle.
 */
function updateScrollThermalModel(
    state,
    scrollIndex,
    gasMass,
    gasEnergy,
    gasTemperature,
    throughMassFlow,
    dt
) {
    let wallEnergy = Math.max(
        state.exhaustManifoldWallEnergies[scrollIndex],
        EXHAUST_WALL_THERMAL_CAPACITY * MIN_WALL_TEMPERATURE
    );
    let wallTemperature = clamp(
        wallEnergy / EXHAUST_WALL_THERMAL_CAPACITY,
        MIN_WALL_TEMPERATURE,
        MAX_WALL_TEMPERATURE
    );

    const gasWallConductance = EXHAUST_GAS_WALL_BASE_CONDUCTANCE
        + EXHAUST_GAS_WALL_FLOW_CONDUCTANCE
        * Math.sqrt(Math.max(throughMassFlow, 0));

    // Valeur positive : chaleur allant du gaz vers le métal.
    const requestedGasToWallEnergy = gasWallConductance
        * (gasTemperature - wallTemperature)
        * dt;

    // Empêche un seul pas de retirer une fraction excessive de l'énergie du
    // minuscule volume gazeux lors d'un transitoire très violent.
    const minimumGasEnergy = gasMass
        * CV_CYLINDER_GAS
        * MIN_TEMPERATURE;
    const maximumGasCoolingEnergy = Math.max(
        gasEnergy - minimumGasEnergy,
        0
    );
    const maximumWallCoolingEnergy = Math.max(
        wallEnergy
        - EXHAUST_WALL_THERMAL_CAPACITY * MIN_WALL_TEMPERATURE,
        0
    );
    const fractionalEnergyLimit = Math.max(
        gasEnergy * MAX_GAS_WALL_ENERGY_FRACTION_PER_STEP,
        1e-6
    );

    const gasToWallEnergy = clamp(
        requestedGasToWallEnergy,
        -Math.min(maximumWallCoolingEnergy, fractionalEnergyLimit),
        Math.min(maximumGasCoolingEnergy, fractionalEnergyLimit)
    );

    gasEnergy -= gasToWallEnergy;
    wallEnergy += gasToWallEnergy;

    wallTemperature = clamp(
        wallEnergy / EXHAUST_WALL_THERMAL_CAPACITY,
        MIN_WALL_TEMPERATURE,
        MAX_WALL_TEMPERATURE
    );

    // Valeur positive : chaleur perdue par le métal vers l'ambiance.
    const wallAmbientEnergy = EXHAUST_WALL_AMBIENT_CONDUCTANCE
        * (wallTemperature - ATMOSPHERIC_TEMPERATURE)
        * dt;
    wallEnergy -= wallAmbientEnergy;
    const unclampedWallEnergy = wallEnergy;
    wallEnergy = clamp(
        wallEnergy,
        EXHAUST_WALL_THERMAL_CAPACITY * MIN_WALL_TEMPERATURE,
        EXHAUST_WALL_THERMAL_CAPACITY * MAX_WALL_TEMPERATURE
    );
    if (Array.isArray(state.exhaustWallEnergyCorrectionStep)) {
        state.exhaustWallEnergyCorrectionStep[scrollIndex]
            += wallEnergy - unclampedWallEnergy;
    }
    wallTemperature = wallEnergy / EXHAUST_WALL_THERMAL_CAPACITY;

    // La sonde voit principalement le gaz lorsque le débit est élevé. Lorsque le
    // débit devient presque nul, elle évolue lentement vers la température du
    // métal au lieu de sauter vers celle d'une petite masse d'air froid.
    const flowInfluence = clamp(
        throughMassFlow / (throughMassFlow + EGT_SENSOR_FLOW_REFERENCE),
        0,
        1
    );
    const sensorTargetTemperature = wallTemperature
        + flowInfluence * (gasTemperature - wallTemperature);
    const sensorTimeConstant = EGT_SENSOR_LOW_FLOW_TIME_CONSTANT
        + flowInfluence * (
            EGT_SENSOR_HIGH_FLOW_TIME_CONSTANT
            - EGT_SENSOR_LOW_FLOW_TIME_CONSTANT
        );
    const sensorTemperature = firstOrderResponse(
        state.egtSensorTemperatures[scrollIndex],
        sensorTargetTemperature,
        dt,
        sensorTimeConstant
    );

    state.exhaustManifoldWallEnergies[scrollIndex] = wallEnergy;
    state.exhaustManifoldWallTemperatures[scrollIndex] = wallTemperature;
    state.egtSensorTemperatures[scrollIndex] = sensorTemperature;
    state.exhaustGasToWallHeatTransferRate[scrollIndex]
        = gasToWallEnergy / dt;
    state.exhaustWallAmbientHeatLossRate[scrollIndex]
        = wallAmbientEnergy / dt;

    return {
        gasEnergy,
        wallTemperature,
        sensorTemperature,
        gasWallConductance,
        gasToWallEnergy,
        wallAmbientEnergy
    };
}

function updateScrollOutlet(state, scrollIndex, scrollInflowMassFlow, dt) {
    let mass = Math.max(
        state.exhaustManifoldMasses[scrollIndex],
        MIN_GAS_MASS
    );
    let energy = Math.max(
        state.exhaustManifoldInternalEnergies[scrollIndex],
        mass * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );
    let temperature = getTemperatureFromMassAndEnergy(mass, energy);
    let pressure = getPressureFromMassTemperatureVolume(
        mass,
        temperature,
        EXHAUST_SCROLL_VOLUME
    );

    // A. Débits à travers la turbine et la wastegate

    // Le module turbo calcule les débits demandés, le couple de turbine et la
    // température aval à partir de l'état instantané de CE scroll. La masse est
    // retirée ici, car elle appartient au bilan conservatif du collecteur.
    const boundary = calculateTurboExhaustBoundary(
        state,
        scrollIndex,
        pressure,
        temperature
    );

    const requestedTurbineMass = boundary.requestedTurbineMassFlow * dt;
    const requestedWastegateMass = boundary.requestedWastegateMassFlow * dt;
    const requestedTotalMass = requestedTurbineMass
        + requestedWastegateMass;
    const maximumOutgoingMass = mass
        * MAX_SOURCE_MASS_FRACTION_PER_STEP;
    const actualTotalMass = Math.min(
        requestedTotalMass,
        maximumOutgoingMass
    );
    const massScale = requestedTotalMass > 0
        ? actualTotalMass / requestedTotalMass
        : 0;

    const turbineMass = requestedTurbineMass * massScale;
    const wastegateMass = requestedWastegateMass * massScale;
    const turbineMassFlow = turbineMass / dt;
    const wastegateMassFlow = wastegateMass / dt;
    const totalForwardMassFlow = turbineMassFlow + wastegateMassFlow;

    // L'enthalpie du gaz quittant le scroll est retirée au niveau amont. Le
    // travail d'arbre de la turbine est produit ensuite pendant la détente dans
    // la machine ; il ne doit pas être soustrait une seconde fois du scroll.
    const outletEnthalpy = actualTotalMass
        * CP_CYLINDER_GAS
        * temperature;
    mass -= actualTotalMass;
    energy -= outletEnthalpy;

    mass = Math.max(mass, MIN_GAS_MASS);
    energy = Math.max(
        energy,
        mass * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );
    temperature = getTemperatureFromMassAndEnergy(mass, energy);
    pressure = getPressureFromMassTemperatureVolume(
        mass,
        temperature,
        EXHAUST_SCROLL_VOLUME
    );

    // B. Très faible égalisation inverse moteur arrêté

    // La turbine et la wastegate sont unidirectionnelles. Une fuite minuscule
    // reste néanmoins présente pour ramener lentement un scroll sous-atmosphérique
    // vers la pression ambiante après l'arrêt du moteur.
    const requestedReverseLeakMassFlow
        = calculateOneWayCompressibleMassFlow(
        ATMOSPHERIC_PRESSURE,
        ATMOSPHERIC_TEMPERATURE,
        pressure,
        TAILPIPE_REVERSE_LEAK_AREA,
        TAILPIPE_REVERSE_LEAK_DISCHARGE_COEFFICIENT,
        GAMMA_CYLINDER_GAS,
        R_AIR
    );
    const reverseLeakMass = requestedReverseLeakMassFlow * dt;
    const reverseLeakEnthalpy = reverseLeakMass
        * CP_CYLINDER_GAS
        * ATMOSPHERIC_TEMPERATURE;

    mass += reverseLeakMass;
    energy += reverseLeakEnthalpy;

    mass = Math.max(mass, MIN_GAS_MASS);
    energy = Math.max(
        energy,
        mass * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );
    temperature = getTemperatureFromMassAndEnergy(mass, energy);
    pressure = getPressureFromMassTemperatureVolume(
        mass,
        temperature,
        EXHAUST_SCROLL_VOLUME
    );

    // C. Métal du collecteur et sonde EGT

    const throughMassFlow = Math.max(
        Math.abs(scrollInflowMassFlow),
        totalForwardMassFlow
    );
    const thermal = updateScrollThermalModel(
        state,
        scrollIndex,
        mass,
        energy,
        temperature,
        throughMassFlow,
        dt
    );
    energy = thermal.gasEnergy;

    if (Array.isArray(state.exhaustScrollOutletMassStep)) {
        state.exhaustScrollOutletMassStep[scrollIndex] += actualTotalMass;
        state.exhaustScrollReverseLeakMassStep[scrollIndex]
            += reverseLeakMass;
        state.exhaustScrollOutletEnthalpyStep[scrollIndex]
            += outletEnthalpy;
        state.exhaustScrollReverseLeakEnthalpyStep[scrollIndex]
            += reverseLeakEnthalpy;
        state.exhaustScrollGasToWallHeatStep[scrollIndex]
            += thermal.gasToWallEnergy;
        state.exhaustWallAmbientHeatLossStep[scrollIndex]
            += thermal.wallAmbientEnergy;
    }

    energy = Math.max(
        energy,
        mass * CV_CYLINDER_GAS * MIN_TEMPERATURE
    );
    temperature = getTemperatureFromMassAndEnergy(mass, energy);
    pressure = getPressureFromMassTemperatureVolume(
        mass,
        temperature,
        EXHAUST_SCROLL_VOLUME
    );

    // D. Écriture des états et diagnostics turbo

    const actualTurbineTorque = boundary.turbineTorque * massScale;
    const actualTurbinePower = boundary.turbineShaftPower * massScale;
    const actualAvailableGasPower = boundary.availableGasPower * massScale;

    state.exhaustManifoldMasses[scrollIndex] = mass;
    state.exhaustManifoldInternalEnergies[scrollIndex] = energy;
    state.exhaustManifoldTemperatures[scrollIndex] = temperature;
    state.exhaustManifoldPressures[scrollIndex] = pressure;

    // Débit sortant total = débit turbine + débit wastegate.
    state.exhaustOutletMassFlow[scrollIndex] = totalForwardMassFlow;
    state.exhaustOutletReverseLeakMassFlow[scrollIndex]
        = requestedReverseLeakMassFlow;
    state.exhaustScrollThroughMassFlow[scrollIndex] = throughMassFlow;
    state.exhaustGasWallConductance[scrollIndex]
        = thermal.gasWallConductance;

    state.turbineMassFlow[scrollIndex] = turbineMassFlow;
    state.wastegateMassFlow[scrollIndex] = wastegateMassFlow;
    state.turbineShaftTorques[scrollIndex] = actualTurbineTorque;
    state.turbineShaftPowers[scrollIndex] = actualTurbinePower;
    state.turbineOutletTemperatures[scrollIndex]
        = boundary.turbineOutletTemperature;
    state.wastegateEffectiveArea[scrollIndex]
        = boundary.wastegateArea;

    // "available" désigne la puissance isentropique du gaz avant rendement de roue.
    state.exhaustAvailableTurbinePower[scrollIndex]
        = actualAvailableGasPower;
    state.filteredExhaustAvailableTurbinePower[scrollIndex]
        = firstOrderResponse(
        state.filteredExhaustAvailableTurbinePower[scrollIndex],
        actualAvailableGasPower,
        dt,
        TURBINE_POWER_MONITOR_TIME_CONSTANT
    );
}

// Mise à jour complète

export function updateExhaustManifold(state, dt) {
    if (dt <= 0) {
        return;
    }

    initializeExhaustScrollsIfNeeded(state);

    let totalValveMassFlow = 0;
    const scrollValveMassFlow = [0, 0];

    for (let cylinder = 0; cylinder < 4; cylinder++) {
        const cylinderMassFlow = updateCylinderExhaustValve(
            state,
            cylinder,
            dt
        );
        totalValveMassFlow += cylinderMassFlow;
        scrollValveMassFlow[EXHAUST_SCROLL_BY_CYLINDER[cylinder]]
            += cylinderMassFlow;
    }

    for (let scroll = 0; scroll < EXHAUST_SCROLL_COUNT; scroll++) {
        updateScrollOutlet(
            state,
            scroll,
            scrollValveMassFlow[scroll],
            dt
        );
    }

    const totalScrollMass = state.exhaustManifoldMasses.reduce(
        (sum, value) => sum + value,
        0
    );
    const massWeightedGasTemperature = totalScrollMass > MIN_GAS_MASS
        ? state.exhaustManifoldTemperatures.reduce(
        (sum, temperature, index) => sum
            + temperature * state.exhaustManifoldMasses[index],
        0
    ) / totalScrollMass
        : ATMOSPHERIC_TEMPERATURE;

    const averageWallTemperature
        = state.exhaustManifoldWallTemperatures.reduce(
        (sum, value) => sum + value,
        0
    ) / EXHAUST_SCROLL_COUNT;
    const averageSensorTemperature = state.egtSensorTemperatures.reduce(
        (sum, value) => sum + value,
        0
    ) / EXHAUST_SCROLL_COUNT;

    state.exhaustValveTotalMassFlow = totalValveMassFlow;
    state.exhaustMassFlow = state.exhaustOutletMassFlow.reduce(
        (sum, value) => sum + Math.max(value, 0),
        0
    );
    state.exhaustReverseMassFlow
        = state.exhaustOutletReverseLeakMassFlow.reduce(
        (sum, value) => sum + Math.max(value, 0),
        0
    );
    state.exhaustBackPressure = state.exhaustManifoldPressures.reduce(
        (sum, value) => sum + value,
        0
    ) / EXHAUST_SCROLL_COUNT;

    // Trois températures volontairement distinctes :
    // - gaz : très rapide et pulsée, utilisée par la turbine ;
    // - paroi : lente, représente l'inertie thermique du collecteur ;
    // - sonde : mesure réaliste à afficher dans l'interface.
    state.exhaustGasTemperature = massWeightedGasTemperature;
    state.exhaustWallTemperature = averageWallTemperature;
    state.egtSensorTemperature = averageSensorTemperature;

    // exhaustTemperature expose la mesure EGT ; exhaustGasTemperature conserve
    // la température gazeuse brute utilisée par la turbine.
    state.exhaustTemperature = averageSensorTemperature;
    state.egt = averageSensorTemperature - 273.15;

    // La valeur instantanée alimente la dynamique d'arbre du turbocompresseur.
    state.totalExhaustAvailableTurbinePower
        = state.exhaustAvailableTurbinePower.reduce(
        (sum, value) => sum + value,
        0
    );

    // Cette valeur filtrée est réservée au monitoring et aux courbes lisibles.
    state.filteredTotalExhaustAvailableTurbinePower
        = state.filteredExhaustAvailableTurbinePower.reduce(
        (sum, value) => sum + value,
        0
    );
}
