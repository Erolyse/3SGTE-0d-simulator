// Pertes thermiques 0D entre les gaz du cylindre et les parois.
// Ce module ne résout pas la conduction dans la culasse, le piston ou le bloc.
// Il calcule un coefficient convectif moyen et une surface d'échange instantanée,
// puis retourne la puissance thermique allant du gaz vers les parois.
// Convention de signe :
//   Qdot_wall > 0  => le gaz perd de l'énergie vers les parois ;
//   Qdot_wall < 0  => les parois réchauffent le gaz.

import {
    BORE,
    STROKE,
    PISTON_AREA,
    CLEARANCE_VOLUME
} from "../Geometry/Geometry.js";

// Températures de paroi équivalentes

// Ces températures sont des valeurs 0D de travail, pas des températures locales
// détaillées. Une vraie chambre possède de forts gradients spatiaux et temporels.
// Elles représentent un moteur déjà chaud :
// - la culasse est refroidie par le liquide ;
// - le piston est généralement plus chaud que la culasse ;
// - la chemise reste proche du circuit de refroidissement.
const CYLINDER_HEAD_WALL_TEMPERATURE = 430; // K, environ 157 °C
const PISTON_CROWN_WALL_TEMPERATURE = 500;  // K, environ 227 °C
const CYLINDER_LINER_WALL_TEMPERATURE = 390;// K, environ 117 °C

// Les surfaces réelles ne sont pas parfaitement planes : chambre pent-roof,
// cuvette du piston, sièges de soupapes, bougie, etc. Ces facteurs corrigent
// légèrement la surface projetée sans introduire une géométrie 3D complète.
const CYLINDER_HEAD_AREA_FACTOR = 1.08;
const PISTON_CROWN_AREA_FACTOR = 1.03;

// Corrélation convective simplifiée

// Forme inspirée des corrélations moteur de type Woschni :
// h = C * B^-0.2 * P^0.8 * T^-0.55 * w^0.8
// Les rapports sont normalisés afin de conserver des unités explicites et une
// constante C directement lisible en W/(m².K). Ce n'est pas une reproduction
// exacte de Woschni ; il s'agit d'une corrélation 0D stable et calibrable.
const BASE_HEAT_TRANSFER_COEFFICIENT = 130; // W/(m².K)
const REFERENCE_BORE = 0.086;               // m
const REFERENCE_PRESSURE = 100000;          // Pa
const REFERENCE_TEMPERATURE = 300;          // K
const REFERENCE_GAS_VELOCITY = 10;          // m/s

// La vitesse caractéristique des gaz dépend d'abord de la vitesse moyenne piston :
//   Up = 2 * course * RPM / 60
// Le terme minimal évite que les échanges deviennent artificiellement nuls à
// très bas régime. Le terme de combustion augmente temporairement la turbulence
// pendant la propagation de la flamme.
const MINIMUM_GAS_VELOCITY = 0.50;          // m/s
const PISTON_SPEED_VELOCITY_FACTOR = 0.65;
const COMBUSTION_TURBULENCE_FACTOR = 1.25;

// Bornes numériques et physiques de calibration. Elles évitent une divergence
// en cas de pression ou de température anormale pendant une phase de réglage.
const MIN_HEAT_TRANSFER_COEFFICIENT = 10;   // W/(m².K)
const MAX_HEAT_TRANSFER_COEFFICIENT = 5000; // W/(m².K)
const MIN_PRESSURE = 1000;                  // Pa
const MIN_TEMPERATURE = 150;                // K

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

// Surface instantanée de la chambre

/**
 * Calcule les surfaces mouillées actuellement exposées aux gaz.
 *
 * Le volume instantané permet de retrouver la descente du piston :
 *
 *   x = (V - Vc) / A_piston
 *
 * La surface de chemise exposée vaut ensuite PI * alésage * x.
 */
function getCylinderWallAreas(cylinderVolume) {
    const pistonDisplacement = Math.max(
        (cylinderVolume - CLEARANCE_VOLUME) / PISTON_AREA,
        0
    );

    const headArea = PISTON_AREA * CYLINDER_HEAD_AREA_FACTOR;
    const pistonArea = PISTON_AREA * PISTON_CROWN_AREA_FACTOR;
    const linerArea = Math.PI * BORE * pistonDisplacement;

    return {
        headArea,
        pistonArea,
        linerArea,
        totalArea: headArea + pistonArea + linerArea
    };
}

// Vitesse caractéristique des gaz

function getCharacteristicGasVelocity(rpm, burnedFraction) {
    const clampedRPM = Math.max(rpm, 0);
    const meanPistonSpeed = 2 * STROKE * clampedRPM / 60;

    // Fonction continue nulle à xb=0 et xb=1, maximale à xb=0.5.
    // Elle augmente la turbulence uniquement pendant le cœur de la combustion.
    const xb = clamp(burnedFraction, 0, 1);
    const combustionActivity = 4 * xb * (1 - xb);

    return MINIMUM_GAS_VELOCITY
        + PISTON_SPEED_VELOCITY_FACTOR * meanPistonSpeed
        + COMBUSTION_TURBULENCE_FACTOR
        * meanPistonSpeed
        * combustionActivity;
}

// Calcul du transfert thermique

/**
 * Calcule la puissance thermique instantanée du gaz vers les parois.
 *
 * @param {number} pressure Pression cylindre absolue en Pa
 * @param {number} gasTemperature Température moyenne des gaz en K
 * @param {number} cylinderVolume Volume instantané en m³
 * @param {number} rpm Régime moteur en tr/min
 * @param {number} burnedFraction Fraction de carburant brûlée, de 0 à 1
 * @returns {{
 *   heatTransferRateToWalls: number,
 *   heatTransferCoefficient: number,
 *   totalWallArea: number,
 *   effectiveWallTemperature: number,
 *   characteristicGasVelocity: number
 * }}
 */
export function calculateCylinderWallHeatTransfer(
    pressure,
    gasTemperature,
    cylinderVolume,
    rpm,
    burnedFraction
) {
    const P = Math.max(pressure, MIN_PRESSURE);
    const T = Math.max(gasTemperature, MIN_TEMPERATURE);
    const areas = getCylinderWallAreas(cylinderVolume);

    const gasVelocity = getCharacteristicGasVelocity(
        rpm,
        burnedFraction
    );

    const rawHeatTransferCoefficient
        = BASE_HEAT_TRANSFER_COEFFICIENT
        * Math.pow(BORE / REFERENCE_BORE, -0.20)
        * Math.pow(P / REFERENCE_PRESSURE, 0.80)
        * Math.pow(T / REFERENCE_TEMPERATURE, -0.55)
        * Math.pow(
            gasVelocity / REFERENCE_GAS_VELOCITY,
            0.80
        );

    const heatTransferCoefficient = clamp(
        rawHeatTransferCoefficient,
        MIN_HEAT_TRANSFER_COEFFICIENT,
        MAX_HEAT_TRANSFER_COEFFICIENT
    );

    // Chaque paroi possède sa propre température équivalente. Cette écriture
    // évite de masquer le fait que piston, culasse et chemise ne sont pas à la
    // même température, tout en gardant un seul coefficient convectif moyen.
    const weightedTemperatureDifference
        = areas.headArea
        * (T - CYLINDER_HEAD_WALL_TEMPERATURE)
        + areas.pistonArea
        * (T - PISTON_CROWN_WALL_TEMPERATURE)
        + areas.linerArea
        * (T - CYLINDER_LINER_WALL_TEMPERATURE);

    const heatTransferRateToWalls
        = heatTransferCoefficient * weightedTemperatureDifference;

    const effectiveWallTemperature = (
        areas.headArea * CYLINDER_HEAD_WALL_TEMPERATURE
        + areas.pistonArea * PISTON_CROWN_WALL_TEMPERATURE
        + areas.linerArea * CYLINDER_LINER_WALL_TEMPERATURE
    ) / Math.max(areas.totalArea, 1e-12);

    return {
        heatTransferRateToWalls,
        heatTransferCoefficient,
        totalWallArea: areas.totalArea,
        effectiveWallTemperature,
        characteristicGasVelocity: gasVelocity
    };
}
