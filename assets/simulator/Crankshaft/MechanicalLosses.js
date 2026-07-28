// Pertes mécaniques 0D et coupure carburant en décélération.
// Le pompage provient des pressions cylindre ; ce module ne calcule que les
// frottements, les accessoires et la logique de coupure d'injection.

import {
    STROKE,
    SWEPT_VOLUME,
    CYLINDER_OFFSETS
} from "../Geometry/Geometry.js";

// Géométrie globale du moteur

const CYLINDER_COUNT = CYLINDER_OFFSETS.length;
const TOTAL_DISPLACEMENT = SWEPT_VOLUME * CYLINDER_COUNT; // m³, environ 2.0 litres

// Un cycle moteur quatre temps représente 720°, soit 4*PI radians.
// Pour une pression moyenne effective Pme :
//     Travail_cycle = Pme * cylindrée_totale
//     Couple_moyen  = Travail_cycle / (4*PI)
const FOUR_STROKE_CYCLE_ANGLE = 4 * Math.PI;

// Pression de référence utilisée pour retirer la partie atmosphérique du pic
// de pression cylindre dans le terme de frottement dépendant de la charge.
const ATMOSPHERIC_PRESSURE = 101325; // Pa

// Corrélation de FMEP

// FMEP = Friction Mean Effective Pressure, ou pression moyenne effective de
// frottement. Cette écriture permet de garder un modèle indépendant de la
// cylindrée et de convertir ensuite proprement la perte en couple.
// Le modèle est volontairement continu et sans cartographie :
//   FMEP = FMEP_base
//        + C1 * vitesse_moyenne_piston
//        + C2 * vitesse_moyenne_piston²
//        + Ccharge * pression_pic_moyenne
// Les valeurs ci-dessous sont des constantes de calibration. Elles
// ne prétendent pas être des mesures Toyota. Elles donnent cependant des pertes
// cohérentes avec un quatre-cylindres deux litres essence en température.

// Frottements secs et limites de lubrification : segments, jupes, paliers,
// distribution. Cette partie subsiste même à faible régime.
const BASE_FMEP = 45000; // Pa, soit 0.45 bar

// Terme approximativement proportionnel à la vitesse de glissement moyenne.
const LINEAR_FMEP_PER_PISTON_SPEED = 2800; // Pa par (m/s)

// Terme quadratique : barbotage d'huile, ventilation du carter, pertes de
// distribution et croissance rapide des pertes à haut régime.
const QUADRATIC_FMEP_PER_PISTON_SPEED_SQUARED = 190; // Pa par (m/s)²

// Une pression de combustion plus élevée augmente les efforts sur les segments,
// la jupe et les paliers. Le coefficient multiplie la pression pic MANOMÉTRIQUE
// moyenne du dernier cycle complet.
const PEAK_PRESSURE_FRICTION_FACTOR = 0.0035; // sans dimension

// Bornes purement numériques. Elles empêchent une mauvaise initialisation de
// pression ou un RPM extrême de produire un couple de frottement aberrant.
const MINIMUM_FMEP = 15000;  // Pa, 0.15 bar
const MAXIMUM_FMEP = 350000; // Pa, 3.50 bar

// Accessoires mécaniques

// Les pompes à huile/eau, l'alternateur et la distribution prélèvent une petite
// part de couple qui n'est pas directement représentée par la pression cylindre.
// Modèle = terme constant + terme croissant avec la vitesse.
const ACCESSORY_CONSTANT_TORQUE = 1.5; // N.m
const ACCESSORY_VISCOUS_COEFFICIENT = 0.0030; // N.m par (rad/s)

// Coupure carburant en décélération

// Un moteur essence moderne coupe généralement l'injection lors d'un lever de
// pied suffisamment haut dans les tours. Sans cela, la faible masse admise reste
// brûlée et masque fortement le frein moteur physique.
// L'hystérésis évite que l'état commute à chaque pas autour d'un seuil.
const FUEL_CUT_THROTTLE_ON = 0.020;  // active sous 2.0 % de commande
const FUEL_CUT_THROTTLE_OFF = 0.040; // réactive au-dessus de 4.0 %
const FUEL_CUT_RPM_ON = 1700;        // activation au-dessus de 1700 tr/min
const FUEL_CUT_RPM_OFF = 1200;       // réactivation sous 1200 tr/min

// Outils

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function pressureToFourStrokeTorque(meanEffectivePressure) {
    return meanEffectivePressure
        * TOTAL_DISPLACEMENT
        / FOUR_STROKE_CYCLE_ANGLE;
}

/**
 * Vitesse moyenne du piston :
 *
 *     Up = 2 * course * RPM / 60
 *
 * Le piston parcourt deux courses par tour de vilebrequin.
 */
function getMeanPistonSpeed(rpm) {
    return 2 * STROKE * Math.max(rpm, 0) / 60;
}

// Suivi de la pression pic par cycle

/**
 * Stocke pour chaque cylindre la pression maximale du cycle précédent.
 *
 * Le terme de charge du frottement doit varier lentement avec la combustion ;
 * utiliser directement la pression instantanée créerait un couple de frottement
 * pulsé et physiquement injustifié. Le modèle retient donc le pic du dernier
 * cycle complet puis moyenne les quatre cylindres.
 */
function updateCyclePeakPressures(state) {
    for (let i = 0; i < CYLINDER_COUNT; i++) {
        const localAngle = (
            state.crankAngle + CYLINDER_OFFSETS[i]
        ) % FOUR_STROKE_CYCLE_ANGLE;

        const previousAngle = state.lossModelPreviousCylinderAngles[i];
        const currentPressure = Math.max(
            state.cylinderPressures[i],
            ATMOSPHERIC_PRESSURE
        );

        // Le modulo 720° fait repasser l'angle local d'une valeur proche de
        // 4*PI à une valeur proche de zéro : un cycle complet vient de finir.
        if (localAngle < previousAngle) {
            state.lastCyclePeakCylinderPressure[i] = Math.max(
                state.currentCyclePeakCylinderPressure[i],
                ATMOSPHERIC_PRESSURE
            );

            state.currentCyclePeakCylinderPressure[i] = currentPressure;
        } else {
            state.currentCyclePeakCylinderPressure[i] = Math.max(
                state.currentCyclePeakCylinderPressure[i],
                currentPressure
            );
        }

        state.lossModelPreviousCylinderAngles[i] = localAngle;
    }
}

function getAverageCyclePeakGaugePressure(state) {
    let pressureSum = 0;

    for (let i = 0; i < CYLINDER_COUNT; i++) {
        const storedPeak = Math.max(
            state.lastCyclePeakCylinderPressure[i],
            state.currentCyclePeakCylinderPressure[i],
            ATMOSPHERIC_PRESSURE
        );

        pressureSum += Math.max(
            storedPeak - ATMOSPHERIC_PRESSURE,
            0
        );
    }

    return pressureSum / CYLINDER_COUNT;
}

// Commande de coupure en lever de pied

/**
 * Met à jour la coupure d'injection en décélération.
 *
 * Cette fonction ne crée aucun couple de frein moteur. Elle décide uniquement
 * si les prochains cycles doivent recevoir du carburant. Lorsque l'injection
 * est coupée, le couple négatif vient naturellement du pompage et des pertes
 * mécaniques calculées ailleurs.
 */
export function updateOverrunFuelCut(state) {
    const throttle = clamp(state.throttle, 0, 1);

    if (state.fuelCutActive) {
        const driverRequestsTorque = throttle >= FUEL_CUT_THROTTLE_OFF;
        const rpmIsLow = state.rpm <= FUEL_CUT_RPM_OFF;

        if (driverRequestsTorque || rpmIsLow) {
            state.fuelCutActive = false;
        }
    } else {
        const throttleIsClosed = throttle <= FUEL_CUT_THROTTLE_ON;
        const rpmIsHigh = state.rpm >= FUEL_CUT_RPM_ON;

        if (throttleIsClosed && rpmIsHigh) {
            state.fuelCutActive = true;
        }
    }

    state.engineBrakingActive = state.fuelCutActive;
}

// Calcul des pertes mécaniques

/**
 * Calcule les pertes mécaniques moyennes appliquées au vilebrequin.
 *
 * @returns {object} Décomposition complète des pertes pour la dynamique et les graphiques
 */
export function calculateMechanicalLosses(state) {
    updateCyclePeakPressures(state);

    const omega = Math.max(
        state.rpm * 2 * Math.PI / 60,
        0
    );
    const meanPistonSpeed = getMeanPistonSpeed(state.rpm);
    const averagePeakGaugePressure
        = getAverageCyclePeakGaugePressure(state);

    const baseFMEP = BASE_FMEP;
    const linearSpeedFMEP = LINEAR_FMEP_PER_PISTON_SPEED
        * meanPistonSpeed;
    const quadraticSpeedFMEP
        = QUADRATIC_FMEP_PER_PISTON_SPEED_SQUARED
        * meanPistonSpeed
        * meanPistonSpeed;
    const loadFMEP = PEAK_PRESSURE_FRICTION_FACTOR
        * averagePeakGaugePressure;

    const unclampedFMEP = baseFMEP
        + linearSpeedFMEP
        + quadraticSpeedFMEP
        + loadFMEP;

    const totalFMEP = clamp(
        unclampedFMEP,
        MINIMUM_FMEP,
        MAXIMUM_FMEP
    );

    // Si une borne numérique limite la FMEP totale, toutes les composantes sont
    // réduites dans la même proportion afin que leur somme reste exactement
    // égale au couple de frottement réellement appliqué.
    const componentScale = unclampedFMEP > 0
        ? totalFMEP / unclampedFMEP
        : 0;

    // Chaque contribution est convertie en couple moyen sur 720°.
    const baseFrictionTorque = pressureToFourStrokeTorque(
        baseFMEP * componentScale
    );
    const speedFrictionTorque = pressureToFourStrokeTorque(
        (linearSpeedFMEP + quadraticSpeedFMEP) * componentScale
    );
    const loadFrictionTorque = pressureToFourStrokeTorque(
        loadFMEP * componentScale
    );
    const frictionTorque = pressureToFourStrokeTorque(totalFMEP);

    const accessoryTorque = ACCESSORY_CONSTANT_TORQUE
        + ACCESSORY_VISCOUS_COEFFICIENT * omega;

    const totalMechanicalLossTorque = frictionTorque + accessoryTorque;

    return {
        meanPistonSpeed,
        averagePeakGaugePressure,
        baseFMEP,
        linearSpeedFMEP,
        quadraticSpeedFMEP,
        loadFMEP,
        totalFMEP,
        baseFrictionTorque,
        speedFrictionTorque,
        loadFrictionTorque,
        frictionTorque,
        accessoryTorque,
        totalMechanicalLossTorque
    };
}
