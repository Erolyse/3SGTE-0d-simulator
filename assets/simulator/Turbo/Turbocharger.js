// Turbocompresseur 0D twin-entry : deux flux turbine, arbre inertiel,
// compresseur centrifuge, volume de charge, intercooler et wastegate.
// L'arbre suit J·dω/dt = Στ ; aucune courbe régime-couple n'est utilisée.

import {
    R_AIR,
    GAMMA_AIR,
    CP_AIR,
    CV_AIR,
    GAMMA_CYLINDER_GAS,
    CP_CYLINDER_GAS,
    calculateOneWayCompressibleMassFlow
} from "../Physics/CompressibleFlow.js";

// Conditions de référence

export const TURBO_INLET_PRESSURE = 101325; // Pa absolus, air ambiant
export const TURBO_INLET_TEMPERATURE = 293; // K, environ 20°C

// Pression après la turbine. Une ligne réelle oppose une légère contre-pression.
// Cette constante représente la turbine aval + downpipe + catalyseur + silencieux.
const TURBINE_OUTLET_PRESSURE = 108000; // Pa absolus

// Géométrie équivalente de la turbine

// Rayon moyen auquel le gaz transmet son moment cinétique à la roue.
// Valeur de calibration pour un petit turbo de série à faible inertie.
const TURBINE_EFFECTIVE_RADIUS = 0.026; // m

// Section minimale de chaque entrée de turbine twin-entry. Les deux scrolls
// restent indépendants jusqu'à la roue afin de conserver les pulsations.
const TURBINE_THROAT_AREA_PER_SCROLL = 1.45e-4; // m²
const TURBINE_DISCHARGE_COEFFICIENT = 0.78;

// Rendement maximal de conversion de l'énergie isentropique en puissance arbre.
// La roue n'atteint son meilleur comportement que près de sa vitesse de dessin :
// à faible vitesse, l'incidence et l'admission partielle réduisent le rendement.
// La transition est continue et dépend du régime réel du turbo, jamais du RPM
// moteur ni d'une cible de puissance.
const TURBINE_LOW_SPEED_PEAK_EFFICIENCY = 0.66;
const TURBINE_DESIGN_SPEED_PEAK_EFFICIENCY = 0.74;

// À très faible débit, seule une petite portion de la roue est correctement
// alimentée et l'incidence du jet sur les aubages est mauvaise. Le turbo ne peut
// donc pas exploiter son rendement nominal dès les premiers grammes par seconde.
// La faible alimentation de la roue réduit son rendement à bas débit ; le
// seuil de spool apparaît ainsi depuis le débit réel de chaque scroll.
const TURBINE_LOW_SPEED_FLOW_UTILIZATION_REFERENCE = 0.043; // kg/s par scroll
const TURBINE_DESIGN_SPEED_FLOW_UTILIZATION_REFERENCE = 0.030; // kg/s par scroll
const TURBINE_EFFICIENCY_RECOVERY_START_RPM = 118000;
const TURBINE_EFFICIENCY_RECOVERY_FULL_RPM = 130000;
const TURBINE_FLOW_UTILIZATION_EXPONENT = 4.0;

// Rapport optimal vitesse périphérique / vitesse de détente isentropique.
const TURBINE_OPTIMAL_BLADE_SPEED_RATIO = 0.68;

// Wastegate et contrôle de suralimentation

// Aire totale de la wastegate interne, divisée entre les deux scrolls dans ce
// modèle. Elle doit être suffisante pour stabiliser le boost à haut régime.
const WASTEGATE_MAX_AREA_PER_SCROLL = 3.20e-4; // m²
const WASTEGATE_DISCHARGE_COEFFICIENT = 0.72;

// Consigne de suralimentation manométrique du régulateur de wastegate.
// Cette cible pilote le boost, jamais directement le couple moteur.
export const BOOST_TARGET_GAUGE_PRESSURE = 90000; // Pa, cible haute charge nominale

// Le calculateur limite davantage la pression lorsque le compresseur travaille
// encore à faible débit corrigé, puis autorise progressivement la cible nominale.
// Cette loi agit sur la wastegate, jamais directement sur le couple moteur.
const BOOST_TARGET_LOW_FLOW_GAUGE_PRESSURE = 72000; // Pa
const BOOST_TARGET_FLOW_RAMP_START = 0.115; // kg/s corrigés
const BOOST_TARGET_FLOW_RAMP_FULL = 0.175;  // kg/s corrigés

// La capsule commence à ouvrir avant la consigne. Cette ouverture anticipée
// évite un pic de couple excessif au moment où le turbo atteint brutalement sa
// zone efficace. Le correcteur VSV-equivalent ajuste ensuite la position autour
// de la cible, sans imposer directement la pression du collecteur.
const WASTEGATE_CRACK_GAUGE_PRESSURE = 65000; // Pa
const WASTEGATE_FULL_OPEN_GAUGE_PRESSURE = 100000; // Pa
const WASTEGATE_CONTROL_KP = 1 / 26000;       // position par Pa d'erreur
const WASTEGATE_CONTROL_KI = 1 / 150000;      // position par (Pa.s)
const WASTEGATE_ACTUATOR_TIME_CONSTANT = 0.040; // s

// Garde de sécurité : ouverture supplémentaire lorsque l'arbre approche de sa
// vitesse maximale raisonnable.
const TURBO_OVERSPEED_WASTEGATE_START_RPM = 165000;
const TURBO_MAX_RPM = 185000;

// Arbre du turbo et pertes mécaniques

// Inertie polaire équivalente de la turbine, de l'arbre et du compresseur.
// Elle fixe principalement l'échelle de temps du spool.
export const TURBO_SHAFT_INERTIA = 1.20e-4; // kg.m²

// Pertes de paliers et de brassage. Elles s'opposent toujours à la rotation.
const TURBO_BEARING_VISCOUS_FRICTION = 1.8e-7; // N.m par rad/s
const TURBO_WINDAGE_FRICTION = 1.3e-11;        // N.m par (rad/s)²
const TURBO_LOW_SPEED_FRICTION = 0.0030;       // N.m asymptotique
const TURBO_LOW_SPEED_FRICTION_RPM = 12000;    // tr/min

// Compresseur centrifuge — modèle moyen

// Dimensions équivalentes de la roue compresseur. Elles sont des constantes de
// travail et non des mesures certifiées d'une roue CT20B particulière.
const COMPRESSOR_TIP_DIAMETER = 0.052;     // m
const COMPRESSOR_INDUCER_DIAMETER = 0.039; // m
const COMPRESSOR_TIP_RADIUS = COMPRESSOR_TIP_DIAMETER / 2;
const COMPRESSOR_INDUCER_AREA = Math.PI
    * Math.pow(COMPRESSOR_INDUCER_DIAMETER, 2)
    / 4;

// Le travail isentropique disponible suit U², conformément à l'équation d'Euler
// des turbomachines. Le produit slip * loading regroupe la géométrie des aubages.
const COMPRESSOR_SLIP_FACTOR = 0.88;
const COMPRESSOR_LOADING_COEFFICIENT = 0.66;

// Rendement calculé analytiquement en fonction de la vitesse et du coefficient
// de débit. Les limites évitent une température irréaliste hors du point nominal.
const COMPRESSOR_MIN_EFFICIENCY = 0.42;
const COMPRESSOR_MAX_EFFICIENCY = 0.76;
const COMPRESSOR_DESIGN_RPM = 125000;
const COMPRESSOR_DESIGN_FLOW_COEFFICIENT = 0.30;

// Orifice équivalent entre la roue et le volume de suralimentation. Il permet à
// l'air de traverser le compresseur même à très faible régime, donc le moteur
// conserve un fonctionnement atmosphérique avant le spool.
const COMPRESSOR_DELIVERY_AREA = 7.5e-4; // m²
const COMPRESSOR_DELIVERY_DISCHARGE_COEFFICIENT = 0.82;

// Capacité de débit traversant la roue. Une partie existe même arbre presque
// arrêté ; la contribution dynamique augmente avec la vitesse périphérique.
const COMPRESSOR_STATIC_FLOW_CAPACITY = 0.105; // kg/s
const COMPRESSOR_DYNAMIC_FLOW_COEFFICIENT = 0.34;
const COMPRESSOR_MAX_MASS_FLOW = 0.32; // kg/s, garde numérique/calibration

// Choke analytique fondé sur le débit massique corrigé à l'entrée. La limite
// représente la capacité aérodynamique équivalente de l'inducteur/diffuseur :
// elle ne dépend ni du régime moteur ni d'une courbe de couple recherchée.
const COMPRESSOR_REFERENCE_PRESSURE = 101325; // Pa
const COMPRESSOR_REFERENCE_TEMPERATURE = 293; // K
const COMPRESSOR_CHOKE_START_CORRECTED_FLOW = 0.155; // kg/s corrigés
const COMPRESSOR_CHOKE_FULL_CORRECTED_FLOW = 0.172;  // kg/s corrigés
const COMPRESSOR_MAX_CORRECTED_FLOW = 0.185;         // kg/s corrigés
const COMPRESSOR_CHOKE_MAX_PRESSURE_RISE_LOSS = 0.72;
const COMPRESSOR_CHOKE_MAX_EFFICIENCY_LOSS = 0.10;
const COMPRESSOR_CHOKE_RESPONSE_TIME_CONSTANT = 0.040; // s

// À vitesse périphérique transsonique, incidence, ondes de choc et fuites de
// bout réduisent le travail d'Euler réellement utilisable. La correction est
// fondée sur le Mach de bout de pale, jamais sur le régime moteur.
const COMPRESSOR_TIP_MACH_LOSS_START = 1.12;
const COMPRESSOR_TIP_MACH_LOSS_FULL = 1.38;
const COMPRESSOR_TIP_MACH_MAX_HEAD_LOSS = 0.22;

// Volume de suralimentation et intercooler

// Volume total entre sortie compresseur et papillon : durites, échangeur et
// réservoirs latéraux. Il crée la dynamique de montée et de chute du boost.
export const CHARGE_AIR_VOLUME = 0.0055; // m³, soit 5.5 litres

// Échange thermique de l'intercooler vers l'air ambiant. Le premier terme agit
// même véhicule immobile ; le second augmente avec le débit d'air comprimé et
// la vitesse équivalente du véhicule sur le banc.
const INTERCOOLER_BASE_CONDUCTANCE = 18; // W/K
const INTERCOOLER_FLOW_CONDUCTANCE = 520; // W/K par sqrt(kg/s)
const INTERCOOLER_SPEED_CONDUCTANCE = 0.75; // W/K par (m/s)
const INTERCOOLER_MAX_CONDUCTANCE = 250; // W/K
const INTERCOOLER_PRESSURE_RECOVERY = 0.985; // pertes globales très simplifiées

// Soupape de recirculation compresseur

// Au lever de pied sous boost, une soupape de recirculation évite de maintenir
// une forte pression devant le papillon et limite le pompage du compresseur.
const BYPASS_OPEN_THROTTLE = 0.075;
const BYPASS_CLOSE_THROTTLE = 0.12;
const BYPASS_OPEN_PRESSURE_DIFFERENCE = 26000; // Pa charge → collecteur
const BYPASS_MAX_AREA = 2.4e-4; // m²
const BYPASS_DISCHARGE_COEFFICIENT = 0.76;
const BYPASS_ACTUATOR_TIME_CONSTANT = 0.035; // s

// Gardes numériques et outils

const MIN_PRESSURE = 1000; // Pa
const MIN_TEMPERATURE = 180; // K
const MAX_CHARGE_TEMPERATURE = 520; // K
const MIN_GAS_MASS = 1e-9; // kg
const MAX_SOURCE_MASS_FRACTION_PER_STEP = 0.22;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function firstOrderResponse(currentValue, targetValue, dt, timeConstant) {
    const alpha = 1 - Math.exp(
        -Math.max(dt, 0) / Math.max(timeConstant, 1e-6)
    );
    return currentValue + (targetValue - currentValue) * alpha;
}

function smoothBell(value, center, width) {
    const normalized = (value - center) / Math.max(width, 1e-6);
    return Math.exp(-normalized * normalized);
}

function smoothStep01(value) {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
}

function getChargeTemperature(mass, energy) {
    return clamp(
        energy / (Math.max(mass, MIN_GAS_MASS) * CV_AIR),
        MIN_TEMPERATURE,
        MAX_CHARGE_TEMPERATURE
    );
}

function getChargePressure(mass, temperature) {
    return Math.max(
        mass * R_AIR * temperature / CHARGE_AIR_VOLUME,
        MIN_PRESSURE
    );
}

function initializeChargeAirIfNeeded(state) {
    const previousMass = Number.isFinite(state.chargeAirMass)
        ? state.chargeAirMass
        : 0;
    const previousEnergy = Number.isFinite(state.chargeAirInternalEnergy)
        ? state.chargeAirInternalEnergy
        : 0;

    const initialTemperature = Number.isFinite(state.chargeAirTemperature)
        ? Math.max(state.chargeAirTemperature, MIN_TEMPERATURE)
        : TURBO_INLET_TEMPERATURE;
    const initialPressure = Number.isFinite(state.chargeAirPressure)
        ? Math.max(state.chargeAirPressure, MIN_PRESSURE)
        : TURBO_INLET_PRESSURE;

    if (!Number.isFinite(state.chargeAirMass) || state.chargeAirMass <= 0) {
        state.chargeAirMass = initialPressure
            * CHARGE_AIR_VOLUME
            / (R_AIR * initialTemperature);
    }

    if (!Number.isFinite(state.chargeAirInternalEnergy)
        || state.chargeAirInternalEnergy <= 0) {
        state.chargeAirInternalEnergy = state.chargeAirMass
            * CV_AIR
            * initialTemperature;
    }

    state.chargeAirMassCorrectionStep
        += state.chargeAirMass - previousMass;
    state.chargeAirEnergyCorrectionStep
        += state.chargeAirInternalEnergy - previousEnergy;
}

// Frontière turbine + wastegate pour un scroll

/**
 * Calcule les débits demandés par la turbine et la wastegate pour un scroll.
 *
 * Cette fonction ne modifie pas directement la masse du collecteur. Le module
 * ExhaustManifold.js applique ensuite les limites de masse disponibles et met à
 * jour l'énergie du scroll. Cela conserve une responsabilité claire entre le
 * volume échappement et la machine tournante.
 */
export function calculateTurboExhaustBoundary(
    state,
    scrollIndex,
    upstreamPressure,
    upstreamTemperature
) {
    const pressure = Math.max(upstreamPressure, MIN_PRESSURE);
    const temperature = Math.max(upstreamTemperature, MIN_TEMPERATURE);
    const shaftOmega = Math.max(
        Number.isFinite(state.turboShaftAngularSpeed)
            ? state.turboShaftAngularSpeed
            : 0,
        0
    );
    const turboRpm = shaftOmega * 60 / (2 * Math.PI);
    const rawDesignSpeedFraction = clamp(
        (turboRpm - TURBINE_EFFICIENCY_RECOVERY_START_RPM)
        / Math.max(
            TURBINE_EFFICIENCY_RECOVERY_FULL_RPM
            - TURBINE_EFFICIENCY_RECOVERY_START_RPM,
            1
        ),
        0,
        1
    );
    const designSpeedFraction = rawDesignSpeedFraction
        * rawDesignSpeedFraction
        * (3 - 2 * rawDesignSpeedFraction);
    const turbinePeakEfficiency = TURBINE_LOW_SPEED_PEAK_EFFICIENCY
        + (TURBINE_DESIGN_SPEED_PEAK_EFFICIENCY
            - TURBINE_LOW_SPEED_PEAK_EFFICIENCY)
        * designSpeedFraction;
    const flowUtilizationReference
        = TURBINE_LOW_SPEED_FLOW_UTILIZATION_REFERENCE
        + (TURBINE_DESIGN_SPEED_FLOW_UTILIZATION_REFERENCE
            - TURBINE_LOW_SPEED_FLOW_UTILIZATION_REFERENCE)
        * designSpeedFraction;

    const turbineMassFlow = calculateOneWayCompressibleMassFlow(
        pressure,
        temperature,
        TURBINE_OUTLET_PRESSURE,
        TURBINE_THROAT_AREA_PER_SCROLL,
        TURBINE_DISCHARGE_COEFFICIENT,
        GAMMA_CYLINDER_GAS,
        R_AIR
    );

    const wastegatePosition = clamp(
        Number.isFinite(state.wastegatePosition)
            ? state.wastegatePosition
            : 0,
        0,
        1
    );
    const wastegateArea = WASTEGATE_MAX_AREA_PER_SCROLL
        * wastegatePosition;
    const wastegateMassFlow = calculateOneWayCompressibleMassFlow(
        pressure,
        temperature,
        TURBINE_OUTLET_PRESSURE,
        wastegateArea,
        WASTEGATE_DISCHARGE_COEFFICIENT,
        GAMMA_CYLINDER_GAS,
        R_AIR
    );

    const outletToInletPressureRatio = clamp(
        TURBINE_OUTLET_PRESSURE / pressure,
        0,
        1
    );
    const idealSpecificWork = pressure > TURBINE_OUTLET_PRESSURE
        ? CP_CYLINDER_GAS
        * temperature
        * (
            1 - Math.pow(
                outletToInletPressureRatio,
                (GAMMA_CYLINDER_GAS - 1)
                / GAMMA_CYLINDER_GAS
            )
        )
        : 0;

    // Vitesse idéale du jet de détente. Elle définit la vitesse de pale optimale.
    const spoutingVelocity = Math.sqrt(
        Math.max(2 * idealSpecificWork, 0)
    );
    const optimalBladeSpeed = TURBINE_OPTIMAL_BLADE_SPEED_RATIO
        * spoutingVelocity;
    const optimalShaftSpeed = optimalBladeSpeed
        / Math.max(TURBINE_EFFECTIVE_RADIUS, 1e-6);
    const runawayShaftSpeed = Math.max(2 * optimalShaftSpeed, 1);

    // Courbe couple-vitesse analytique : couple maximal à l'arrêt, puissance
    // maximale près de la moitié de la vitesse à vide. Cela permet au turbo de
    // démarrer à 0 tr/min sans division artificielle par omega.
    const stallTorquePerMassFlow = optimalShaftSpeed > 1
        ? 2
        * idealSpecificWork
        * turbinePeakEfficiency
        / optimalShaftSpeed
        : 0;
    const speedTorqueFactor = clamp(
        1 - shaftOmega / runawayShaftSpeed,
        0,
        1
    );
    // Fraction du rendement de captation réellement utilisable à ce débit.
    // La puissance disponible dans le gaz existe déjà à bas débit, mais une
    // turbine partiellement alimentée ne la transforme pas avec son rendement
    // nominal. La puissance augmente fortement lorsque le débit de chaque scroll
    // approche de sa zone de fonctionnement utile.
    const flowUtilization = 1 - Math.exp(
        -Math.pow(
            turbineMassFlow / flowUtilizationReference,
            TURBINE_FLOW_UTILIZATION_EXPONENT
        )
    );

    const turbineTorque = turbineMassFlow
        * stallTorquePerMassFlow
        * speedTorqueFactor
        * flowUtilization;
    const turbineShaftPower = turbineTorque * shaftOmega;
    const availableGasPower = turbineMassFlow * idealSpecificWork;

    state.turbineDesignSpeedFraction = designSpeedFraction;
    state.turbineEffectivePeakEfficiency = turbinePeakEfficiency;
    state.turbineFlowUtilizationReference = flowUtilizationReference;
    state.turbineFlowUtilization[scrollIndex] = flowUtilization;
    state.turbineAerodynamicEfficiency[scrollIndex] = availableGasPower > 1e-9
        ? clamp(turbineShaftPower / availableGasPower, 0, 1)
        : 0;

    const turbineOutletTemperature = turbineMassFlow > 1e-9
        ? Math.max(
            temperature
            - turbineShaftPower
            / (turbineMassFlow * CP_CYLINDER_GAS),
            MIN_TEMPERATURE
        )
        : temperature;

    return {
        scrollIndex,
        requestedTurbineMassFlow: Math.max(turbineMassFlow, 0),
        requestedWastegateMassFlow: Math.max(wastegateMassFlow, 0),
        turbineTorque: Math.max(turbineTorque, 0),
        turbineShaftPower: Math.max(turbineShaftPower, 0),
        availableGasPower: Math.max(availableGasPower, 0),
        idealSpecificWork: Math.max(idealSpecificWork, 0),
        turbineOutletTemperature,
        wastegateArea,
        turbineOutletPressure: TURBINE_OUTLET_PRESSURE
    };
}

// Compresseur et volume de charge

function calculateCompressorEfficiency(
    turboRpm,
    massFlow,
    inletDensity,
    tipSpeed
) {
    const speedRatio = turboRpm / COMPRESSOR_DESIGN_RPM;
    const flowCoefficient = tipSpeed > 1
        ? massFlow
        / (
            Math.max(inletDensity, 0.1)
            * COMPRESSOR_INDUCER_AREA
            * tipSpeed
        )
        : 0;

    const speedQuality = smoothBell(speedRatio, 0.85, 0.72);
    const flowQuality = smoothBell(
        flowCoefficient,
        COMPRESSOR_DESIGN_FLOW_COEFFICIENT,
        0.24
    );

    return clamp(
        COMPRESSOR_MIN_EFFICIENCY
        + (COMPRESSOR_MAX_EFFICIENCY - COMPRESSOR_MIN_EFFICIENCY)
        * speedQuality
        * flowQuality,
        COMPRESSOR_MIN_EFFICIENCY,
        COMPRESSOR_MAX_EFFICIENCY
    );
}

function updateCompressorBypass(state, dt) {
    const pressureDifference = state.chargeAirPressure
        - state.intakePressure;

    let target = 0;
    if (state.compressorBypassValvePosition > 0.05) {
        target = state.throttle <= BYPASS_CLOSE_THROTTLE
        && pressureDifference > BYPASS_OPEN_PRESSURE_DIFFERENCE * 0.55
            ? 1
            : 0;
    } else {
        target = state.throttle <= BYPASS_OPEN_THROTTLE
        && pressureDifference > BYPASS_OPEN_PRESSURE_DIFFERENCE
            ? 1
            : 0;
    }

    state.compressorBypassValveTarget = target;
    state.compressorBypassValvePosition = firstOrderResponse(
        state.compressorBypassValvePosition,
        target,
        dt,
        BYPASS_ACTUATOR_TIME_CONSTANT
    );
}

function updateChargeAirAndCompressor(state, dt) {
    initializeChargeAirIfNeeded(state);

    let chargeMass = Math.max(state.chargeAirMass, MIN_GAS_MASS);
    let chargeEnergy = Math.max(
        state.chargeAirInternalEnergy,
        chargeMass * CV_AIR * MIN_TEMPERATURE
    );
    let chargeTemperature = getChargeTemperature(chargeMass, chargeEnergy);
    let chargePressure = getChargePressure(chargeMass, chargeTemperature);

    const shaftOmega = Math.max(state.turboShaftAngularSpeed, 0);
    const turboRpm = shaftOmega * 60 / (2 * Math.PI);
    const tipSpeed = shaftOmega * COMPRESSOR_TIP_RADIUS;
    const inletDensity = TURBO_INLET_PRESSURE
        / (R_AIR * TURBO_INLET_TEMPERATURE);

    // Travail isentropique disponible créé par la roue, proportionnel à U².
    const speedOfSoundAtInlet = Math.sqrt(
        GAMMA_AIR * R_AIR * TURBO_INLET_TEMPERATURE
    );
    const compressorTipMach = tipSpeed
        / Math.max(speedOfSoundAtInlet, 1e-6);
    const compressorTipMachLossFraction = smoothStep01(
        (compressorTipMach - COMPRESSOR_TIP_MACH_LOSS_START)
        / Math.max(
            COMPRESSOR_TIP_MACH_LOSS_FULL
            - COMPRESSOR_TIP_MACH_LOSS_START,
            1e-6
        )
    );
    const effectiveLoadingCoefficient = COMPRESSOR_LOADING_COEFFICIENT
        * (1 - COMPRESSOR_TIP_MACH_MAX_HEAD_LOSS
            * compressorTipMachLossFraction);
    const isentropicSpecificHead = COMPRESSOR_SLIP_FACTOR
        * effectiveLoadingCoefficient
        * tipSpeed
        * tipSpeed;
    const rawPressureRatioCapability = Math.pow(
        1 + isentropicSpecificHead
        / (CP_AIR * TURBO_INLET_TEMPERATURE),
        GAMMA_AIR / (GAMMA_AIR - 1)
    );

    // Débit corrigé de l'étape précédente. Le retard d'un sous-pas est
    // négligeable et évite une boucle algébrique entre débit, pression et choke.
    const correctedFlowFactor = Math.sqrt(
        TURBO_INLET_TEMPERATURE / COMPRESSOR_REFERENCE_TEMPERATURE
    ) / Math.max(
        TURBO_INLET_PRESSURE / COMPRESSOR_REFERENCE_PRESSURE,
        1e-6
    );
    const previousCorrectedMassFlow = Math.max(
        Number.isFinite(state.compressorMassFlow)
            ? state.compressorMassFlow
            : 0,
        0
    ) * correctedFlowFactor;
    const chokeTarget = smoothStep01(
        (previousCorrectedMassFlow
            - COMPRESSOR_CHOKE_START_CORRECTED_FLOW)
        / Math.max(
            COMPRESSOR_CHOKE_FULL_CORRECTED_FLOW
            - COMPRESSOR_CHOKE_START_CORRECTED_FLOW,
            1e-6
        )
    );
    const compressorChokeFraction = firstOrderResponse(
        Number.isFinite(state.compressorChokeFraction)
            ? state.compressorChokeFraction
            : 0,
        chokeTarget,
        dt,
        COMPRESSOR_CHOKE_RESPONSE_TIME_CONSTANT
    );

    const retainedPressureRiseFraction = 1
        - COMPRESSOR_CHOKE_MAX_PRESSURE_RISE_LOSS
        * compressorChokeFraction;
    const pressureRatioCapability = 1
        + (rawPressureRatioCapability - 1)
        * retainedPressureRiseFraction;
    const deliveryPressureCapability = TURBO_INLET_PRESSURE
        * pressureRatioCapability
        * INTERCOOLER_PRESSURE_RECOVERY;

    // Une température source estimée sert au calcul initial du débit ; le
    // rendement est recalculé avec le débit et le rapport de pression obtenus.
    const nominalDeliveryTemperature = TURBO_INLET_TEMPERATURE
        + isentropicSpecificHead
        / (CP_AIR * COMPRESSOR_MAX_EFFICIENCY);

    const requestedCompressorMassFlow
        = calculateOneWayCompressibleMassFlow(
        deliveryPressureCapability,
        nominalDeliveryTemperature,
        chargePressure,
        COMPRESSOR_DELIVERY_AREA,
        COMPRESSOR_DELIVERY_DISCHARGE_COEFFICIENT,
        GAMMA_AIR,
        R_AIR
    );

    const dynamicFlowCapacity = COMPRESSOR_DYNAMIC_FLOW_COEFFICIENT
        * inletDensity
        * COMPRESSOR_INDUCER_AREA
        * Math.max(tipSpeed, 0);
    const mechanicalMaximumMassFlow = clamp(
        COMPRESSOR_STATIC_FLOW_CAPACITY + dynamicFlowCapacity,
        0,
        COMPRESSOR_MAX_MASS_FLOW
    );
    const correctedFlowMaximumMassFlow = COMPRESSOR_MAX_CORRECTED_FLOW
        / Math.max(correctedFlowFactor, 1e-6);
    const maximumMassFlow = Math.min(
        mechanicalMaximumMassFlow,
        correctedFlowMaximumMassFlow
    );
    const compressorMassFlow = Math.min(
        requestedCompressorMassFlow,
        maximumMassFlow
    );

    const actualPressureRatio = clamp(
        Math.max(chargePressure, TURBO_INLET_PRESSURE)
        / TURBO_INLET_PRESSURE,
        1,
        Math.max(pressureRatioCapability, 1)
    );
    const baseCompressorEfficiency = calculateCompressorEfficiency(
        turboRpm,
        compressorMassFlow,
        inletDensity,
        tipSpeed
    );
    const compressorEfficiency = clamp(
        baseCompressorEfficiency
        * (1 - COMPRESSOR_CHOKE_MAX_EFFICIENCY_LOSS
            * compressorChokeFraction),
        COMPRESSOR_MIN_EFFICIENCY,
        COMPRESSOR_MAX_EFFICIENCY
    );
    const actualIsentropicTemperature = TURBO_INLET_TEMPERATURE
        * Math.pow(
            actualPressureRatio,
            (GAMMA_AIR - 1) / GAMMA_AIR
        );
    const compressorOutletTemperature = clamp(
        TURBO_INLET_TEMPERATURE
        + (actualIsentropicTemperature - TURBO_INLET_TEMPERATURE)
        / compressorEfficiency,
        TURBO_INLET_TEMPERATURE,
        MAX_CHARGE_TEMPERATURE
    );
    const compressorFluidSpecificWork = CP_AIR
        * (compressorOutletTemperature - TURBO_INLET_TEMPERATURE);

    // Même lorsque le rapport de pression utile chute à cause de l'incidence
    // ou du Mach de bout de pale, la roue continue d'absorber du travail. Une
    // partie est alors dissipée en pertes aérodynamiques au lieu de disparaître
    // du bilan d'arbre, ce qui évite l'emballement artificiel du rotor.
    const compressorEulerShaftSpecificWork = isentropicSpecificHead
        / Math.max(compressorEfficiency, COMPRESSOR_MIN_EFFICIENCY);
    const compressorShaftSpecificWork = Math.max(
        compressorFluidSpecificWork,
        0.72 * compressorEulerShaftSpecificWork
    );
    const compressorFluidPower = compressorMassFlow
        * compressorFluidSpecificWork;
    const compressorPower = compressorMassFlow
        * compressorShaftSpecificWork;
    const compressorAerodynamicLossPower = Math.max(
        compressorPower - compressorFluidPower,
        0
    );
    const compressorTorque = shaftOmega > 50
        ? compressorPower / shaftOmega
        : 0;

    // A. Masse et enthalpie entrant depuis le compresseur

    const incomingCompressorMass = compressorMassFlow * dt;
    const incomingCompressorEnthalpy = incomingCompressorMass
        * CP_AIR
        * compressorOutletTemperature;
    chargeMass += incomingCompressorMass;
    chargeEnergy += incomingCompressorEnthalpy;
    state.chargeAirCompressorMassStep += incomingCompressorMass;
    state.chargeAirCompressorEnthalpyStep
        += incomingCompressorEnthalpy;

    // B. Débit traversant le papillon vers le collecteur

    // IntakeManifold.js calcule ce débit juste avant ce module.
    // Positif : charge pipe → collecteur ; négatif : retour collecteur → charge.
    const throttleMassFlow = Number.isFinite(state.intakeAirMassFlow)
        ? state.intakeAirMassFlow
        : 0;

    let signedThrottleMassOutOfCharge = 0;
    let signedThrottleEnthalpyOutOfCharge = 0;

    if (throttleMassFlow >= 0) {
        const requestedOutgoingMass = throttleMassFlow * dt;
        const outgoingMass = Math.min(
            requestedOutgoingMass,
            chargeMass * MAX_SOURCE_MASS_FRACTION_PER_STEP
        );
        const outgoingEnthalpy = outgoingMass
            * CP_AIR
            * chargeTemperature;
        chargeMass -= outgoingMass;
        chargeEnergy -= outgoingEnthalpy;
        signedThrottleMassOutOfCharge = outgoingMass;
        signedThrottleEnthalpyOutOfCharge = outgoingEnthalpy;
    } else {
        const returningMass = -throttleMassFlow * dt;
        const returningEnthalpy = returningMass
            * CP_AIR
            * Math.max(state.intakeTemperature, MIN_TEMPERATURE);
        chargeMass += returningMass;
        chargeEnergy += returningEnthalpy;
        signedThrottleMassOutOfCharge = -returningMass;
        signedThrottleEnthalpyOutOfCharge = -returningEnthalpy;
    }

    state.chargeAirThrottleMassTransferStep
        += signedThrottleMassOutOfCharge;
    state.chargeAirThrottleEnthalpyTransferStep
        += signedThrottleEnthalpyOutOfCharge;

    const postThrottleUnclampedMass = chargeMass;
    const postThrottleUnclampedEnergy = chargeEnergy;
    chargeMass = Math.max(chargeMass, MIN_GAS_MASS);
    chargeEnergy = Math.max(
        chargeEnergy,
        chargeMass * CV_AIR * MIN_TEMPERATURE
    );
    state.chargeAirMassCorrectionStep
        += chargeMass - postThrottleUnclampedMass;
    state.chargeAirEnergyCorrectionStep
        += chargeEnergy - postThrottleUnclampedEnergy;
    chargeTemperature = getChargeTemperature(chargeMass, chargeEnergy);
    chargePressure = getChargePressure(chargeMass, chargeTemperature);

    // C. Soupape de recirculation au lever de pied

    state.chargeAirPressure = chargePressure;
    state.chargeAirTemperature = chargeTemperature;
    updateCompressorBypass(state, dt);

    const bypassArea = BYPASS_MAX_AREA
        * clamp(state.compressorBypassValvePosition, 0, 1);
    const bypassMassFlow = calculateOneWayCompressibleMassFlow(
        chargePressure,
        chargeTemperature,
        TURBO_INLET_PRESSURE,
        bypassArea,
        BYPASS_DISCHARGE_COEFFICIENT,
        GAMMA_AIR,
        R_AIR
    );
    const bypassMass = Math.min(
        bypassMassFlow * dt,
        chargeMass * MAX_SOURCE_MASS_FRACTION_PER_STEP
    );
    const bypassEnthalpy = bypassMass * CP_AIR * chargeTemperature;
    chargeMass -= bypassMass;
    chargeEnergy -= bypassEnthalpy;
    state.chargeAirBypassMassStep += bypassMass;
    state.chargeAirBypassEnthalpyStep += bypassEnthalpy;

    // D. Refroidissement par l'intercooler

    const postBypassUnclampedMass = chargeMass;
    const postBypassUnclampedEnergy = chargeEnergy;
    chargeMass = Math.max(chargeMass, MIN_GAS_MASS);
    chargeEnergy = Math.max(
        chargeEnergy,
        chargeMass * CV_AIR * MIN_TEMPERATURE
    );
    state.chargeAirMassCorrectionStep
        += chargeMass - postBypassUnclampedMass;
    state.chargeAirEnergyCorrectionStep
        += chargeEnergy - postBypassUnclampedEnergy;
    chargeTemperature = getChargeTemperature(chargeMass, chargeEnergy);

    const vehicleSpeedMps = Math.max(state.vehicleSpeedKmh, 0) / 3.6;
    const intercoolerConductance = clamp(
        INTERCOOLER_BASE_CONDUCTANCE
        + INTERCOOLER_FLOW_CONDUCTANCE
        * Math.sqrt(Math.max(compressorMassFlow, 0))
        + INTERCOOLER_SPEED_CONDUCTANCE * vehicleSpeedMps,
        0,
        INTERCOOLER_MAX_CONDUCTANCE
    );
    let intercoolerHeatTransferRate = intercoolerConductance
        * (chargeTemperature - TURBO_INLET_TEMPERATURE);

    // Le refroidissement ne peut pas retirer une fraction démesurée de l'énergie
    // interne en un seul pas, même lors d'un état initial mal configuré.
    const maximumCoolingEnergy = Math.max(
        chargeEnergy - chargeMass * CV_AIR * TURBO_INLET_TEMPERATURE,
        0
    ) * 0.08;
    let intercoolerHeatEnergy = intercoolerHeatTransferRate * dt;
    intercoolerHeatEnergy = clamp(
        intercoolerHeatEnergy,
        -chargeEnergy * 0.02,
        maximumCoolingEnergy
    );
    chargeEnergy -= intercoolerHeatEnergy;
    intercoolerHeatTransferRate = intercoolerHeatEnergy / dt;
    state.chargeAirIntercoolerHeatTransferStep
        += intercoolerHeatEnergy;

    const finalUnclampedMass = chargeMass;
    const finalUnclampedEnergy = chargeEnergy;
    chargeMass = Math.max(chargeMass, MIN_GAS_MASS);
    chargeEnergy = Math.max(
        chargeEnergy,
        chargeMass * CV_AIR * MIN_TEMPERATURE
    );
    state.chargeAirMassCorrectionStep
        += chargeMass - finalUnclampedMass;
    state.chargeAirEnergyCorrectionStep
        += chargeEnergy - finalUnclampedEnergy;
    chargeTemperature = getChargeTemperature(chargeMass, chargeEnergy);
    chargePressure = getChargePressure(chargeMass, chargeTemperature);

    // La petite perte de pression de l'intercooler est déjà appliquée à la
    // capacité de livraison du compresseur. Elle ne doit surtout pas être
    // multipliée à chaque pas sur la pression stockée du volume 0D.

    state.chargeAirMass = chargeMass;
    state.chargeAirInternalEnergy = chargeEnergy;
    state.chargeAirPressure = chargePressure;
    state.chargeAirTemperature = chargeTemperature;
    state.chargeAirBoostPressure = chargePressure - TURBO_INLET_PRESSURE;

    state.compressorMassFlow = compressorMassFlow;
    state.compressorPressureRatio = actualPressureRatio;
    state.compressorPressureRatioCapability = pressureRatioCapability;
    state.compressorRawPressureRatioCapability
        = rawPressureRatioCapability;
    state.compressorCorrectedMassFlow
        = compressorMassFlow * correctedFlowFactor;
    state.compressorCorrectedFlowCoefficient = tipSpeed > 1
        ? compressorMassFlow
        / Math.max(inletDensity * COMPRESSOR_INDUCER_AREA * tipSpeed, 1e-9)
        : 0;
    state.compressorChokeFraction = compressorChokeFraction;
    state.compressorTipMach = compressorTipMach;
    state.compressorTipMachLossFraction
        = compressorTipMachLossFraction;
    state.compressorEffectiveLoadingCoefficient
        = effectiveLoadingCoefficient;
    state.compressorAerodynamicChokeMassFlow
        = correctedFlowMaximumMassFlow;
    state.compressorEfficiency = compressorEfficiency;
    state.compressorOutletTemperature = compressorOutletTemperature;
    state.compressorPower = compressorPower;
    state.compressorFluidPower = compressorFluidPower;
    state.compressorAerodynamicLossPower
        = compressorAerodynamicLossPower;
    state.compressorTorque = compressorTorque;
    state.compressorTipSpeed = tipSpeed;
    state.compressorBypassMassFlow = bypassMass / dt;
    state.intercoolerHeatTransferRate = intercoolerHeatTransferRate;
    state.intercoolerEffectiveness = chargeTemperature
    > TURBO_INLET_TEMPERATURE
    && compressorOutletTemperature > TURBO_INLET_TEMPERATURE
        ? clamp(
            (compressorOutletTemperature - chargeTemperature)
            / (
                compressorOutletTemperature
                - TURBO_INLET_TEMPERATURE
            ),
            0,
            1
        )
        : 0;

    return compressorTorque;
}

// Wastegate et dynamique d'arbre

function updateWastegateControl(state, dt) {
    // La capsule de wastegate est référencée à la pression de suralimentation
    // disponible avant le papillon. Elle continue donc de protéger le turbo à
    // charge partielle, même si le collecteur reste en dépression.
    const boostPressure = Math.max(
        state.chargeAirPressure - TURBO_INLET_PRESSURE,
        0
    );

    const mechanicalOpening = clamp(
        (boostPressure - WASTEGATE_CRACK_GAUGE_PRESSURE)
        / Math.max(
            WASTEGATE_FULL_OPEN_GAUGE_PRESSURE
            - WASTEGATE_CRACK_GAUGE_PRESSURE,
            1
        ),
        0,
        1
    );

    const correctedFlow = Math.max(
        Number.isFinite(state.compressorCorrectedMassFlow)
            ? state.compressorCorrectedMassFlow
            : 0,
        0
    );
    const targetFlowFraction = smoothStep01(
        (correctedFlow - BOOST_TARGET_FLOW_RAMP_START)
        / Math.max(
            BOOST_TARGET_FLOW_RAMP_FULL - BOOST_TARGET_FLOW_RAMP_START,
            1e-6
        )
    );
    const effectiveBoostTarget = BOOST_TARGET_LOW_FLOW_GAUGE_PRESSURE
        + (BOOST_TARGET_GAUGE_PRESSURE
            - BOOST_TARGET_LOW_FLOW_GAUGE_PRESSURE)
        * targetFlowFraction;

    const error = boostPressure - effectiveBoostTarget;
    state.effectiveBoostTargetGaugePressure = effectiveBoostTarget;
    if (error > -12000) {
        state.boostControllerIntegral = clamp(
            state.boostControllerIntegral
            + WASTEGATE_CONTROL_KI * error * dt,
            0,
            1
        );
    } else {
        state.boostControllerIntegral = firstOrderResponse(
            state.boostControllerIntegral,
            0,
            dt,
            0.30
        );
    }

    const proportionalOpening = Math.max(error, 0)
        * WASTEGATE_CONTROL_KP;
    const overspeedOpening = clamp(
        (state.turboRPM - TURBO_OVERSPEED_WASTEGATE_START_RPM)
        / Math.max(
            TURBO_MAX_RPM - TURBO_OVERSPEED_WASTEGATE_START_RPM,
            1
        ),
        0,
        1
    );

    const target = clamp(
        Math.max(
            mechanicalOpening,
            proportionalOpening + state.boostControllerIntegral,
            overspeedOpening
        ),
        0,
        1
    );

    state.wastegateTargetPosition = target;
    state.wastegatePosition = firstOrderResponse(
        state.wastegatePosition,
        target,
        dt,
        WASTEGATE_ACTUATOR_TIME_CONSTANT
    );
}

function calculateShaftFrictionTorque(shaftOmega) {
    if (shaftOmega <= 0) {
        return 0;
    }

    const turboRpm = shaftOmega * 60 / (2 * Math.PI);
    const lowSpeedBlend = 1 - Math.exp(
        -turboRpm / TURBO_LOW_SPEED_FRICTION_RPM
    );

    return TURBO_LOW_SPEED_FRICTION * lowSpeedBlend
        + TURBO_BEARING_VISCOUS_FRICTION * shaftOmega
        + TURBO_WINDAGE_FRICTION * shaftOmega * shaftOmega;
}

/**
 * Met à jour le compresseur, la wastegate et la vitesse de l'arbre.
 *
 * Ordre attendu dans Engine.js :
 * 1. admission ;
 * 2. échappement (qui calcule le couple turbine pulsé) ;
 * 3. updateTurbocharger ;
 * 4. thermodynamique fermée et couple moteur.
 *
 * Le retard d'un pas entre pression de charge et débit papillon est de 0.1 ms,
 * donc négligeable par rapport aux constantes de temps pneumatiques du système.
 */
export function updateTurbocharger(state, dt) {
    if (dt <= 0) {
        return;
    }

    initializeChargeAirIfNeeded(state);

    if (!Number.isFinite(state.turboShaftAngularSpeed)) {
        state.turboShaftAngularSpeed = Math.max(
            Number.isFinite(state.turboRPM) ? state.turboRPM : 0,
            0
        ) * 2 * Math.PI / 60;
    }

    const compressorTorque = updateChargeAirAndCompressor(state, dt);
    updateWastegateControl(state, dt);

    const turbineTorque = state.turbineShaftTorques.reduce(
        (sum, value) => sum + Math.max(value, 0),
        0
    );
    const shaftOmega = Math.max(state.turboShaftAngularSpeed, 0);
    const frictionTorque = calculateShaftFrictionTorque(shaftOmega);
    const netTorque = turbineTorque - compressorTorque - frictionTorque;
    const angularAcceleration = netTorque / TURBO_SHAFT_INERTIA;

    let nextOmega = Math.max(
        shaftOmega + angularAcceleration * dt,
        0
    );
    const maximumOmega = TURBO_MAX_RPM * 2 * Math.PI / 60;
    nextOmega = Math.min(nextOmega, maximumOmega);

    state.turboShaftAngularSpeed = nextOmega;
    state.turboRPM = nextOmega * 60 / (2 * Math.PI);
    state.turboAngularAcceleration = angularAcceleration;
    state.turboShaftInertia = TURBO_SHAFT_INERTIA;

    state.turbineTorque = turbineTorque;
    state.turbinePower = turbineTorque * shaftOmega;
    state.turboBearingFrictionTorque = frictionTorque;
    state.turboBearingFrictionPower = frictionTorque * shaftOmega;
    state.turboNetTorque = netTorque;
    state.turboNetPower = netTorque * shaftOmega;
    state.turboOverspeed = state.turboRPM
        >= TURBO_OVERSPEED_WASTEGATE_START_RPM;

    // Boost moteur réellement disponible après papillon, en bar manométriques.
    state.boost = Math.max(
        (state.intakePressure - TURBO_INLET_PRESSURE) / 100000,
        0
    );
}
