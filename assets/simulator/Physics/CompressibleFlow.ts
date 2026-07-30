// Fonctions génériques de débit massique pour un gaz parfait compressible.
// Ce module ne connaît ni le papillon, ni les soupapes, ni le moteur.
// Il reçoit simplement deux réservoirs de pression et une aire de passage.
// Cela évite de recopier la même équation dans plusieurs composants.

import {
    GAMMA_AIR,
    R_AIR
} from "./GasProperties.js";

export {
    R_AIR,
    GAMMA_AIR,
    CV_AIR,
    CP_AIR,
    GAMMA_CYLINDER_GAS,
    CV_CYLINDER_GAS,
    CP_CYLINDER_GAS
} from "./GasProperties.js";

// Garde numérique commune à tous les calculs de débit.
const MIN_TEMPERATURE = 1; // K
const MIN_PRESSURE = 1;    // Pa

// Débit compressible dans un seul sens

/**
 * Calcule le débit massique d'un gaz parfait à travers un orifice.
 *
 * Le modèle distingue deux régimes :
 *
 * 1. Régime subsonique :
 *    le débit dépend de la pression amont ET de la pression aval.
 *
 * 2. Régime étranglé :
 *    la vitesse atteint Mach 1 dans la section minimale ; une baisse
 *    supplémentaire de la pression aval n'augmente plus le débit.
 *
 * @param {number} upstreamPressure Pression absolue amont en Pa
 * @param {number} upstreamTemperature Température absolue amont en K
 * @param {number} downstreamPressure Pression absolue aval en Pa
 * @param {number} flowArea Aire géométrique disponible en m²
 * @param {number} dischargeCoefficient Coefficient de décharge sans unité
 * @returns {number} Débit positif de l'amont vers l'aval, en kg/s
 */
export function calculateOneWayCompressibleMassFlow(
    upstreamPressure: number,
    upstreamTemperature: number,
    downstreamPressure: number,
    flowArea: number,
    dischargeCoefficient: number = 1,
    gamma: number = GAMMA_AIR,
    gasConstant: number = R_AIR
): number {
    const Pu = Math.max(upstreamPressure, MIN_PRESSURE);
    const Tu = Math.max(upstreamTemperature, MIN_TEMPERATURE);
    const Pd = Math.max(downstreamPressure, MIN_PRESSURE);
    const area = Math.max(flowArea, 0);
    const cd = Math.max(dischargeCoefficient, 0);
    const safeGamma = Math.max(gamma, 1.01);
    const safeGasConstant = Math.max(gasConstant, 1);

    // Aucun débit possible si la section est fermée ou si la pression amont
    // n'est pas supérieure à la pression aval.
    if (area <= 0 || cd <= 0 || Pu <= Pd) {
        return 0;
    }

    const pressureRatio = Math.max(0, Math.min(1, Pd / Pu));

    // Rapport critique Paval/Pamont pour un gaz parfait.
    // Pour gamma = 1.4, il vaut environ 0.528.
    const criticalPressureRatio = Math.pow(
        2 / (safeGamma + 1),
        safeGamma / (safeGamma - 1)
    );

    let dimensionlessFlowFunction: number;

    if (pressureRatio <= criticalPressureRatio) {
        // Débit étranglé.
        dimensionlessFlowFunction = Math.sqrt(safeGamma)
            * Math.pow(
                2 / (safeGamma + 1),
                (safeGamma + 1) / (2 * (safeGamma - 1))
            );
    } else {
        // Débit compressible subsonique.
        const pressureTerm = (2 * safeGamma / (safeGamma - 1))
            * (
                Math.pow(pressureRatio, 2 / safeGamma)
                - Math.pow(
                    pressureRatio,
                    (safeGamma + 1) / safeGamma
                )
            );

        dimensionlessFlowFunction = Math.sqrt(
            Math.max(pressureTerm, 0)
        );
    }

    return cd
        * area
        * Pu
        / Math.sqrt(safeGasConstant * Tu)
        * dimensionlessFlowFunction;
}

// Débit bidirectionnel

/**
 * Calcule un débit compressible signé entre deux volumes 0D.
 *
 * Convention de signe :
 * - résultat positif : le gaz va du volume A vers le volume B ;
 * - résultat négatif : le gaz va du volume B vers le volume A.
 *
 * Cette convention permet de représenter naturellement le reflux d'admission
 * lorsque le piston commence à remonter alors que la soupape est encore ouverte.
 *
 * @returns {number} Débit signé en kg/s
 */
export function calculateBidirectionalCompressibleMassFlow(
    pressureA: number,
    temperatureA: number,
    pressureB: number,
    temperatureB: number,
    flowArea: number,
    dischargeCoefficient: number = 1,
    gamma: number = GAMMA_AIR,
    gasConstant: number = R_AIR
): number {
    if (pressureA > pressureB) {
        return calculateOneWayCompressibleMassFlow(
            pressureA,
            temperatureA,
            pressureB,
            flowArea,
            dischargeCoefficient,
            gamma,
            gasConstant
        );
    }

    if (pressureB > pressureA) {
        return -calculateOneWayCompressibleMassFlow(
            pressureB,
            temperatureB,
            pressureA,
            flowArea,
            dischargeCoefficient,
            gamma,
            gasConstant
        );
    }

    return 0;
}