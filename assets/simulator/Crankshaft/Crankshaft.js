// Convertit les pressions cylindre en couple indiqué, sépare le pompage du cycle
// fermé et applique les pertes mécaniques internes. Dyno.js intègre ensuite le
// régime avec les inerties, les pertes de transmission et la charge du banc.

import {
    PISTON_AREA,
    SWEPT_VOLUME,
    CYLINDER_OFFSETS,
    getTorqueArm
} from "../Geometry/Geometry.js";
import { isIntakeValveOpen } from "../Valvetrain/IntakeValves.js";
import { isExhaustValveOpen } from "../Valvetrain/ExhaustValves.js";
import { calculateMechanicalLosses } from "./MechanicalLosses.js";

// Pression de référence

// Pression présente sous les pistons. Le carter est supposé ventilé à
// l'atmosphère. La force utile est donc calculée avec la pression manométrique.
const CRANKCASE_PRESSURE = 101325; // Pa

// Diagnostics et lissage d'affichage

// La combustion produit un couple très pulsé. Ces valeurs lissées servent
// uniquement à l'interface ; ni la thermodynamique ni la dynamique du banc ne
// les utilisent pour faire accélérer le moteur.
const TORQUE_DISPLAY_SMOOTHING_TAU = 0.080; // s

const FOUR_STROKE_CYCLE_ANGLE = 4 * Math.PI;
const TOTAL_DISPLACEMENT = SWEPT_VOLUME * CYLINDER_OFFSETS.length;

function updateSmoothedValue(currentValue, targetValue, dt) {
    const alpha = 1 - Math.exp(
        -Math.max(dt, 0) / TORQUE_DISPLAY_SMOOTHING_TAU
    );

    return currentValue + (targetValue - currentValue) * alpha;
}

// Identification du travail de pompage

/**
 * Sont classées comme échanges gazeux toutes les périodes pendant lesquelles
 * au moins une soupape relie le cylindre à un collecteur 0D.
 *
 * Le couple de pompage n'est donc pas une courbe ajoutée : il provient toujours
 * du travail réel des pressions d'admission et d'échappement sur le piston.
 */
function isGasExchangePhase(localAngle) {
    return isIntakeValveOpen(localAngle)
        || isExhaustValveOpen(localAngle);
}

// Calcul du couple moteur

export function updateCrankshaft(state, dt) {
    if (dt <= 0) {
        return;
    }

    let closedCycleIndicatedTorque = 0;
    let pumpingTorque = 0;

    // A. Couple indiqué issu exclusivement des pressions

    for (let i = 0; i < CYLINDER_OFFSETS.length; i++) {
        const localAngle = (
            state.crankAngle + CYLINDER_OFFSETS[i]
        ) % FOUR_STROKE_CYCLE_ANGLE;

        const gaugePressure = state.cylinderPressures[i]
            - CRANKCASE_PRESSURE;
        const gasForce = gaugePressure * PISTON_AREA;
        const cylinderGasTorque = gasForce * getTorqueArm(localAngle);

        if (isGasExchangePhase(localAngle)) {
            pumpingTorque += cylinderGasTorque;
        } else {
            closedCycleIndicatedTorque += cylinderGasTorque;
        }
    }

    const indicatedTorque = closedCycleIndicatedTorque + pumpingTorque;

    // B. Pertes mécaniques internes et accessoires moteur

    const omega = Math.max(
        state.rpm * 2 * Math.PI / 60,
        0
    );
    const losses = calculateMechanicalLosses(state);

    // Couple disponible au volant moteur avant la boîte et avant le banc.
    const brakeTorque = indicatedTorque
        - losses.totalMechanicalLossTorque;

    state.indicatedTorque = indicatedTorque;
    state.closedCycleIndicatedTorque = closedCycleIndicatedTorque;
    state.pumpingTorque = pumpingTorque;

    state.meanPistonSpeed = losses.meanPistonSpeed;
    state.averageCyclePeakGaugePressure
        = losses.averagePeakGaugePressure;
    state.frictionMeanEffectivePressure = losses.totalFMEP;
    state.baseFrictionTorque = losses.baseFrictionTorque;
    state.speedFrictionTorque = losses.speedFrictionTorque;
    state.loadFrictionTorque = losses.loadFrictionTorque;
    state.mechanicalFrictionTorque = losses.frictionTorque;
    state.accessoryTorque = losses.accessoryTorque;
    state.mechanicalLossTorque = losses.totalMechanicalLossTorque;
    state.mechanicalLossPower = losses.totalMechanicalLossTorque * omega;

    state.torque = brakeTorque;
    state.power = brakeTorque * omega;
    state.pumpingPower = pumpingTorque * omega;

    // Décomposition énergétique utile lors d'une calibration à régime stabilisé.
    // Les pertes restent des sorties du modèle ; aucune puissance n'est ajoutée
    // artificiellement pour atteindre une cible constructeur.
    state.closedCycleIndicatedPower = closedCycleIndicatedTorque * omega;
    state.indicatedPower = indicatedTorque * omega;
    state.pumpingLossPower = Math.max(-state.pumpingPower, 0);

    // C. Lissage réservé à l'affichage

    state.smoothedIndicatedTorque = updateSmoothedValue(
        state.smoothedIndicatedTorque,
        indicatedTorque,
        dt
    );
    state.smoothedClosedCycleTorque = updateSmoothedValue(
        state.smoothedClosedCycleTorque,
        closedCycleIndicatedTorque,
        dt
    );
    state.smoothedPumpingTorque = updateSmoothedValue(
        state.smoothedPumpingTorque,
        pumpingTorque,
        dt
    );
    state.smoothedBrakeTorque = updateSmoothedValue(
        state.smoothedBrakeTorque,
        brakeTorque,
        dt
    );

    // PMEP positive = perte de pompage moyenne.
    state.pumpingMeanEffectivePressure = Math.max(
        -state.smoothedPumpingTorque
        * FOUR_STROKE_CYCLE_ANGLE
        / TOTAL_DISPLACEMENT,
        0
    );

    // Valeur positive uniquement pour l'affichage du frein moteur.
    state.engineBrakingTorque = state.engineBrakingActive
        ? Math.max(-state.smoothedBrakeTorque, 0)
        : 0;
    state.engineBrakingPower = state.engineBrakingTorque * omega;
}
