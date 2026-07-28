// Banc 0D à un degré de liberté : moteur, transmission, roues et rouleaux sont
// liés sans glissement, et toutes les inerties sont ramenées au vilebrequin.

// Modes de fonctionnement du banc

export const DYNO_MODES = Object.freeze({
    // Banc inertiel pur : le moteur accélère uniquement les inerties physiques
    // et virtuelles du système. Aucun frein électromagnétique n'est appliqué.
    INERTIA: "inertia",

    // Banc freiné manuel : l'utilisateur impose dynoBrakeCommand entre 0 et 1.
    BRAKED: "braked",

    // Régulation de régime : un correcteur PI commande le frein pour maintenir
    // dynoTargetRpm. Ce mode est utile pour stabiliser un point de fonctionnement.
    RPM_HOLD: "rpmHold"
});

// Rapports de transmission

// Les rapports ci-dessous sont des valeurs de calibration de travail proches
// d'un rapport de quatrième et d'un pont de sportive des années 1990.
// Elles ne sont pas présentées comme des données Toyota certifiées.
// Un rapport proche de 1:1 limite
// de limiter les pertes et les vitesses internes de boîte.
export const DYNO_GEAR_RATIO = 0.972;       // rapport boîte : entrée / sortie
export const FINAL_DRIVE_RATIO = 4.285;    // rapport du pont
export const OVERALL_DRIVE_RATIO = DYNO_GEAR_RATIO * FINAL_DRIVE_RATIO;

// Rayon dynamique du pneu sous charge. Il sert à convertir la vitesse angulaire
// de la roue en vitesse linéaire virtuelle de la voiture.
export const WHEEL_RADIUS = 0.300; // m

// Rayon du rouleau du banc.
export const ROLLER_RADIUS = 0.318; // m

// Relation cinématique sans glissement :
//     omega_roue    = omega_moteur / rapport_global
//     omega_rouleau = omega_roue * rayon_roue / rayon_rouleau
const ROLLER_TO_ENGINE_SPEED_RATIO = WHEEL_RADIUS
    / (ROLLER_RADIUS * OVERALL_DRIVE_RATIO);

// Inerties physiques

// Ensemble tournant directement lié au vilebrequin : vilebrequin, volant moteur,
// embrayage et part équivalente des bielles/pistons.
export const ENGINE_ROTATING_INERTIA = 0.150; // kg.m²

// Inertie des arbres situés avant le rapport de boîte, donc déjà exprimée côté
// moteur et ajoutée directement.
const GEARBOX_INPUT_INERTIA = 0.018; // kg.m²

// Inertie des arbres après la réduction : arbre de sortie, transmission et pont.
// Elle doit être divisée par le carré du rapport global pour être ramenée au
// vilebrequin.
const DRIVELINE_OUTPUT_INERTIA = 0.120; // kg.m², côté roues

// Inertie totale des quatre roues et pneus autour de leur axe.
// L'ordre de grandeur choisi correspond à environ 1.15 kg.m² par roue.
const TOTAL_WHEEL_INERTIA = 4.60; // kg.m², côté roues

// Rouleaux et inertie virtuelle du véhicule

// Banc à deux rouleaux principaux. Chaque rouleau est assimilé à un cylindre
// plein : J = 1/2 * masse * rayon².
const ROLLER_COUNT = 2;
const SINGLE_ROLLER_MASS = 350; // kg
const SOLID_CYLINDER_INERTIA_FACTOR = 0.5;

const PHYSICAL_ROLLER_INERTIA = ROLLER_COUNT
    * SOLID_CYLINDER_INERTIA_FACTOR
    * SINGLE_ROLLER_MASS
    * ROLLER_RADIUS
    * ROLLER_RADIUS;

// Un banc moderne peut ajouter électroniquement une inertie virtuelle pour que
// la montée en vitesse corresponde à une masse véhicule donnée. Ici, la cible
// est la masse de travail de la Celica. Seule l'inertie manquante au-delà des
// rouleaux physiques est ajoutée.
export const TARGET_EQUIVALENT_VEHICLE_MASS = 1390; // kg

// Masse équivalente déjà représentée par les rouleaux physiques :
//     m_eq = J_rouleaux / rayon_rouleau²
const PHYSICAL_ROLLER_EQUIVALENT_MASS = PHYSICAL_ROLLER_INERTIA
    / (ROLLER_RADIUS * ROLLER_RADIUS);

const VIRTUAL_ADDED_MASS = Math.max(
    TARGET_EQUIVALENT_VEHICLE_MASS - PHYSICAL_ROLLER_EQUIVALENT_MASS,
    0
);

const VIRTUAL_ROLLER_INERTIA = VIRTUAL_ADDED_MASS
    * ROLLER_RADIUS
    * ROLLER_RADIUS;

const TOTAL_ROLLER_INERTIA = PHYSICAL_ROLLER_INERTIA
    + VIRTUAL_ROLLER_INERTIA;

// Inerties ramenées au vilebrequin

// Pour deux arbres liés par omega_2 = k * omega_1, l'inertie équivalente vue
// depuis l'arbre 1 est :
//     J_eq = J_2 * k²
const OUTPUT_DRIVELINE_INERTIA_AT_CRANK = (
    DRIVELINE_OUTPUT_INERTIA + TOTAL_WHEEL_INERTIA
) / Math.pow(OVERALL_DRIVE_RATIO, 2);

const ROLLER_INERTIA_AT_CRANK = TOTAL_ROLLER_INERTIA
    * Math.pow(ROLLER_TO_ENGINE_SPEED_RATIO, 2);

export const TOTAL_EQUIVALENT_INERTIA = ENGINE_ROTATING_INERTIA
    + GEARBOX_INPUT_INERTIA
    + OUTPUT_DRIVELINE_INERTIA_AT_CRANK
    + ROLLER_INERTIA_AT_CRANK;

// Au démarrage, le démarreur entraîne le moteur et l'arbre d'entrée. Le
// couplage progressif vers la transmission approxime un embrayage dans le modèle 1-DOF.
const DISCONNECTED_INERTIA = ENGINE_ROTATING_INERTIA
    + GEARBOX_INPUT_INERTIA;
const CLUTCH_ENGAGEMENT_TIME_CONSTANT = 0.90; // s
const CLUTCH_RELEASE_TIME_CONSTANT = 0.080;   // s

// Pertes de transmission

// Les pertes moteur internes sont déjà traitées dans MechanicalLosses.js.
// Les termes ci-dessous représentent uniquement la boîte, le pont, les joints,
// roulements et déformations des pneus sur le rouleau.
// Les pertes de transmission sont modélisées par un couple résistant opposé
// au mouvement, ce qui reste cohérent en traction comme en frein moteur.
const DRIVELINE_CONSTANT_LOSS_TORQUE = 2.0; // N.m côté vilebrequin
const DRIVELINE_VISCOUS_LOSS = 0.0040;      // N.m par rad/s moteur
const DRIVELINE_LOAD_LOSS_FACTOR = 0.045;   // 4.5 % du couple arbre en valeur absolue

// Frein du banc

// Couple maximal appliqué sur l'axe des rouleaux puis ramené au vilebrequin.
const MAX_ROLLER_BRAKE_TORQUE = 2500; // N.m sur les rouleaux

// Le frein ne passe pas instantanément de 0 à 100 %. Cette constante de temps
// reproduit l'inertie électromagnétique/hydraulique et stabilise l'intégration.
const BRAKE_ACTUATOR_TIME_CONSTANT = 0.060; // s

// Correcteur PI du mode maintien de régime.
// La sortie est une commande normalisée entre 0 et 1.
const RPM_HOLD_KP = 0.0014; // commande par tr/min d'erreur
const RPM_HOLD_KI = 0.00045; // commande par (tr/min.s)
const RPM_HOLD_INTEGRAL_MIN = 0;
const RPM_HOLD_INTEGRAL_MAX = 1;

// B. Frein Automatique De Décélération

// Sur un vrai banc, l'opérateur peut utiliser le frein électromagnétique pour
// ramener plus rapidement le rouleau après un tir. Ce frein n'appartient pas au
// moteur : il ne modifie donc ni le couple moteur calculé, ni le frein moteur
// issu du pompage et des frottements internes.
// Il est actif uniquement en mode INERTIA, lorsque le conducteur a relâché le
// papillon. La montée en régime à pleine charge reste ainsi strictement
// inchangée.
const COASTDOWN_THROTTLE_FULL_BRAKE = 0.015; // 1.5 % : frein totalement demandé
const COASTDOWN_THROTTLE_RELEASE = 0.060;    // 6 % : frein totalement relâché

// Sous ce régime, le frein automatique disparaît progressivement pour ne pas
// lutter contre la régulation de ralenti et ne pas provoquer un calage absurde.
const COASTDOWN_MIN_RPM = 1100; // tr/min
const COASTDOWN_FULL_RPM = 5000; // tr/min

// Couple supplémentaire voulu côté vilebrequin. Ces valeurs s'ajoutent au
// frein moteur physique déjà présent. Elles représentent uniquement le frein
// absorbant du banc pendant le retour au ralenti.
const COASTDOWN_MIN_CRANK_TORQUE = 35;  // N.m près de 1100 tr/min
const COASTDOWN_MAX_CRANK_TORQUE = 105; // N.m à partir de 5000 tr/min

// Charge routière virtuelle optionnelle

// Le banc inertiel pur ne doit pas recevoir automatiquement ces pertes. Elles
// peuvent être activées avec state.dynoRoadLoadEnabled pour simuler un essai de
// roulage plutôt qu'un tir de puissance classique.
const ROAD_LOAD_VEHICLE_MASS = 1390; // kg
const ROLLING_RESISTANCE_COEFFICIENT = 0.015;
const GRAVITY = 9.81; // m/s²
const AIR_DENSITY = 1.225; // kg/m³
const DRAG_AREA = 0.60; // m² = Cd * surface frontale

// Outils

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function firstOrderResponse(currentValue, targetValue, dt, timeConstant) {
    const alpha = 1 - Math.exp(-Math.max(dt, 0) / timeConstant);
    return currentValue + (targetValue - currentValue) * alpha;
}

/**
 * Convertit un couple appliqué aux rouleaux en couple équivalent au vilebrequin
 * par égalité des puissances : T_moteur * omega_moteur = T_rouleau * omega_rouleau.
 */
function rollerTorqueToCrankTorque(rollerTorque) {
    return rollerTorque * ROLLER_TO_ENGINE_SPEED_RATIO;
}

function calculateDrivelineLossTorque(engineTorque, engineOmega) {
    if (engineOmega <= 0.5) {
        return 0;
    }

    return DRIVELINE_CONSTANT_LOSS_TORQUE
        + DRIVELINE_VISCOUS_LOSS * engineOmega
        + DRIVELINE_LOAD_LOSS_FACTOR * Math.abs(engineTorque);
}

function calculateRoadLoad(state, virtualVehicleSpeed) {
    if (!state.dynoRoadLoadEnabled || virtualVehicleSpeed <= 0.01) {
        return {
            force: 0,
            crankTorque: 0
        };
    }

    const rollingForce = ROLLING_RESISTANCE_COEFFICIENT
        * ROAD_LOAD_VEHICLE_MASS
        * GRAVITY;

    const aerodynamicForce = 0.5
        * AIR_DENSITY
        * DRAG_AREA
        * virtualVehicleSpeed
        * virtualVehicleSpeed;

    const totalForce = rollingForce + aerodynamicForce;

    // Couple à la roue puis couple équivalent côté moteur.
    const crankTorque = totalForce
        * WHEEL_RADIUS
        / OVERALL_DRIVE_RATIO;

    return {
        force: totalForce,
        crankTorque
    };
}

function calculateCoastdownBrakeCommand(state) {
    // Le frein de retour est optionnel et ne s'applique qu'au moteur démarré.
    if (!state.dynoCoastdownBrakeEnabled
        || !state.engineRunning
        || state.rpm <= COASTDOWN_MIN_RPM) {
        return 0;
    }

    // Transition continue avec la pédale : aucun saut de couple lorsque le
    // conducteur commence à reprendre les gaz.
    const throttleFactor = clamp(
        (COASTDOWN_THROTTLE_RELEASE - state.throttle)
        / (COASTDOWN_THROTTLE_RELEASE - COASTDOWN_THROTTLE_FULL_BRAKE),
        0,
        1
    );

    if (throttleFactor <= 0) {
        return 0;
    }

    // À haut régime, le banc absorbe davantage de couple. Près du ralenti, la
    // commande diminue progressivement afin de laisser l'IAC stabiliser le moteur.
    const rpmFactor = clamp(
        (state.rpm - COASTDOWN_MIN_RPM)
        / (COASTDOWN_FULL_RPM - COASTDOWN_MIN_RPM),
        0,
        1
    );

    const requestedCrankTorque = (
        COASTDOWN_MIN_CRANK_TORQUE
        + (COASTDOWN_MAX_CRANK_TORQUE - COASTDOWN_MIN_CRANK_TORQUE)
        * rpmFactor
    ) * throttleFactor;

    // Conversion du couple vilebrequin demandé en couple rouleau puis en
    // commande normalisée du frein.
    const maxBrakeTorqueAtCrank = rollerTorqueToCrankTorque(
        MAX_ROLLER_BRAKE_TORQUE
    );

    return clamp(
        requestedCrankTorque / Math.max(maxBrakeTorqueAtCrank, 1e-6),
        0,
        1
    );
}

function calculateRpmHoldCommand(state, dt) {
    const targetRpm = Math.max(state.dynoTargetRpm, 0);
    const error = state.rpm - targetRpm;

    // Sous la cible, l'intégrateur est déchargé progressivement pour laisser
    // le moteur reprendre du régime.
    if (error < -100) {
        state.dynoControllerIntegral = firstOrderResponse(
            state.dynoControllerIntegral,
            0,
            dt,
            0.20
        );
    } else {
        state.dynoControllerIntegral = clamp(
            state.dynoControllerIntegral + RPM_HOLD_KI * error * dt,
            RPM_HOLD_INTEGRAL_MIN,
            RPM_HOLD_INTEGRAL_MAX
        );
    }

    const proportionalCommand = RPM_HOLD_KP * error;

    return clamp(
        proportionalCommand + state.dynoControllerIntegral,
        0,
        1
    );
}

function getRequestedBrakeCommand(state, dt) {
    switch (state.dynoMode) {
        case DYNO_MODES.BRAKED:
            state.dynoControllerIntegral = 0;
            state.dynoControllerCommand = 0;
            state.dynoCoastdownBrakeCommand = 0;
            return clamp(state.dynoBrakeCommand, 0, 1);

        case DYNO_MODES.RPM_HOLD: {
            state.dynoCoastdownBrakeCommand = 0;
            const command = calculateRpmHoldCommand(state, dt);
            state.dynoControllerCommand = command;
            return command;
        }

        case DYNO_MODES.INERTIA:
        default: {
            state.dynoControllerIntegral = 0;
            state.dynoControllerCommand = 0;

            // Le banc reste inertiel pendant l'accélération. Au lever de pied,
            // il applique uniquement le petit frein de retour défini plus haut.
            const coastdownCommand = calculateCoastdownBrakeCommand(state);
            state.dynoCoastdownBrakeCommand = coastdownCommand;
            return coastdownCommand;
        }
    }
}

// Mise à jour du banc

/**
 * Applique les inerties et les charges du banc, puis intègre le régime moteur.
 *
 * Entrée principale :
 *   state.torque = couple disponible à l'arbre moteur après pertes internes.
 *
 * Sortie principale :
 *   state.rpm, obtenu par I * domega/dt = somme des couples.
 */
export function updateDyno(state, dt) {
    if (dt <= 0) {
        return;
    }

    const engineOmega = Math.max(
        state.rpm * 2 * Math.PI / 60,
        0
    );

    // Le démarreur travaille embrayage débrayé. Une fois le moteur autonome,
    // la chaîne vers les rouleaux est raccordée progressivement.
    const targetCoupling = state.engineRunning ? 1 : 0;
    state.dynoCouplingFactor = firstOrderResponse(
        Number.isFinite(state.dynoCouplingFactor)
            ? state.dynoCouplingFactor
            : 0,
        targetCoupling,
        dt,
        targetCoupling > 0
            ? CLUTCH_ENGAGEMENT_TIME_CONSTANT
            : CLUTCH_RELEASE_TIME_CONSTANT
    );
    const couplingFactor = clamp(state.dynoCouplingFactor, 0, 1);

    const effectiveInertia = DISCONNECTED_INERTIA
        + couplingFactor * (
            OUTPUT_DRIVELINE_INERTIA_AT_CRANK
            + ROLLER_INERTIA_AT_CRANK
        );

    const wheelOmega = engineOmega
        / OVERALL_DRIVE_RATIO
        * couplingFactor;
    const rollerOmega = wheelOmega * WHEEL_RADIUS / ROLLER_RADIUS;
    const virtualVehicleSpeed = wheelOmega * WHEEL_RADIUS;

    // A. Pertes de transmission

    const drivelineLossTorque = calculateDrivelineLossTorque(
        state.torque,
        engineOmega
    ) * couplingFactor;

    // B. Frein physique du banc

    const requestedBrakeCommand = getRequestedBrakeCommand(state, dt);
    const requestedRollerBrakeTorque = requestedBrakeCommand
        * MAX_ROLLER_BRAKE_TORQUE;

    state.dynoAppliedBrakeTorque = firstOrderResponse(
        state.dynoAppliedBrakeTorque,
        requestedRollerBrakeTorque,
        dt,
        BRAKE_ACTUATOR_TIME_CONSTANT
    );

    // Le frein ne doit jamais faire repartir numériquement le banc en sens
    // inverse lorsque le système est quasiment arrêté.
    if (engineOmega <= 0.5 && state.torque <= 0) {
        state.dynoAppliedBrakeTorque = 0;
    }

    const dynoBrakeTorqueAtCrank = rollerTorqueToCrankTorque(
        state.dynoAppliedBrakeTorque
    ) * couplingFactor;

    // C. Charge routière virtuelle optionnelle

    const roadLoad = calculateRoadLoad(state, virtualVehicleSpeed);

    // D. Équation dynamique globale

    // Le démarreur est un couple mécanique externe appliqué au vilebrequin.
    // Il passe donc dans la même équation d'inertie que le couple moteur, sans
    // imposer artificiellement une vitesse de rotation.
    const starterTorque = Math.max(
        Number.isFinite(state.starterTorqueAtCrank)
            ? state.starterTorqueAtCrank
            : 0,
        0
    );

    const netCrankshaftTorque = state.torque
        + starterTorque
        - drivelineLossTorque
        - dynoBrakeTorqueAtCrank
        - roadLoad.crankTorque * couplingFactor;

    const angularAcceleration = netCrankshaftTorque
        / Math.max(effectiveInertia, 1e-6);

    const newEngineOmega = Math.max(
        engineOmega + angularAcceleration * dt,
        0
    );

    state.rpm = newEngineOmega * 60 / (2 * Math.PI);

    // E. Diagnostics cinématiques et énergétiques

    state.engineInertia = ENGINE_ROTATING_INERTIA;
    state.drivelineEquivalentInertia = GEARBOX_INPUT_INERTIA
        + couplingFactor * OUTPUT_DRIVELINE_INERTIA_AT_CRANK;
    state.rollerEquivalentInertia = couplingFactor
        * ROLLER_INERTIA_AT_CRANK;
    state.totalEquivalentInertia = effectiveInertia;

    state.physicalRollerInertia = PHYSICAL_ROLLER_INERTIA;
    state.virtualRollerInertia = VIRTUAL_ROLLER_INERTIA;
    state.physicalRollerEquivalentMass = PHYSICAL_ROLLER_EQUIVALENT_MASS;
    state.virtualAddedMass = VIRTUAL_ADDED_MASS;
    state.dynoEquivalentVehicleMass = TARGET_EQUIVALENT_VEHICLE_MASS;

    state.overallDriveRatio = OVERALL_DRIVE_RATIO;
    state.wheelAngularSpeed = wheelOmega;
    state.rollerAngularSpeed = rollerOmega;
    state.vehicleSpeedKmh = virtualVehicleSpeed * 3.6;
    state.rollerSurfaceSpeedKmh = rollerOmega * ROLLER_RADIUS * 3.6;

    state.drivelineLossTorque = drivelineLossTorque;
    state.drivelineLossPower = drivelineLossTorque * engineOmega;

    state.dynoRequestedBrakeCommand = requestedBrakeCommand;
    state.dynoBrakeTorqueAtCrank = dynoBrakeTorqueAtCrank;
    state.dynoAbsorbedPower = state.dynoAppliedBrakeTorque * rollerOmega;

    // En mode inertiel, tout couple de frein demandé vient du frein automatique
    // de retour. Diagnostic séparé pour vérifier son action dans l'interface.
    state.dynoCoastdownBrakeTorqueAtCrank = (
        state.dynoMode === DYNO_MODES.INERTIA
        && state.dynoCoastdownBrakeCommand > 0
    ) ? dynoBrakeTorqueAtCrank : 0;

    state.roadLoadForce = roadLoad.force;
    state.roadLoadTorque = roadLoad.crankTorque * couplingFactor;
    state.netCrankshaftTorque = netCrankshaftTorque;
    state.totalAppliedCrankTorque = state.torque + starterTorque;
    state.crankshaftAngularAcceleration = angularAcceleration;

    // Couple transmis au rouleau avant le frein, à partir de la puissance encore
    // disponible après les pertes de transmission.
    const transmittedCrankTorque = state.torque - drivelineLossTorque;
    state.wheelTorque = transmittedCrankTorque * OVERALL_DRIVE_RATIO;
    state.wheelPower = state.wheelTorque * wheelOmega;
    state.rollerDriveTorque = rollerOmega > 1e-6
        ? state.wheelPower / rollerOmega
        : 0;
    state.rollerDrivePower = state.rollerDriveTorque * rollerOmega;

    // Distance routière équivalente. La carrosserie ne se déplace évidemment
    // pas sur le banc ; cette grandeur sert uniquement à la consommation L/100.
    state.distanceTraveled += virtualVehicleSpeed * dt;
}
