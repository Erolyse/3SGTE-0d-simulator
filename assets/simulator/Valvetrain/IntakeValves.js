// Géométrie et loi de levée des soupapes d'admission.
// Ce module décrit uniquement la distribution :
// - ouverture et fermeture en degrés vilebrequin ;
// - levée instantanée ;
// - aire géométrique disponible pour le passage de l'air.
// Le débit lui-même est calculé dans IntakeManifold.js à partir des pressions
// du collecteur et du cylindre.

import { STROKE } from "../Geometry/Geometry.js";

// Calage de distribution

// Repère local du cylindre :
//   0°   = PMH entre échappement et admission
//   180° = PMB de fin d'admission
//   360° = PMH d'allumage
//   540° = PMB de fin de détente
//   720° = fin d'échappement

// L'ouverture commence au PMH et le croisement de soupapes est nul dans ce
// modèle de distribution simplifié.
export const INTAKE_VALVE_OPEN_DEG = 0; // ° vilebrequin local

// La fermeture est retardée après le PMB afin de conserver l'effet d'inertie
// des gaz à haut régime et de permettre un reflux naturel à faible régime.
export const INTAKE_VALVE_CLOSE_DEG = 245; // 65° après PMB

// Géométrie des soupapes

// Valeurs géométriques de travail, centralisées pour la calibration.

const INTAKE_VALVE_COUNT = 2;          // Deux soupapes d'admission par cylindre
const INTAKE_VALVE_DIAMETER = 0.033;   // m — diamètre de tête de travail : 33 mm
const INTAKE_PORT_DIAMETER = 0.029;    // m — diamètre équivalent du col : 29 mm
const INTAKE_VALVE_MAX_LIFT = 0.0085;  // m — levée maximale de travail : 8.5 mm

// Le sommet de came reste fixé : retarder la fermeture allonge uniquement la
// rampe descendante. Cela évite de déplacer artificiellement toute la levée.
const INTAKE_VALVE_MAX_LIFT_DEG = 110; // ° vilebrequin local

// Coefficient regroupant contraction du jet, pertes au siège et turbulence.
// Il est appliqué dans l'équation de débit compressible, pas dans l'aire.
const INTAKE_VALVE_LOW_REYNOLDS_DISCHARGE_COEFFICIENT = 0.68;
const INTAKE_VALVE_HIGH_REYNOLDS_DISCHARGE_COEFFICIENT = 0.71;
const INTAKE_REYNOLDS_TRANSITION_START_MEAN_PISTON_SPEED = 12.0; // m/s
const INTAKE_REYNOLDS_TRANSITION_FULL_MEAN_PISTON_SPEED = 17.0; // m/s

// À faible levée, le jet est fortement contracté par le siège et le coefficient
// de décharge est inférieur à sa valeur de pleine levée. La loi dépend de L/D,
// donc de la géométrie réelle instantanée, et non directement du régime moteur.
const INTAKE_LOW_LIFT_DISCHARGE_FACTOR = 0.66;
const INTAKE_LIFT_RATIO_DEVELOPMENT_START = 0.015;
const INTAKE_LIFT_RATIO_FULLY_DEVELOPED = 0.18;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function smoothStep01(value) {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
}

/**
 * Coefficient de décharge corrigé par un proxy de nombre de Reynolds.
 * La vitesse moyenne du piston augmente le débit et la turbulence dans les ports ;
 * le coefficient se rapproche alors progressivement de sa valeur de régime
 * pleinement turbulent. Aucun régime moteur cible n'est imposé à la puissance.
 */
export function getIntakeValveDischargeCoefficient(rpm, thetaLocal) {
    const meanPistonSpeed = 2 * STROKE * Math.max(rpm, 0) / 60;
    const reynoldsTransition = smoothStep01(
        (meanPistonSpeed
            - INTAKE_REYNOLDS_TRANSITION_START_MEAN_PISTON_SPEED)
        / Math.max(
            INTAKE_REYNOLDS_TRANSITION_FULL_MEAN_PISTON_SPEED
            - INTAKE_REYNOLDS_TRANSITION_START_MEAN_PISTON_SPEED,
            1e-6
        )
    );

    const fullyDevelopedCoefficient
        = INTAKE_VALVE_LOW_REYNOLDS_DISCHARGE_COEFFICIENT
        + (INTAKE_VALVE_HIGH_REYNOLDS_DISCHARGE_COEFFICIENT
            - INTAKE_VALVE_LOW_REYNOLDS_DISCHARGE_COEFFICIENT)
        * reynoldsTransition;

    const lift = Number.isFinite(thetaLocal)
        ? getIntakeValveLift(thetaLocal)
        : INTAKE_VALVE_MAX_LIFT;
    const liftRatio = lift / Math.max(INTAKE_VALVE_DIAMETER, 1e-9);
    const liftDevelopment = smoothStep01(
        (liftRatio - INTAKE_LIFT_RATIO_DEVELOPMENT_START)
        / Math.max(
            INTAKE_LIFT_RATIO_FULLY_DEVELOPED
            - INTAKE_LIFT_RATIO_DEVELOPMENT_START,
            1e-6
        )
    );
    const liftFactor = INTAKE_LOW_LIFT_DISCHARGE_FACTOR
        + (1 - INTAKE_LOW_LIFT_DISCHARGE_FACTOR) * liftDevelopment;

    return fullyDevelopedCoefficient * liftFactor;
}
// Outils angulaires

function radiansToDegrees(angleRad) {
    return angleRad * 180 / Math.PI;
}

/**
 * Indique si les soupapes d'admission sont ouvertes à cet angle local.
 *
 * @param {number} thetaLocal Angle cylindre local en radians sur 0 à 4*PI
 * @returns {boolean}
 */
export function isIntakeValveOpen(thetaLocal) {
    const angleDeg = radiansToDegrees(thetaLocal);

    return angleDeg >= INTAKE_VALVE_OPEN_DEG
        && angleDeg <= INTAKE_VALVE_CLOSE_DEG;
}

// Loi de levée

/**
 * Calcule la levée instantanée des soupapes d'admission.
 *
 * Une loi sin² est utilisée : elle donne une levée nulle et une pente nulle
 * aux deux extrémités, puis une montée/descente continue autour du maximum.
 * Ce n'est pas un profil de came détaillé, mais c'est une loi cinématique
 * continue et suffisamment stable pour un modèle temps réel 0D.
 *
 * @param {number} thetaLocal Angle cylindre local en radians
 * @returns {number} Levée en mètres
 */
export function getIntakeValveLift(thetaLocal) {
    if (!isIntakeValveOpen(thetaLocal)) {
        return 0;
    }

    const angleDeg = radiansToDegrees(thetaLocal);

    // Profil asymétrique continu : montée jusqu'au sommet de came, puis descente
    // plus longue jusqu'à l'IVC retardée. La levée et sa pente sont nulles aux
    // extrémités, et la pente est également nulle au sommet.
    if (angleDeg <= INTAKE_VALVE_MAX_LIFT_DEG) {
        const risingPosition = (
            angleDeg - INTAKE_VALVE_OPEN_DEG
        ) / Math.max(
            INTAKE_VALVE_MAX_LIFT_DEG - INTAKE_VALVE_OPEN_DEG,
            1e-6
        );

        return INTAKE_VALVE_MAX_LIFT
            * Math.pow(Math.sin(0.5 * Math.PI * risingPosition), 2);
    }

    const fallingPosition = (
        angleDeg - INTAKE_VALVE_MAX_LIFT_DEG
    ) / Math.max(
        INTAKE_VALVE_CLOSE_DEG - INTAKE_VALVE_MAX_LIFT_DEG,
        1e-6
    );

    return INTAKE_VALVE_MAX_LIFT
        * Math.pow(Math.cos(0.5 * Math.PI * fallingPosition), 2);
}

// Aire de passage

/**
 * Calcule l'aire géométrique totale disponible pour un cylindre.
 *
 * Deux limitations sont prises en compte :
 *
 * 1. Aire de rideau des soupapes :
 *      A_rideau = nombre * PI * diamètre_soupape * levée
 *
 * 2. Aire maximale du col des conduits :
 *      A_col = nombre * PI * diamètre_col² / 4
 *
 * L'aire retenue est la plus petite des deux. Cela empêche l'aire calculée
 * d'augmenter indéfiniment lorsque la levée devient importante.
 *
 * @param {number} thetaLocal Angle cylindre local en radians
 * @returns {number} Aire géométrique totale en m²
 */
export function getIntakeValveFlowArea(thetaLocal) {
    const lift = getIntakeValveLift(thetaLocal);

    if (lift <= 0) {
        return 0;
    }

    const curtainArea = INTAKE_VALVE_COUNT
        * Math.PI
        * INTAKE_VALVE_DIAMETER
        * lift;

    const portThroatArea = INTAKE_VALVE_COUNT
        * Math.PI
        * Math.pow(INTAKE_PORT_DIAMETER, 2)
        / 4;

    return Math.min(curtainArea, portThroatArea);
}
