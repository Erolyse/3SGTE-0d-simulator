// Gestion des états moteur : arrêt, lancement au démarreur, fonctionnement,
// calage, régulation de ralenti et rupteur à hystérésis.
// Ce module ne crée pas directement de couple de combustion :
// - le démarreur fournit uniquement un couple mécanique au vilebrequin ;
// - le ralenti agit uniquement sur une aire d'air de dérivation ;
// - le rupteur et l'arrêt moteur agissent uniquement sur l'autorisation de
//   carburant/combustion.

import {
    getIgnitionAdvanceForTargetCA50
} from "../Thermodynamics/Thermodynamics.js";
import type {
    EngineOperatingState,
    EngineStateData
} from "../engine/EngineStateTypes.js";

// États de fonctionnement

export const ENGINE_OPERATING_STATES = Object.freeze({
    OFF: "off",
    CRANKING: "cranking",
    RUNNING: "running",
    STOPPING: "stopping",
    STALLED: "stalled"
} as const satisfies Record<string, EngineOperatingState>);

// Ralenti

// Cible de ralenti à chaud. Cette valeur est une calibration de travail pour
// l'expérience interactive, et non une donnée constructeur certifiée.
export const IDLE_TARGET_RPM = 900; // tr/min

// Le correcteur de ralenti n'agit que lorsque le conducteur ne demande presque
// aucun couple. L'hystérésis évite des commutations rapides près du seuil.
const IDLE_CONTROL_THROTTLE_ENABLE = 0.035;  // 3.5 %
const IDLE_CONTROL_THROTTLE_DISABLE = 0.070; // 7.0 %

// Commande de base du passage d'air de ralenti. Le correcteur PI ajoute ou
// retire de l'air autour de cette valeur.
const IDLE_AIR_FEED_FORWARD = 0.24; // 0..1

// Gains du correcteur PI. La sortie commande une aire physique dans
// IntakeManifold.js, elle ne modifie jamais directement le RPM.
const IDLE_AIR_KP = 0.00150; // commande par tr/min d'erreur
const IDLE_AIR_KI = 0.00018; // commande par (tr/min.s)
const IDLE_AIR_KD = 0.00100; // commande par (tr/min/s) de montée

const IDLE_AIR_INTEGRAL_MIN = -0.30;
const IDLE_AIR_INTEGRAL_MAX = 0.65;

// Pendant le lancement, une ouverture supplémentaire facilite le remplissage à
// très faible régime, comme le ferait un actuateur de ralenti de démarrage.
const CRANKING_IDLE_AIR_COMMAND = 0.62; // 0..1

// Après le démarrage, la commande de ralenti ne saute pas instantanément de sa
// valeur de lancement à sa valeur régulée.
const IDLE_AIR_ACTUATOR_TIME_CONSTANT = 0.080; // s

// Démarreur

// Couple maximal ramené au vilebrequin après le réducteur du démarreur.
// La valeur diminue avec le régime jusqu'à la vitesse à vide.
const STARTER_STALL_TORQUE = 150; // N.m au vilebrequin
const STARTER_NO_LOAD_RPM = 480;  // tr/min moteur

// Temps d'engagement électrique/mécanique du solénoïde et du pignon.
const STARTER_ENGAGEMENT_TIME_CONSTANT = 0.035; // s
const STARTER_RELEASE_TIME_CONSTANT = 0.020;    // s

// Petite ondulation du couple. Les à-coups visibles viennent surtout des phases
// de compression des quatre cylindres ; cette modulation ajoute le caractère
// électromécanique du démarreur sans devenir caricaturale.
const STARTER_TORQUE_RIPPLE = 0.12; // ±12 %

// La combustion est autorisée après plusieurs tours afin de représenter une
// phase de lancement mécanique avant les premières combustions.
const CRANK_REVOLUTIONS_BEFORE_COMBUSTION = 3.25; // tours vilebrequin

// Sécurités de séquence.
const MAXIMUM_CRANKING_TIME = 5.0; // s
const MINIMUM_CRANKING_RPM_FOR_COMBUSTION = 120; // tr/min
const RUNNING_DETECTION_RPM = 230; // tr/min

// Mélange légèrement enrichi pendant le lancement, puis retour progressif à la
// richesse normale. Le film de carburant n'est pas modélisé.
const CRANKING_AFR = 12.8;
const NORMAL_AFR = 14.7;

// Sous suralimentation, la masse de carburant reste calculée depuis la masse
// d'air réellement piégée. Cette loi ne crée donc pas de couple par cartographie :
// elle commande seulement une richesse plus sûre lorsque la pression augmente.
const BOOST_ENRICHMENT_START_PRESSURE = 15000; // Pa manométriques
const BOOST_ENRICHMENT_FULL_PRESSURE = 70000;  // Pa manométriques
const FULL_BOOST_AFR = 11.8;
const AFR_TRANSITION_TIME_CONSTANT = 0.20; // s

// Avance réduite pendant le lancement pour limiter le risque de retour contre le
// démarreur. Thermodynamics.js utilise directement cette valeur.
const CRANKING_IGNITION_TIMING_DEG = 5;
const RUNNING_IGNITION_TIMING_DEG = 15;

// Retard analytique sous boost. Il protège le modèle des pressions de pointe
// excessives sans imposer une courbe de puissance. La combustion continue à
// dépendre de la masse, de la loi de Wiebe et du cycle P-V.
const BOOST_IGNITION_RETARD_DEG_PER_BAR = 5.0;
const MAXIMUM_BOOST_IGNITION_RETARD_DEG = 6.0;

// À haut régime, le temps disponible par cycle diminue. Une petite avance
// analytique supplémentaire maintient le centre de combustion proche de son
// angle thermodynamiquement favorable, sans imposer une cartographie de couple.
const HIGH_SPEED_IGNITION_ADVANCE_START_RPM = 3500;
const HIGH_SPEED_IGNITION_ADVANCE_FULL_RPM = 6500;
const HIGH_SPEED_IGNITION_ADVANCE_MAX_DEG = 3.0;

// Le calcul brut ne doit pas avancer la combustion au-delà du phasage MBT
// recherché lorsque le boost diminue à haut régime. Sans cette limite, la baisse
// de retard sous boost avançait artificiellement le CA50 après 6000 tr/min.
export const TARGET_COMBUSTION_CA50_DEG_AFTER_TDC = 9.5;

// Calage et arrêt

// Un bref passage sous le seuil ne suffit pas à déclarer un calage : les quatre
// cylindres produisent naturellement un régime instantané légèrement irrégulier.
const STALL_DETECTION_RPM = 350; // tr/min
const STALL_DETECTION_DELAY = 0.32; // s

// Sous cette vitesse, le moteur est considéré mécaniquement arrêté.
const STOPPED_RPM = 12; // tr/min

// Rupteur

// Hystérésis demandée : coupure vers 7000 tr/min, reprise vers 6800 tr/min.
// Le 3S-GTE d'origine possède un papillon mécanique ; un rupteur crédible coupe
// donc ici le carburant/la combustion, pas physiquement le papillon.
export const REV_LIMITER_CUT_RPM = 7000;
export const REV_LIMITER_RESUME_RPM = 6800;

// Outils

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function firstOrderResponse(currentValue: number, targetValue: number, dt: number, timeConstant: number): number {
    const alpha = 1 - Math.exp(-Math.max(dt, 0) / timeConstant);
    return currentValue + (targetValue - currentValue) * alpha;
}

function setOperatingState(state: EngineStateData, nextState: EngineOperatingState): void {
    state.engineOperatingState = nextState;
    state.engineRunning = nextState === ENGINE_OPERATING_STATES.RUNNING;
}

// Commandes utilisateur

export function requestEngineStart(state: EngineStateData): void {
    if (state.engineOperatingState === ENGINE_OPERATING_STATES.RUNNING
        || state.engineOperatingState === ENGINE_OPERATING_STATES.CRANKING) {
        return;
    }

    state.ignitionOn = true;
    state.starterActive = true;
    state.combustionEnabled = false;
    state.revLimiterActive = false;
    state.fuelCutActive = false;

    state.starterElapsedTime = 0;
    state.starterCrankRevolutions = 0;
    state.stallDetectionTimer = 0;
    state.runningElapsedTime = 0;
    state.idleControlIntegral = 0;
    state.idleControlEnabled = true;

    setOperatingState(state, ENGINE_OPERATING_STATES.CRANKING);
}

export function requestEngineStop(state: EngineStateData): void {
    state.ignitionOn = false;
    state.starterActive = false;
    state.combustionEnabled = false;
    state.revLimiterActive = false;
    state.fuelCutActive = true;
    state.idleControlEnabled = false;
    state.idleControlIntegral = 0;

    if (state.rpm <= STOPPED_RPM) {
        state.rpm = 0;
        setOperatingState(state, ENGINE_OPERATING_STATES.OFF);
    } else {
        setOperatingState(state, ENGINE_OPERATING_STATES.STOPPING);
    }
}

export function toggleEngine(state: EngineStateData): void {
    if (state.engineOperatingState === ENGINE_OPERATING_STATES.RUNNING
        || state.engineOperatingState === ENGINE_OPERATING_STATES.CRANKING) {
        requestEngineStop(state);
    } else {
        requestEngineStart(state);
    }
}

// Régulation du ralenti

function updateIdleControl(state: EngineStateData, dt: number): void {
    if (state.engineOperatingState === ENGINE_OPERATING_STATES.CRANKING) {
        state.idleControlEnabled = true;
        state.idleAirControlTarget = CRANKING_IDLE_AIR_COMMAND;
    } else if (state.engineOperatingState === ENGINE_OPERATING_STATES.RUNNING) {
        if (state.idleControlEnabled) {
            if (state.throttle >= IDLE_CONTROL_THROTTLE_DISABLE) {
                state.idleControlEnabled = false;
            }
        } else if (state.throttle <= IDLE_CONTROL_THROTTLE_ENABLE) {
            state.idleControlEnabled = true;
        }

        if (state.idleControlEnabled) {
            const rpmError = IDLE_TARGET_RPM - state.rpm;

            state.idleControlIntegral = clamp(
                state.idleControlIntegral
                + IDLE_AIR_KI * rpmError * dt,
                IDLE_AIR_INTEGRAL_MIN,
                IDLE_AIR_INTEGRAL_MAX
            );

            // La dérivée vient de l'accélération physique calculée au pas
            // précédent par Dyno.js. Elle retire de l'air lorsque le régime est
            // déjà en train de monter rapidement et limite le dépassement.
            const rpmRate = Number.isFinite(
                state.crankshaftAngularAcceleration
            )
                ? state.crankshaftAngularAcceleration * 60 / (2 * Math.PI)
                : 0;

            state.idleAirControlTarget = clamp(
                IDLE_AIR_FEED_FORWARD
                + IDLE_AIR_KP * rpmError
                + state.idleControlIntegral
                - IDLE_AIR_KD * rpmRate,
                0,
                1
            );
        } else {
            // Le conducteur tient le papillon ouvert : l'IAC revient près de sa
            // position de base sans lutter contre la pédale.
            state.idleControlIntegral = firstOrderResponse(
                state.idleControlIntegral,
                0,
                dt,
                0.30
            );
            state.idleAirControlTarget = 0.08;
        }
    } else {
        state.idleControlEnabled = false;
        state.idleControlIntegral = 0;
        state.idleAirControlTarget = 0;
    }

    state.idleAirControlCommand = firstOrderResponse(
        state.idleAirControlCommand,
        state.idleAirControlTarget,
        dt,
        IDLE_AIR_ACTUATOR_TIME_CONSTANT
    );
}

// Démarreur et rupteur — avant la physique

function updateStarterTorque(state: EngineStateData, dt: number): void {
    let targetStarterTorque = 0;

    if (state.starterActive) {
        const speedFactor = clamp(
            1 - state.rpm / STARTER_NO_LOAD_RPM,
            0,
            1
        );

        // Quatre ondulations principales par tour de vilebrequin, plus une
        // petite harmonique. La pression de compression ajoute ses propres pics.
        const ripple = 1 + STARTER_TORQUE_RIPPLE * (
            0.75 * Math.sin(4 * state.crankAngle)
            + 0.25 * Math.sin(8 * state.crankAngle + 0.6)
        );

        targetStarterTorque = STARTER_STALL_TORQUE
            * speedFactor
            * Math.max(ripple, 0.65);
    }

    state.starterTorqueAtCrank = firstOrderResponse(
        state.starterTorqueAtCrank,
        targetStarterTorque,
        dt,
        state.starterActive
            ? STARTER_ENGAGEMENT_TIME_CONSTANT
            : STARTER_RELEASE_TIME_CONSTANT
    );

    const omega = Math.max(state.rpm * 2 * Math.PI / 60, 0);
    state.starterPower = state.starterTorqueAtCrank * omega;
}

function updateRevLimiter(state: EngineStateData): void {
    if (!state.ignitionOn
        || state.engineOperatingState !== ENGINE_OPERATING_STATES.RUNNING) {
        state.revLimiterActive = false;
        return;
    }

    if (state.revLimiterActive) {
        if (state.rpm <= REV_LIMITER_RESUME_RPM) {
            state.revLimiterActive = false;
        }
    } else if (state.rpm >= REV_LIMITER_CUT_RPM) {
        state.revLimiterActive = true;
        state.revLimiterEventCount++;
    }
}

/**
 * À appeler au début de chaque pas physique, avant l'admission et la combustion.
 */
export function updateEngineControlBeforePhysics(state: EngineStateData, dt: number): void {
    if (dt <= 0) return;

    updateRevLimiter(state);

    if (state.engineOperatingState === ENGINE_OPERATING_STATES.CRANKING) {
        state.combustionEnabled = state.ignitionOn
            && state.starterCrankRevolutions
            >= CRANK_REVOLUTIONS_BEFORE_COMBUSTION
            && state.rpm >= MINIMUM_CRANKING_RPM_FOR_COMBUSTION;
    } else {
        state.combustionEnabled = state.ignitionOn
            && state.engineOperatingState === ENGINE_OPERATING_STATES.RUNNING;
    }

    // Richesse et avance commandées. Le premier ordre évite une discontinuité
    // de chaleur libérée au passage CRANKING → RUNNING.
    const boostGaugePressure = Math.max(
        (Number.isFinite(state.intakePressure) ? state.intakePressure : 101325)
        - 101325,
        0
    );
    const boostEnrichmentFraction = clamp(
        (boostGaugePressure - BOOST_ENRICHMENT_START_PRESSURE)
        / Math.max(
            BOOST_ENRICHMENT_FULL_PRESSURE
            - BOOST_ENRICHMENT_START_PRESSURE,
            1
        ),
        0,
        1
    );
    const runningTargetAfr = NORMAL_AFR
        + (FULL_BOOST_AFR - NORMAL_AFR)
        * boostEnrichmentFraction;
    const targetAfr = state.engineOperatingState
    === ENGINE_OPERATING_STATES.CRANKING
        ? CRANKING_AFR
        : runningTargetAfr;

    state.afr = firstOrderResponse(
        state.afr,
        targetAfr,
        dt,
        AFR_TRANSITION_TIME_CONSTANT
    );

    const boostBar = boostGaugePressure / 100000;
    const boostIgnitionRetard = clamp(
        boostBar * BOOST_IGNITION_RETARD_DEG_PER_BAR,
        0,
        MAXIMUM_BOOST_IGNITION_RETARD_DEG
    );
    const highSpeedAdvanceFraction = clamp(
        (state.rpm - HIGH_SPEED_IGNITION_ADVANCE_START_RPM)
        / Math.max(
            HIGH_SPEED_IGNITION_ADVANCE_FULL_RPM
            - HIGH_SPEED_IGNITION_ADVANCE_START_RPM,
            1
        ),
        0,
        1
    );
    const highSpeedIgnitionAdvance = HIGH_SPEED_IGNITION_ADVANCE_MAX_DEG
        * highSpeedAdvanceFraction;
    state.highSpeedIgnitionAdvanceDeg = highSpeedIgnitionAdvance;

    const rawRunningIgnitionTimingDeg = RUNNING_IGNITION_TIMING_DEG
        + highSpeedIgnitionAdvance
        - boostIgnitionRetard;
    const combustionPhasingIgnitionLimitDeg
        = getIgnitionAdvanceForTargetCA50(
        state.rpm,
        TARGET_COMBUSTION_CA50_DEG_AFTER_TDC
    );

    // Exposé explicitement pour distinguer dans les rapports :
    // - la cible du contrôleur ;
    // - le CA50 analytique de la loi de Wiebe ;
    // - le CA50 réellement détecté dans la fraction brûlée enregistrée.
    state.combustionCA50TargetDegAfterTdc
        = TARGET_COMBUSTION_CA50_DEG_AFTER_TDC;
    state.combustionPhasingIgnitionLimitDeg
        = combustionPhasingIgnitionLimitDeg;
    state.ignitionPhasingLimited = state.engineOperatingState
        === ENGINE_OPERATING_STATES.RUNNING
        && rawRunningIgnitionTimingDeg
        > combustionPhasingIgnitionLimitDeg;

    state.ignitionTimingDeg = state.engineOperatingState
    === ENGINE_OPERATING_STATES.CRANKING
        ? CRANKING_IGNITION_TIMING_DEG
        : Math.min(
            rawRunningIgnitionTimingDeg,
            combustionPhasingIgnitionLimitDeg
        );

    updateIdleControl(state, dt);
    updateStarterTorque(state, dt);
}

// Transitions — après l'intégration du RPM

/**
 * À appeler après Dyno.js, lorsque le nouveau régime est connu.
 */
export function updateEngineControlAfterPhysics(state: EngineStateData, dt: number): void {
    if (dt <= 0) return;

    if (state.engineOperatingState === ENGINE_OPERATING_STATES.CRANKING) {
        state.starterElapsedTime += dt;
        state.starterCrankRevolutions += Math.max(state.rpm, 0)
            / 60 * dt;

        // Le moteur est déclaré autonome seulement lorsque les premières
        // combustions l'ont entraîné nettement au-dessus du régime démarreur.
        if (state.combustionEnabled && state.rpm >= RUNNING_DETECTION_RPM) {
            state.starterActive = false;
            state.stallDetectionTimer = 0;
            state.runningElapsedTime = 0;
            setOperatingState(state, ENGINE_OPERATING_STATES.RUNNING);
        } else if (state.starterElapsedTime >= MAXIMUM_CRANKING_TIME) {
            state.starterActive = false;
            state.combustionEnabled = false;
            state.ignitionOn = false;
            setOperatingState(state, ENGINE_OPERATING_STATES.STALLED);
        }
    } else if (state.engineOperatingState === ENGINE_OPERATING_STATES.RUNNING) {
        state.runningElapsedTime += dt;

        if (state.rpm < STALL_DETECTION_RPM) {
            state.stallDetectionTimer += dt;
        } else {
            state.stallDetectionTimer = 0;
        }

        if (state.stallDetectionTimer >= STALL_DETECTION_DELAY) {
            state.combustionEnabled = false;
            state.ignitionOn = false;
            state.revLimiterActive = false;
            state.fuelCutActive = true;
            setOperatingState(state, ENGINE_OPERATING_STATES.STALLED);
        }
    } else if (state.engineOperatingState === ENGINE_OPERATING_STATES.STOPPING) {
        if (state.rpm <= STOPPED_RPM) {
            state.rpm = 0;
            setOperatingState(state, ENGINE_OPERATING_STATES.OFF);
        }
    } else if ((state.engineOperatingState === ENGINE_OPERATING_STATES.OFF
            || state.engineOperatingState === ENGINE_OPERATING_STATES.STALLED)
        && state.rpm <= STOPPED_RPM) {
        state.rpm = 0;
    }
}