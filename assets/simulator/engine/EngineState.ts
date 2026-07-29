// État partagé du modèle moteur 0D.

import type { EngineStateData } from "./EngineStateTypes.js";

// Le merge interface + classe donne au constructeur la forme complète de
// EngineStateData sans dupliquer 350 déclarations de propriétés. Toute nouvelle
// affectation dans ce fichier est donc vérifiée par TypeScript.
export interface EngineState extends EngineStateData {}

export class EngineState implements EngineStateData {
    constructor() {
        // Rotation moteur
        this.rpm = 0;
        this.crankAngle = 0;

        // Tableaux de taille 4 pour les quatre cylindres.
        this.pistonPositions = [0, 0, 0, 0]; // m
        this.cylinderVolumes = [0, 0, 0, 0]; // m³
        this.prevCylinderVolumes = [0, 0, 0, 0]; // m³

        // État thermodynamique des cylindres

        this.cylinderPressures = [101325, 101325, 101325, 101325]; // Pa
        this.cylinderTemperatures = [293, 293, 293, 293]; // K

        // Masse totale gazeuse présente dans chaque cylindre : gaz résiduels + air frais.
        // Elle est initialisée au premier passage d'une soupape d'admission.
        this.cylinderGasMass = [0, 0, 0, 0]; // kg

        // Énergie interne totale U = m * Cv * T de chaque cylindre.
        this.cylinderInternalEnergies = [0, 0, 0, 0]; // J

        // Masse d'air frais admise, intégrée depuis le débit aux soupapes.
        this.trappedAirMass = [0, 0, 0, 0]; // kg

        // Masse de carburant déjà brûlée dans le cycle courant, utilisée pour
        // garder une masse gazeuse cohérente pendant la loi de Wiebe.
        this.burnedFuelMassInCylinder = [0, 0, 0, 0]; // kg

        // Fraction brûlée cumulée de chaque cylindre, utilisée notamment pour CA10/50/90.
        this.cylinderBurnedFraction = [0, 0, 0, 0];

        // Diagnostics du bilan d'énergie fermé

        // Énergies échangées pendant le dernier pas de simulation.
        // Convention :
        // - chaleur paroi positive = énergie perdue par le gaz ;
        // - travail positif = travail fourni par le gaz pendant la détente.
        this.cylinderHeatReleaseStep = [0, 0, 0, 0];       // J
        this.cylinderWallHeatTransferStep = [0, 0, 0, 0];  // J
        this.cylinderBoundaryWorkStep = [0, 0, 0, 0];      // J

        // Puissances instantanées correspondantes, pratiques pour Chart.js.
        this.cylinderHeatReleaseRate = [0, 0, 0, 0];       // W
        this.cylinderWallHeatTransferRate = [0, 0, 0, 0];  // W
        this.cylinderBoundaryWorkRate = [0, 0, 0, 0];      // W

        // Diagnostics de la corrélation thermique.
        this.cylinderHeatTransferCoefficient = [0, 0, 0, 0]; // W/(m².K)
        this.cylinderHeatTransferArea = [0, 0, 0, 0];        // m²
        this.cylinderEffectiveWallTemperature = [0, 0, 0, 0];// K

        // Sommes tous cylindres pour l'affichage global.
        this.totalCylinderHeatReleaseRate = 0;   // W
        this.totalCylinderWallHeatLossRate = 0;  // W
        this.totalCylinderBoundaryWorkRate = 0;  // W

        // Énergie thermique totale perdue vers les parois depuis le lancement.
        this.cumulativeCylinderWallHeatLoss = 0; // J

        // Température des gaz résiduels en fin d'échappement.
        this.residualGasTemp = [400, 400, 400, 400]; // K

        // Collecteur d'admission dynamique

        // Pression initiale uniquement. Elle devient ensuite une sortie du bilan
        // de masse et d'énergie du collecteur.
        this.intakePressure = 35000; // Pa absolus
        this.intakeTemperature = 293; // K

        // Masse et énergie stockées dans le volume 0D du collecteur.
        // Une valeur nulle demande une initialisation automatique au premier pas.
        this.intakeManifoldMass = 0; // kg
        this.intakeManifoldInternalEnergy = 0; // J

        // Diagnostics du papillon et du collecteur.
        this.intakeAirMassFlow = 0;       // kg/s, atmosphère → collecteur
        this.cylinderAirMassFlow = 0;     // kg/s net, collecteur → cylindres
        this.freshCylinderAirMassFlow = 0;// kg/s positif réellement admis
        this.intakeReversionMassFlow = 0; // kg/s retournant vers le collecteur
        this.throttleEffectiveArea = 0;   // m²

        // Distribution d'admission

        this.intakeValveLift = [0, 0, 0, 0];          // m
        this.intakeValveEffectiveArea = [0, 0, 0, 0]; // m² géométriques
        this.intakeValveMassFlow = [0, 0, 0, 0];      // kg/s, signé

        // Permet de détecter l'ouverture d'un nouveau cycle séparément pour
        // chaque instance moteur, sans variable globale dans un module.
        this.wasIntakeValveOpen = [false, false, false, false];

        // Décision d'injection mémorisée au début de l'admission de chaque
        // cylindre. Une coupure carburant qui commence au milieu d'un cycle ne
        // supprime donc pas artificiellement un mélange déjà admis.
        this.cylinderFuelEnabled = [true, true, true, true];

        // Distribution et collecteur d'échappement twin-entry

        // Levée, aire et débit signé des soupapes d'échappement.
        // Convention de débit : positif cylindre → collecteur.
        this.exhaustValveLift = [0, 0, 0, 0];          // m
        this.exhaustValveEffectiveArea = [0, 0, 0, 0]; // m²
        this.exhaustValveMassFlow = [0, 0, 0, 0];      // kg/s, signé
        this.wasExhaustValveOpen = [false, false, false, false];

        // Deux volumes 0D : scroll 0 = cylindres 1+4, scroll 1 = cylindres 2+3.
        // Les impulsions restent séparées jusqu'à la turbine twin-entry.
        this.exhaustManifoldPressures = [101325, 101325]; // Pa absolus
        this.exhaustManifoldTemperatures = [293, 293];   // K — gaz instantané
        this.exhaustManifoldMasses = [0, 0];             // kg
        this.exhaustManifoldInternalEnergies = [0, 0];   // J

        // L'énergie de la paroi métallique est séparée de celle du gaz afin d'éviter qu'une
        // petite masse gazeuse vide fasse sauter toute l'EGT instantanément.
        this.exhaustManifoldWallTemperatures = [293, 293]; // K
        this.exhaustManifoldWallEnergies = [0, 0];         // J
        this.exhaustGasToWallHeatTransferRate = [0, 0];    // W, gaz → métal
        this.exhaustWallAmbientHeatLossRate = [0, 0];      // W, métal → air
        this.exhaustGasWallConductance = [0, 0];           // W/K

        // Une sonde EGT virtuelle par scroll. Elle répond plus vite lorsque le
        // débit est important et tend lentement vers le métal au lever de pied.
        this.egtSensorTemperatures = [293, 293]; // K

        // Débits de sortie par scroll ; une faible fuite inverse égalise la pression moteur arrêté.
        this.exhaustOutletMassFlow = [0, 0];            // kg/s sortant
        this.exhaustOutletReverseLeakMassFlow = [0, 0]; // kg/s entrant, faible
        this.exhaustScrollThroughMassFlow = [0, 0];     // kg/s pour thermique

        // Puissance turbine instantanée pulsée ; la valeur filtrée sert uniquement à l'affichage.
        this.exhaustAvailableTurbinePower = [0, 0];         // W instantanés
        this.filteredExhaustAvailableTurbinePower = [0, 0]; // W monitoring

        // Diagnostics globaux pratiques pour l'interface et Chart.js.
        this.exhaustValveTotalMassFlow = 0; // kg/s, somme signée aux soupapes
        this.exhaustMassFlow = 0;           // kg/s rejeté vers l'atmosphère
        this.exhaustReverseMassFlow = 0;    // kg/s, fuite inverse totale
        this.exhaustBackPressure = 101325;  // Pa absolus, moyenne des scrolls

        // Températures distinctes du gaz, de la paroi et de la sonde EGT.
        this.exhaustGasTemperature = 293;  // K, valeur brute et pulsée
        this.exhaustWallTemperature = 293; // K
        this.egtSensorTemperature = 293;   // K
        this.exhaustTemperature = 293;     // K, alias de la sonde EGT

        this.totalExhaustAvailableTurbinePower = 0; // W instantanés
        this.filteredTotalExhaustAvailableTurbinePower = 0; // W monitoring

        // Combustion et carburant

        this.afr = 14.7; // Rapport air/carburant stœchiométrique de travail
        this.fuelMass = 0; // kg, carburant total brûlé depuis le lancement
        // Masse injectée pendant le dernier pas, enrichissement compris.
        this.fuelMassBurnedStep = 0; // kg injectés pendant le dernier pas
        this.fuelMassChemicallyBurnedStep = 0; // kg ayant libéré leur PCI
        this.instantFuelConsumptionLh = 0; // L/h
        this.avgConsumptionL100km = 0; // L/100 km

        // Turbocompresseur twin-entry et air de suralimentation

        // Arbre commun turbine / compresseur. Le régime est une sortie de
        // l'équation J*domega/dt, jamais une valeur imposée.
        this.turboRPM = 0;                    // tr/min
        this.turboShaftAngularSpeed = 0;      // rad/s
        this.turboAngularAcceleration = 0;    // rad/s²
        this.turboShaftInertia = 0;           // kg.m²
        this.turboNetTorque = 0;              // N.m
        this.turboNetPower = 0;               // W
        this.turboOverspeed = false;

        // Contributions de la turbine. Chaque scroll conserve son impulsion
        // propre avant la somme sur l'arbre commun.
        this.turbineMassFlow = [0, 0];         // kg/s par scroll
        this.wastegateMassFlow = [0, 0];       // kg/s par scroll
        this.turbineShaftTorques = [0, 0];     // N.m par scroll
        this.turbineShaftPowers = [0, 0];      // W par scroll
        this.turbineOutletTemperatures = [293, 293]; // K
        this.turbineTorque = 0;                // N.m total
        this.turbinePower = 0;                 // W total réellement transmis

        // Diagnostics de fonctionnement aérodynamique. Ils servent à vérifier
        // que le gain de puissance haute vitesse vient bien d'une meilleure
        // utilisation de la turbine, et non d'un multiplicateur de couple.
        this.turbineDesignSpeedFraction = 0;    // 0..1, proximité de la zone nominale
        this.turbineEffectivePeakEfficiency = 0;// 0..1
        this.turbineFlowUtilizationReference = 0;// kg/s par scroll
        this.turbineFlowUtilization = [0, 0];   // 0..1 par scroll
        this.turbineAerodynamicEfficiency = [0, 0]; // puissance arbre / puissance gaz

        // Wastegate interne et contrôle de boost.
        this.wastegatePosition = 0;            // 0..1, position filtrée
        this.wastegateTargetPosition = 0;      // 0..1, consigne
        this.effectiveBoostTargetGaugePressure = 0; // Pa, cible calculateur liée au débit corrigé
        this.wastegateEffectiveArea = [0, 0];  // m² par scroll
        this.boostControllerIntegral = 0;      // état du correcteur

        // Volume de charge : sortie compresseur, durites et intercooler avant
        // le papillon. Les valeurs nulles déclenchent l'initialisation physique.
        this.chargeAirPressure = 101325;        // Pa absolus
        this.chargeAirTemperature = 293;       // K
        this.chargeAirMass = 0;                 // kg
        this.chargeAirInternalEnergy = 0;       // J
        this.chargeAirBoostPressure = 0;        // Pa manométriques

        // Compresseur centrifuge.
        this.compressorMassFlow = 0;            // kg/s
        this.compressorPressureRatio = 1;
        this.compressorPressureRatioCapability = 1;
        this.compressorRawPressureRatioCapability = 1;
        this.compressorCorrectedFlowCoefficient = 0;
        this.compressorCorrectedMassFlow = 0; // kg/s aux conditions de référence
        this.compressorChokeFraction = 0;
        this.compressorTipMach = 0;
        this.compressorTipMachLossFraction = 0;
        this.compressorEffectiveLoadingCoefficient = 0;
        this.compressorAerodynamicChokeMassFlow = 0; // kg/s
        this.compressorEfficiency = 0;
        this.compressorOutletTemperature = 293; // K avant intercooler
        this.compressorPower = 0;               // W totaux absorbés sur l'arbre
        this.compressorFluidPower = 0;          // W transmis sous forme d'enthalpie utile à l'air
        this.compressorAerodynamicLossPower = 0; // W dissipés par incidence/chocs/fuites
        this.compressorTorque = 0;              // N.m
        this.compressorTipSpeed = 0;            // m/s

        // Intercooler et soupape de recirculation au lever de pied.
        this.intercoolerHeatTransferRate = 0;    // W retirés à l'air
        this.intercoolerEffectiveness = 0;       // 0..1, diagnostic
        this.compressorBypassValvePosition = 0;  // 0..1
        this.compressorBypassValveTarget = 0;    // 0..1
        this.compressorBypassMassFlow = 0;       // kg/s

        // Boost moteur réellement présent après papillon, en bar relatifs.
        this.boost = 0; // bar manométriques
        this.turboBearingFrictionTorque = 0; // N.m
        this.turboBearingFrictionPower = 0;  // W

        // Banc à rouleaux, transmission et inerties

        // Mode du banc. Les chaînes exactes sont exportées par Dyno/Dyno.js :
        // "inertia", "braked" ou "rpmHold".
        this.dynoMode = "inertia";

        // Commandes du frein.
        this.dynoBrakeCommand = 0;          // 0..1 en mode freiné manuel
        this.dynoTargetRpm = 3000;          // tr/min en mode maintien de régime
        this.dynoRequestedBrakeCommand = 0; // 0..1 après sélection du mode
        this.dynoControllerCommand = 0;     // 0..1, sortie du PI de régime
        this.dynoControllerIntegral = 0;    // état interne du correcteur PI

        // Frein automatique de retour au lever de pied. Il accélère uniquement
        // la décélération du banc en mode inertiel ; il ne change pas la montée
        // en régime ni le couple moteur calculé.
        this.dynoCoastdownBrakeEnabled = true;
        this.dynoCoastdownBrakeCommand = 0;       // 0..1, demande interne
        this.dynoCoastdownBrakeTorqueAtCrank = 0; // N.m, diagnostic

        // Couple du frein mesuré sur les rouleaux puis ramené au vilebrequin.
        this.dynoAppliedBrakeTorque = 0; // N.m, axe des rouleaux
        this.dynoBrakeTorqueAtCrank = 0; // N.m, équivalent vilebrequin
        this.dynoAbsorbedPower = 0;      // W, puissance réellement absorbée

        // Charge routière optionnelle. Désactivée pour un tir inertiel classique.
        this.dynoRoadLoadEnabled = false;
        this.roadLoadForce = 0;  // N
        this.roadLoadTorque = 0; // N.m ramené au vilebrequin

        // Couplage progressif moteur → transmission → rouleaux. À zéro, le
        // démarreur entraîne uniquement le moteur ; à un, tout le banc est lié.
        this.dynoCouplingFactor = 0; // 0..1

        // Décomposition des inerties ramenées au vilebrequin.
        this.engineInertia = 0;              // kg.m²
        this.drivelineEquivalentInertia = 0; // kg.m²
        this.rollerEquivalentInertia = 0;    // kg.m²
        this.totalEquivalentInertia = 0;     // kg.m²

        // Diagnostics des rouleaux et de l'inertie virtuelle.
        this.physicalRollerInertia = 0;         // kg.m² sur l'axe rouleau
        this.virtualRollerInertia = 0;          // kg.m² sur l'axe rouleau
        this.physicalRollerEquivalentMass = 0;  // kg
        this.virtualAddedMass = 0;              // kg
        this.dynoEquivalentVehicleMass = 0;     // kg

        // Cinématique de la chaîne moteur → roues → rouleaux.
        this.overallDriveRatio = 0;
        this.wheelAngularSpeed = 0;  // rad/s
        this.rollerAngularSpeed = 0; // rad/s
        this.vehicleSpeedKmh = 0;    // km/h, vitesse routière équivalente
        this.rollerSurfaceSpeedKmh = 0; // km/h

        // Couple et puissance transmis après les pertes de boîte/pont/pneus.
        this.drivelineLossTorque = 0; // N.m côté vilebrequin
        this.drivelineLossPower = 0;  // W
        this.wheelTorque = 0;         // N.m
        this.wheelPower = 0;          // W
        this.rollerDriveTorque = 0;   // N.m
        this.rollerDrivePower = 0;    // W

        // Accélération réellement produite par la somme des couples.
        this.netCrankshaftTorque = 0;             // N.m
        this.totalAppliedCrankTorque = 0;          // N.m, moteur + démarreur
        this.crankshaftAngularAcceleration = 0;   // rad/s²

        // Distance routière équivalente, utilisée uniquement par Fuel.js pour
        // afficher une consommation moyenne en L/100 km.
        this.distanceTraveled = 0; // m

        // Couple indiqué, pompage et pertes mécaniques

        // Couple produit directement par les pressions cylindre avant toute
        // perte mécanique. Il contient le cycle fermé ET les échanges gazeux.
        this.indicatedTorque = 0; // N.m, instantané
        this.closedCycleIndicatedTorque = 0; // N.m, compression/combustion/détente
        this.pumpingTorque = 0; // N.m, admission + échappement, signé

        // Valeurs lissées réservées à l'affichage. La dynamique du RPM continue
        // d'utiliser les couples instantanés, sans filtrage artificiel.
        this.smoothedIndicatedTorque = 0; // N.m
        this.smoothedClosedCycleTorque = 0; // N.m
        this.smoothedPumpingTorque = 0; // N.m
        this.smoothedBrakeTorque = 0; // N.m

        // Décomposition du modèle de frottement FMEP.
        this.meanPistonSpeed = 0; // m/s
        this.averageCyclePeakGaugePressure = 0; // Pa
        this.frictionMeanEffectivePressure = 0; // Pa
        this.baseFrictionTorque = 0; // N.m
        this.speedFrictionTorque = 0; // N.m
        this.loadFrictionTorque = 0; // N.m
        this.mechanicalFrictionTorque = 0; // N.m, hors accessoires
        this.accessoryTorque = 0; // N.m
        this.mechanicalLossTorque = 0; // N.m, frottements + accessoires
        this.mechanicalLossPower = 0; // W

        // Diagnostic du pompage. PMEP est positif lorsqu'il représente une perte.
        this.pumpingPower = 0; // W, signé
        this.pumpingMeanEffectivePressure = 0; // Pa

        // Bilan de puissance directement exploitable dans le monitoring.
        this.closedCycleIndicatedPower = 0; // W avant pompage et frottements
        this.indicatedPower = 0;            // W après pompage, avant frottements
        this.pumpingLossPower = 0;          // W positif lorsque le pompage dissipe

        // Suivi de la pression pic du dernier cycle, utilisé uniquement par le
        // terme de frottement dépendant de la charge.
        this.currentCyclePeakCylinderPressure = [101325, 101325, 101325, 101325]; // Pa
        this.lastCyclePeakCylinderPressure = [101325, 101325, 101325, 101325]; // Pa
        this.lossModelPreviousCylinderAngles = [0, 0, 0, 0]; // rad

        // Coupure d'injection en lever de pied et frein moteur résultant.
        this.fuelCutActive = false;
        this.engineBrakingActive = false;
        this.engineBrakingTorque = 0; // N.m, valeur positive affichant l'intensité
        this.engineBrakingPower = 0; // W, valeur positive dissipée

        // Performances à l'arbre après pertes mécaniques, avant charge routière.
        this.torque = 0; // N.m
        this.power = 0;  // W

        // Température d'échappement de diagnostic
        this.egt = 20;

        // État moteur, démarreur, ralenti et rupteur

        // Le moteur démarre réellement à l'arrêt. Les chaînes exactes sont
        // exportées par EngineControl/EngineControl.js.
        this.engineOperatingState = "off";
        this.engineRunning = false;
        this.ignitionOn = false;
        this.combustionEnabled = false;

        // Démarreur mécanique. Le couple est ajouté dans Dyno.js avant
        // l'intégration du régime ; il ne fixe jamais directement le RPM.
        this.starterActive = false;
        this.starterTorqueAtCrank = 0; // N.m
        this.starterPower = 0;         // W
        this.starterElapsedTime = 0;   // s
        this.starterCrankRevolutions = 0; // tours vilebrequin depuis la demande

        // Régulation d'air de ralenti. La commande 0..1 devient une aire
        // physique supplémentaire dans IntakeManifold.js.
        this.idleControlEnabled = false;
        this.idleAirControlCommand = 0; // 0..1, position filtrée de l'actuateur
        this.idleAirControlTarget = 0;  // 0..1, consigne avant dynamique
        this.idleControlIntegral = 0;   // état interne du PI
        this.idleBypassEffectiveArea = 0; // m²

        // Détection du fonctionnement autonome et du calage.
        this.runningElapsedTime = 0;
        this.stallDetectionTimer = 0;

        // Rupteur à hystérésis. Il coupe le carburant/la combustion, mais ne
        // ferme pas artificiellement le papillon mécanique.
        this.revLimiterActive = false;
        this.revLimiterEventCount = 0;

        // Avance commandée par la gestion moteur : réduite au lancement, puis
        // valeur nominale une fois le moteur autonome.
        this.ignitionTimingDeg = 15; // degrés avant le PMH d'allumage
        this.highSpeedIgnitionAdvanceDeg = 0;
        this.combustionPhasingIgnitionLimitDeg = 0;
        this.ignitionPhasingLimited = false; // correction analytique haute vitesse
        this.combustionDurationDeg = 50;       // durée courante de la loi de Wiebe
        this.combustionCA50DegAfterTdc = 0;    // centre de combustion, ° après PMH
        this.combustionCA50TargetDegAfterTdc = 0; // cible contrôleur, ° après PMH

        // Coefficients de décharge réellement utilisés au pas courant.
        this.intakeValveDischargeCoefficient = 0.68;
        this.exhaustValveDischargeCoefficient = 0.70;

        // Diagnostics de conservation masse / énergie

        // Configuration et capture privée du diagnostic. Ces champs étaient
        // auparavant créés à la volée par Engine/ConservationDiagnostics.
        this.conservationDiagnosticsStride = 1;
        this._conservationCaptureActive = false;
        this._conservationInitialCylinderMass = [0, 0, 0, 0];
        this._conservationInitialCylinderEnergy = [0, 0, 0, 0];
        this._conservationInitialIntakeMass = 0;
        this._conservationInitialIntakeEnergy = 0;
        this._conservationInitialChargeMass = 0;
        this._conservationInitialChargeEnergy = 0;
        this._conservationInitialExhaustMass = [0, 0];
        this._conservationInitialExhaustEnergy = [0, 0];
        this._conservationInitialExhaustWallEnergy = [0, 0];
        this._conservationInitialTotalMass = 0;
        this._conservationInitialTotalEnergy = 0;

        // Termes exacts accumulés pendant le sous-pas. Ils décrivent les flux
        // réellement appliqués par les modules, avant calcul des résidus.
        this.cylinderFuelMassAddedStep = [0, 0, 0, 0]; // kg
        this.cylinderIntakeEnthalpyTransferStep = [0, 0, 0, 0]; // J, signé vers cylindre
        this.cylinderExhaustEnthalpyTransferStep = [0, 0, 0, 0]; // J, signé hors cylindre
        this.cylinderOpenBoundaryWorkStep = [0, 0, 0, 0]; // J, positif fourni par le gaz
        this.cylinderOpenWallHeatTransferStep = [0, 0, 0, 0]; // J, positif gaz → paroi

        // Corrections de modèle/numériques explicitement séparées du résidu :
        // initialisation d'un volume, garde de masse minimale ou clamp d'énergie.
        this.cylinderMassCorrectionStep = [0, 0, 0, 0]; // kg
        this.cylinderEnergyCorrectionStep = [0, 0, 0, 0]; // J

        this.intakeThrottleMassTransferStep = 0; // kg, signé vers le collecteur
        this.intakeThrottleEnthalpyTransferStep = 0; // J, signé vers le collecteur
        this.intakeValveEnthalpyTransferStep = [0, 0, 0, 0]; // J, collecteur → cylindre
        this.intakeManifoldWallHeatTransferStep = 0; // J, positif paroi → gaz
        this.intakeManifoldMassCorrectionStep = 0; // kg
        this.intakeManifoldEnergyCorrectionStep = 0; // J

        this.chargeAirCompressorMassStep = 0; // kg entrant depuis le compresseur
        this.chargeAirCompressorEnthalpyStep = 0; // J entrant
        this.chargeAirThrottleMassTransferStep = 0; // kg, positif vers admission
        this.chargeAirThrottleEnthalpyTransferStep = 0; // J, positif vers admission
        this.chargeAirBypassMassStep = 0; // kg sortant vers l'entrée turbo
        this.chargeAirBypassEnthalpyStep = 0; // J sortant
        this.chargeAirIntercoolerHeatTransferStep = 0; // J retirés du gaz
        this.chargeAirMassCorrectionStep = 0; // kg
        this.chargeAirEnergyCorrectionStep = 0; // J

        this.exhaustScrollByCylinder = [0, 1, 1, 0];
        this.exhaustScrollValveEnthalpyTransferStep = [0, 0]; // J, cylindre → scroll
        this.exhaustScrollOutletMassStep = [0, 0]; // kg turbine + wastegate
        this.exhaustScrollReverseLeakMassStep = [0, 0]; // kg atmosphère → scroll
        this.exhaustScrollOutletEnthalpyStep = [0, 0]; // J sortants
        this.exhaustScrollReverseLeakEnthalpyStep = [0, 0]; // J entrants
        this.exhaustScrollGasToWallHeatStep = [0, 0]; // J, gaz → métal
        this.exhaustWallAmbientHeatLossStep = [0, 0]; // J, métal → ambiance
        this.exhaustScrollMassCorrectionStep = [0, 0]; // kg
        this.exhaustScrollEnergyCorrectionStep = [0, 0]; // J
        this.exhaustWallEnergyCorrectionStep = [0, 0]; // J

        // Résidus des quatre cylindres. `Raw` inclut les corrections numériques ;
        // le résidu principal les retranche et mesure uniquement la fermeture
        // des équations déclarées.
        this.cylinderMassRawResidualStep = [0, 0, 0, 0]; // kg
        this.cylinderMassResidualStep = [0, 0, 0, 0]; // kg
        this.cylinderMassResidualRate = [0, 0, 0, 0]; // kg/s
        this.cylinderMassResidualPercent = [0, 0, 0, 0]; // % normalisé
        this.cylinderEnergyRawResidualStep = [0, 0, 0, 0]; // J
        this.cylinderEnergyResidualStep = [0, 0, 0, 0]; // J
        this.cylinderEnergyResidualRate = [0, 0, 0, 0]; // W
        this.cylinderEnergyResidualPercent = [0, 0, 0, 0]; // % normalisé

        this.intakeManifoldMassRawResidualStep = 0; // kg
        this.intakeManifoldMassResidualStep = 0; // kg
        this.intakeManifoldMassResidualRate = 0; // kg/s
        this.intakeManifoldMassResidualPercent = 0; // %
        this.intakeManifoldEnergyRawResidualStep = 0; // J
        this.intakeManifoldEnergyResidualStep = 0; // J
        this.intakeManifoldEnergyResidualRate = 0; // W
        this.intakeManifoldEnergyResidualPercent = 0; // %

        this.chargeAirMassRawResidualStep = 0; // kg
        this.chargeAirMassResidualStep = 0; // kg
        this.chargeAirMassResidualRate = 0; // kg/s
        this.chargeAirMassResidualPercent = 0; // %
        this.chargeAirEnergyRawResidualStep = 0; // J
        this.chargeAirEnergyResidualStep = 0; // J
        this.chargeAirEnergyResidualRate = 0; // W
        this.chargeAirEnergyResidualPercent = 0; // %

        this.exhaustScrollMassRawResidualStep = [0, 0]; // kg
        this.exhaustScrollMassResidualStep = [0, 0]; // kg
        this.exhaustScrollMassResidualRate = [0, 0]; // kg/s
        this.exhaustScrollMassResidualPercent = [0, 0]; // %
        this.exhaustScrollEnergyRawResidualStep = [0, 0]; // J
        this.exhaustScrollEnergyResidualStep = [0, 0]; // J
        this.exhaustScrollEnergyResidualRate = [0, 0]; // W
        this.exhaustScrollEnergyResidualPercent = [0, 0]; // %

        this.exhaustWallEnergyRawResidualStep = [0, 0]; // J
        this.exhaustWallEnergyResidualStep = [0, 0]; // J
        this.exhaustWallEnergyResidualRate = [0, 0]; // W
        this.exhaustWallEnergyResidualPercent = [0, 0]; // %

        // Bilan global de tous les stocks gazeux + métal d'échappement.
        this.globalMassRawResidualStep = 0; // kg
        this.globalMassRawResidualRate = 0; // kg/s
        this.globalMassCorrectionStep = 0; // kg
        this.globalMassCorrectionRate = 0; // kg/s
        this.globalMassResidualStep = 0; // kg
        this.globalMassResidualRate = 0; // kg/s
        this.globalMassResidualPercent = 0; // %
        this.globalEnergyRawResidualStep = 0; // J
        this.globalEnergyRawResidualRate = 0; // W
        this.globalEnergyCorrectionStep = 0; // J
        this.globalEnergyCorrectionRate = 0; // W
        this.globalEnergyResidualStep = 0; // J
        this.globalEnergyResidualRate = 0; // W
        this.globalEnergyResidualPercent = 0; // %

        // Vérification spécifique de l'interface charge pipe ↔ collecteur.
        this.throttleInterfaceMassMismatchStep = 0; // kg
        this.throttleInterfaceEnergyMismatchStep = 0; // J
        this.throttleInterfaceMassMismatchRate = 0; // kg/s
        this.throttleInterfaceEnergyMismatchRate = 0; // W

        this.maximumMassResidualPercent = 0; // pire volume du dernier sous-pas
        this.maximumEnergyResidualPercent = 0;
        this.cumulativeAbsoluteMassResidual = 0; // kg
        this.cumulativeAbsoluteEnergyResidual = 0; // J
        this.conservationSubstepCount = 0;

        // Solveur adaptatif piloté par angle vilebrequin

        // Ces valeurs sont renseignées par Engine.js et servent uniquement au
        // monitoring numérique. Elles n'interviennent jamais dans la physique.
        this.angleSolverResolutionScale = 1;
        this.angleSolverBaseStepDeg = 0;
        this.angleSolverCombustionStepDeg = 0;
        this.angleSolverEventStepDeg = 0;
        this.angleSolverMaximumTimeStepUs = 0;

        this.angleSolverSubstepsLastUpdate = 0;
        this.angleSolverTotalSubsteps = 0;
        this.angleSolverMinimumTimeStepUs = 0;
        this.angleSolverMaximumAngleAdvanceDeg = 0;
        this.angleSolverMinimumRequestedStepDeg = 0;
        this.angleSolverSaturated = false;
        this.angleSolverUnintegratedTime = 0;
        this.angleSolverPendingTimeUs = 0;

        // Moyennes temporelles exactes de la dernière tranche externe.
        this.lastUpdateAverageTorque = 0;
        this.lastUpdateAveragePower = 0;
        this.lastUpdateAverageTurbinePower = 0;

        // Acquisition et réduction de télémétrie

        // Ces diagnostics décrivent uniquement l'enregistreur 60 Hz. Ils ne
        // participent jamais aux équations du moteur.
        this.telemetryInputRateHz = 0;
        this.telemetryOutputRateHz = 0;
        this.telemetryHistorySeconds = 0;
        this.telemetryBufferCapacity = 0;
        this.telemetryBufferedSamples = 0;
        this.telemetrySamplesProduced = 0;
        this.telemetryLastSampleTime = 0;
        this.telemetryLastSampleSequence = -1;

        // Recorder haute résolution d'un cycle 720°

        // Ces valeurs ne participent jamais aux équations. Elles décrivent le
        // dernier cycle complet publié par CycleRecorder.js.
        this.cycleRecorderEnabled = true;
        this.cycleRecorderAngularStepDeg = 0;
        this.cycleRecorderCaptureIntervalMs = 0;
        this.cycleRecorderCylinderIndex = 0;
        this.cycleRecorderBufferedCycles = 0;
        this.cycleRecorderCompletedCycles = 0;
        this.cycleRecorderSamplesCurrentCycle = 0;
        this.cycleRecorderLatestCycleRpm = 0;
        this.cycleRecorderLatestCycleDurationMs = 0;
        this.cycleRecorderLatestSampleCount = 0;
        this.cycleRecorderLatestPeakPressureBar = 0;
        this.cycleRecorderLatestPeakPressureAngleDeg = 0;
        this.cycleRecorderLatestHeatReleasedJ = 0;
        this.cycleRecorderLatestWallHeatLossJ = 0;
        this.cycleRecorderLatestClosedWorkJ = 0;
        this.cycleRecorderLatestPumpingWorkJ = 0;
        this.cycleRecorderLatestNetIndicatedWorkJ = 0;

        // Pédale utilisateur
        this.throttle = 0; // 0 = fermé, 1 = grand ouvert
    }
}

export default EngineState;