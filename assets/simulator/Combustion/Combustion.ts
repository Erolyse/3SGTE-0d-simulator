// Lois de combustion indépendantes du stockage d'état moteur.
// Ce module rassemble le phasage et la loi de Wiebe afin que le calculateur,
// le solveur angulaire et la thermodynamique utilisent exactement les mêmes lois.

import { clamp } from "../Math/Utils.js";

// Durée de la loi de Wiebe, légèrement réduite avec le régime.
const LOW_SPEED_COMBUSTION_DURATION_DEG = 50;
const HIGH_SPEED_COMBUSTION_DURATION_DEG = 44;
const COMBUSTION_DURATION_SHORTENING_START_RPM = 3000;
const COMBUSTION_DURATION_SHORTENING_FULL_RPM = 6000;

const WIEBE_COMPLETENESS_FACTOR = 5.0;
const WIEBE_SHAPE_FACTOR = 2.0;

// Pour a=5 et m=2, cette position normalisée correspond exactement à 50 %
// de masse brûlée.
export const WIEBE_CA50_NORMALIZED_POSITION = Math.pow(
    Math.log(2) / WIEBE_COMPLETENESS_FACTOR,
    1 / (WIEBE_SHAPE_FACTOR + 1)
);

/** Durée analytique de combustion en degrés vilebrequin. */
export function getCombustionDurationDegForRpm(rpm: number): number {
    const durationShorteningFraction = clamp(
        (Math.max(rpm, 0) - COMBUSTION_DURATION_SHORTENING_START_RPM)
        / Math.max(
            COMBUSTION_DURATION_SHORTENING_FULL_RPM
            - COMBUSTION_DURATION_SHORTENING_START_RPM,
            1
        ),
        0,
        1
    );

    return LOW_SPEED_COMBUSTION_DURATION_DEG
        + (HIGH_SPEED_COMBUSTION_DURATION_DEG
            - LOW_SPEED_COMBUSTION_DURATION_DEG)
        * durationShorteningFraction;
}

/**
 * Avance plaçant le CA50 à l'angle demandé avec la loi de Wiebe utilisée.
 */
export function getIgnitionAdvanceForTargetCA50(
    rpm: number,
    targetCA50DegAfterTdc = 9.5
): number {
    return WIEBE_CA50_NORMALIZED_POSITION
        * getCombustionDurationDegForRpm(rpm)
        - targetCA50DegAfterTdc;
}

/** Fraction cumulée brûlée de la loi de Wiebe entre le début et la fin. */
export function getWiebeFraction(
    thetaLocal: number,
    ignitionStart: number,
    ignitionEnd: number,
    combustionDurationDeg: number
): number {
    if (thetaLocal <= ignitionStart) return 0;
    if (thetaLocal >= ignitionEnd) return 1;

    const normalizedAngle = (
        thetaLocal - ignitionStart
    ) / (
        combustionDurationDeg * Math.PI / 180
    );

    return 1 - Math.exp(
        -WIEBE_COMPLETENESS_FACTOR
        * Math.pow(normalizedAngle, WIEBE_SHAPE_FACTOR + 1)
    );
}
