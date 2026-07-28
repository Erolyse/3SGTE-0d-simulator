// Intégrateur adaptatif piloté par angle vilebrequin.
// Les événements de soupapes, la combustion et P·dV sont résolus en angle,
// avec une limite temporelle pour les phénomènes lents et le démarrage.

import { CYLINDER_OFFSETS } from "../Geometry/Geometry.js";
import {
    INTAKE_VALVE_OPEN_DEG,
    INTAKE_VALVE_CLOSE_DEG
} from "../Valvetrain/IntakeValves.js";
import {
    EXHAUST_VALVE_OPEN_DEG,
    EXHAUST_VALVE_CLOSE_DEG
} from "../Valvetrain/ExhaustValves.js";
import {
    getCombustionDurationDegForRpm
} from "../Thermodynamics/Thermodynamics.js";

// Résolution angulaire

// Pas général du cycle. Il s'applique à la compression, à la détente et aux
// échanges gazeux loin des discontinuités de distribution.
// À 6000 tr/min, 0.5° correspond à environ 13.9 microsecondes.
export const BASE_CRANK_ANGLE_STEP_DEG = 0.50;

// La combustion est la partie la plus raide du cycle. Un pas de 0.35° donne
// environ 9.7 microsecondes à 6000 tr/min, soit pratiquement la résolution de
// référence dt = 0.00001 s évoquée pendant les essais de convergence.
export const COMBUSTION_CRANK_ANGLE_STEP_DEG = 0.35;

// Autour d'un front d'ouverture/fermeture, le solveur raffine localement le pas
// afin que la levée et le débit partent de zéro de manière progressive.
export const EVENT_CRANK_ANGLE_STEP_DEG = 0.20;

// Largeur de la zone raffinée de part et d'autre d'un événement angulaire.
const EVENT_REFINEMENT_HALF_WIDTH_DEG = 1.0;

// Durée maximale d'un sous-pas pour le démarreur, le turbo et les régulateurs.
export const MAX_INTERNAL_TIME_STEP = 0.0001; // s

// Durée minimale uniquement destinée à éviter une boucle bloquée par les
// erreurs d'arrondi lorsque le solveur atterrit exactement sur un événement.
const MIN_INTERNAL_TIME_STEP = 1e-9; // s

// La durée de combustion n'est volontairement PAS dupliquée ici.
// Le solveur utilise exactement la même loi dépendante du régime que
// Thermodynamics.js afin que l'événement de fin de combustion soit identique
// à celui utilisé par la loi de Wiebe.

const FULL_ENGINE_CYCLE_DEG = 720;
const TWO_PI = 2 * Math.PI;
const FOUR_PI = 4 * Math.PI;
const EVENT_DISTANCE_EPSILON_DEG = 1e-7;

// Facteur de résolution optionnel défini par Engine.setAngleResolution().
// 1 correspond au solveur nominal : 0,50° / 0,35° / 0,20°.
// Le protocole de convergence utilise notamment 2,0 ; 1,0 ; 0,5 pour
// comparer des pas généraux de 1,00° ; 0,50° ; 0,25°.
const MINIMUM_RESOLUTION_SCALE = 0.25;
const MAXIMUM_RESOLUTION_SCALE = 4.0;

function getResolutionScale(state) {
    const value = Number.isFinite(state?.angleSolverResolutionScale)
        ? state.angleSolverResolutionScale
        : 1;

    return clamp(
        value,
        MINIMUM_RESOLUTION_SCALE,
        MAXIMUM_RESOLUTION_SCALE
    );
}

// Outils angulaires

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function normalizeDegrees720(angleDeg) {
    return (
        (angleDeg % FULL_ENGINE_CYCLE_DEG)
        + FULL_ENGINE_CYCLE_DEG
    ) % FULL_ENGINE_CYCLE_DEG;
}

function radiansToDegrees(angleRad) {
    return angleRad * 180 / Math.PI;
}

function degreesToRadians(angleDeg) {
    return angleDeg * Math.PI / 180;
}

/**
 * Distance positive en degrés jusqu'au prochain passage sur un événement.
 * Le résultat appartient à l'intervalle [0, 720[.
 */
function getForwardAngularDistanceDeg(currentDeg, eventDeg) {
    return normalizeDegrees720(eventDeg - currentDeg);
}

/**
 * Plus petite distance absolue sur un cycle de 720°.
 */
function getCircularDistanceDeg(angleA, angleB) {
    const forward = getForwardAngularDistanceDeg(angleA, angleB);
    return Math.min(forward, FULL_ENGINE_CYCLE_DEG - forward);
}

function getIgnitionEventsDeg(state) {
    const ignitionTimingDeg = clamp(
        Number.isFinite(state.ignitionTimingDeg)
            ? state.ignitionTimingDeg
            : 15,
        -10,
        45
    );

    const combustionDurationDeg = getCombustionDurationDegForRpm(
        Number.isFinite(state.rpm) ? state.rpm : 0
    );
    const ignitionStartDeg = 360 - ignitionTimingDeg;
    const ignitionEndDeg = ignitionStartDeg + combustionDurationDeg;

    return {
        ignitionStartDeg,
        ignitionEndDeg,
        combustionDurationDeg
    };
}

function getCylinderLocalAngleDeg(state, cylinderIndex) {
    const localAngleRad = (
        state.crankAngle + CYLINDER_OFFSETS[cylinderIndex]
    ) % FOUR_PI;

    return normalizeDegrees720(radiansToDegrees(localAngleRad));
}

function isInsideCombustionWindow(
    localAngleDeg,
    ignitionStartDeg,
    ignitionEndDeg
) {
    return localAngleDeg >= ignitionStartDeg
        && localAngleDeg <= ignitionEndDeg;
}

function getImportantEventsDeg(state) {
    const ignitionEvents = getIgnitionEventsDeg(state);

    // 720° et 0° représentent le même point. La fermeture échappement et
    // l'ouverture admission sont donc regroupées dans l'événement 0°.
    return [
        0,
        INTAKE_VALVE_OPEN_DEG,
        INTAKE_VALVE_CLOSE_DEG,
        ignitionEvents.ignitionStartDeg,
        ignitionEvents.ignitionEndDeg,
        EXHAUST_VALVE_OPEN_DEG,
        normalizeDegrees720(EXHAUST_VALVE_CLOSE_DEG)
    ];
}

// Choix de la résolution locale

/**
 * Retourne le pas angulaire cible pour l'état courant.
 *
 * La résolution est déterminée par le cylindre qui exige le pas le plus fin.
 * Avec quatre cylindres déphasés, une combustion ou un front de soupape d'un
 * seul cylindre suffit donc à raffiner le solveur global.
 */
export function getTargetCrankAngleStepDeg(state) {
    const {
        ignitionStartDeg,
        ignitionEndDeg
    } = getIgnitionEventsDeg(state);
    const importantEvents = getImportantEventsDeg(state);

    const resolutionScale = getResolutionScale(state);
    let requestedStepDeg = BASE_CRANK_ANGLE_STEP_DEG
        * resolutionScale;

    for (let cylinderIndex = 0; cylinderIndex < 4; cylinderIndex++) {
        const localAngleDeg = getCylinderLocalAngleDeg(
            state,
            cylinderIndex
        );

        if (isInsideCombustionWindow(
            localAngleDeg,
            ignitionStartDeg,
            ignitionEndDeg
        )) {
            requestedStepDeg = Math.min(
                requestedStepDeg,
                COMBUSTION_CRANK_ANGLE_STEP_DEG
                * resolutionScale
            );
        }

        for (const eventDeg of importantEvents) {
            if (getCircularDistanceDeg(localAngleDeg, eventDeg)
                <= EVENT_REFINEMENT_HALF_WIDTH_DEG) {
                requestedStepDeg = Math.min(
                    requestedStepDeg,
                    EVENT_CRANK_ANGLE_STEP_DEG
                    * resolutionScale
                );
            }
        }
    }

    return requestedStepDeg;
}

/**
 * Recherche la distance jusqu'au prochain événement que le pas proposé
 * traverserait. Le solveur peut ainsi atterrir exactement sur :
 * - IVO / IVC ;
 * - début / fin de combustion ;
 * - EVO / EVC.
 */
function getDistanceToNextEventDeg(state, proposedStepDeg) {
    const importantEvents = getImportantEventsDeg(state);
    let nearestDistanceDeg = proposedStepDeg;

    for (let cylinderIndex = 0; cylinderIndex < 4; cylinderIndex++) {
        const localAngleDeg = getCylinderLocalAngleDeg(
            state,
            cylinderIndex
        );

        for (const eventDeg of importantEvents) {
            const distanceDeg = getForwardAngularDistanceDeg(
                localAngleDeg,
                eventDeg
            );

            // Une distance pratiquement nulle indique un événement déjà atteint ;
            // elle est ignorée pour éviter un sous-pas nul.
            if (distanceDeg <= EVENT_DISTANCE_EPSILON_DEG) {
                continue;
            }

            if (distanceDeg < nearestDistanceDeg) {
                nearestDistanceDeg = distanceDeg;
            }
        }
    }

    return nearestDistanceDeg;
}

// Conversion Angle → Temps

/**
 * Calcule la durée du prochain sous-pas interne.
 *
 * @param {object} state État moteur courant
 * @param {number} remainingTime Temps restant à intégrer dans Engine.update
 * @returns {object} Durée et diagnostics du pas choisi
 */
export function calculateCrankAngleSubstep(state) {
    const omega = Math.max(
        Number.isFinite(state.rpm)
            ? state.rpm * TWO_PI / 60
            : 0,
        0
    );

    const targetAngleStepDeg = getTargetCrankAngleStepDeg(state);
    const eventLimitedAngleStepDeg = getDistanceToNextEventDeg(
        state,
        targetAngleStepDeg
    );

    // À l'arrêt ou au démarreur très lent, la résolution est fixée par le temps.
    // Dès que l'angle devient plus contraignant, il réduit automatiquement dt.
    let selectedDt = MAX_INTERNAL_TIME_STEP;

    if (omega > 1e-9) {
        const angleLimitedDt = degreesToRadians(
            eventLimitedAngleStepDeg
        ) / omega;

        selectedDt = Math.min(selectedDt, angleLimitedDt);
    }

    selectedDt = Math.max(selectedDt, MIN_INTERNAL_TIME_STEP);

    const predictedAngleAdvanceDeg = omega
        * selectedDt
        * 180 / Math.PI;

    return {
        dt: selectedDt,
        targetAngleStepDeg,
        limitedAngleStepDeg: eventLimitedAngleStepDeg,
        predictedAngleAdvanceDeg,
        resolutionScale: getResolutionScale(state)
    };
}
