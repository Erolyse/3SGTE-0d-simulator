// Cinématique simplifiée des soupapes d'échappement du 3S-GTE.
// Le but n'est pas de reproduire au micromètre près un profil de came Toyota,
// mais de fournir au solveur 0D :
// - une ouverture et une fermeture physiques ;
// - une levée continue ;
// - une aire de passage réellement variable avec l'angle vilebrequin.
// Le calage est exprimé sur le cycle local de 720° d'un cylindre :
//   0°   : PMH début admission
//   180° : PMB fin admission
//   360° : PMH allumage
//   540° : PMB fin détente
//   720° : PMH fin échappement

import { STROKE } from "../Geometry/Geometry.js";
import {
    normalizeFourStrokeAngle,
    smoothStep01
} from "../Math/Utils.js";
import { calculateValveFlowArea } from "./ValveGeometry.js";

// Calage de travail

// Ouverture 40° avant le PMB de détente.
// L'ouverture anticipée sacrifie une petite partie du travail de détente, mais
// permet le blowdown : la pression élevée du cylindre se décharge rapidement
// vers le collecteur avant que le piston commence sa remontée d'échappement.
export const EXHAUST_VALVE_OPEN_DEG = 500; // ° vilebrequin local

// Fermeture au PMH d'échappement ; le croisement est nul dans ce modèle.
export const EXHAUST_VALVE_CLOSE_DEG = 720; // ° vilebrequin local

const EXHAUST_VALVE_OPEN_RAD = EXHAUST_VALVE_OPEN_DEG * Math.PI / 180;
const EXHAUST_VALVE_CLOSE_RAD = EXHAUST_VALVE_CLOSE_DEG * Math.PI / 180;
const EXHAUST_VALVE_DURATION_RAD = EXHAUST_VALVE_CLOSE_RAD
    - EXHAUST_VALVE_OPEN_RAD;

// Géométrie des soupapes

// Culasse 16 soupapes : deux soupapes d'échappement par cylindre.
// Les dimensions sont des valeurs géométriques de travail, non constructeur.
const EXHAUST_VALVE_COUNT = 2;
const EXHAUST_VALVE_DIAMETER = 0.029; // m — 29 mm, valeur de travail
const EXHAUST_PORT_DIAMETER = 0.0255; // m — diamètre de col équivalent par port
const EXHAUST_VALVE_MAX_LIFT = 0.0080; // m — 8.0 mm

// Le coefficient de décharge représente la contraction du jet, le siège, la
// courbure du port et les pertes non résolues par le modèle d'orifice parfait.
const EXHAUST_VALVE_LOW_REYNOLDS_DISCHARGE_COEFFICIENT = 0.70;
const EXHAUST_VALVE_HIGH_REYNOLDS_DISCHARGE_COEFFICIENT = 0.76;
const EXHAUST_REYNOLDS_TRANSITION_START_MEAN_PISTON_SPEED = 11.5; // m/s
const EXHAUST_REYNOLDS_TRANSITION_FULL_MEAN_PISTON_SPEED = 16.5; // m/s

/**
 * Correction continue du coefficient de décharge avec le développement de
 * l'écoulement turbulent dans les ports.
 */
export function getExhaustValveDischargeCoefficient(rpm: number): number {
    const meanPistonSpeed = 2 * STROKE * Math.max(rpm, 0) / 60;
    const transition = smoothStep01(
        (meanPistonSpeed
            - EXHAUST_REYNOLDS_TRANSITION_START_MEAN_PISTON_SPEED)
        / Math.max(
            EXHAUST_REYNOLDS_TRANSITION_FULL_MEAN_PISTON_SPEED
            - EXHAUST_REYNOLDS_TRANSITION_START_MEAN_PISTON_SPEED,
            1e-6
        )
    );

    return EXHAUST_VALVE_LOW_REYNOLDS_DISCHARGE_COEFFICIENT
        + (EXHAUST_VALVE_HIGH_REYNOLDS_DISCHARGE_COEFFICIENT
            - EXHAUST_VALVE_LOW_REYNOLDS_DISCHARGE_COEFFICIENT)
        * transition;
}

// Loi de levée

/**
 * Indique si la soupape d'échappement est ouverte à l'angle local demandé.
 */
export function isExhaustValveOpen(thetaLocal: number): boolean {
    const angle = normalizeFourStrokeAngle(thetaLocal);

    return angle >= EXHAUST_VALVE_OPEN_RAD
        && angle < EXHAUST_VALVE_CLOSE_RAD;
}

/**
 * Calcule la levée instantanée.
 *
 * Une loi sin² est utilisée car elle est continue à l'ouverture et à la
 * fermeture, avec une vitesse de soupape nulle aux deux extrémités.
 */
export function getExhaustValveLift(thetaLocal: number): number {
    if (!isExhaustValveOpen(thetaLocal)) {
        return 0;
    }

    const angle = normalizeFourStrokeAngle(thetaLocal);
    const normalizedPhase = (
        angle - EXHAUST_VALVE_OPEN_RAD
    ) / EXHAUST_VALVE_DURATION_RAD;

    return EXHAUST_VALVE_MAX_LIFT
        * Math.pow(Math.sin(Math.PI * normalizedPhase), 2);
}

/**
 * Aire géométrique totale disponible pour les deux soupapes.
 *
 * Aire de rideau :
 *   A = nombre × PI × diamètre soupape × levée
 *
 * Cette aire est plafonnée par l'aire totale des cols de ports afin que la
 * section ne continue pas à augmenter artificiellement à grande levée.
 */
export function getExhaustValveFlowArea(thetaLocal: number): number {
    const lift = getExhaustValveLift(thetaLocal);

    if (lift <= 0) {
        return 0;
    }

    return calculateValveFlowArea(
        EXHAUST_VALVE_COUNT,
        EXHAUST_VALVE_DIAMETER,
        EXHAUST_PORT_DIAMETER,
        lift
    );
}