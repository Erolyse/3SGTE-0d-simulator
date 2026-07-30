import Engine from "../engine/Engine.js";
import {
    STROKE, SWEPT_VOLUME, CLEARANCE_VOLUME, CYLINDER_OFFSETS,
    getPistonDisplacementFromTDC, getCylinderVolume, getTorqueArm
} from "../Geometry/Geometry.js";
import {
    INTAKE_VALVE_OPEN_DEG, INTAKE_VALVE_CLOSE_DEG, isIntakeValveOpen,
    getIntakeValveLift, getIntakeValveFlowArea, getIntakeValveDischargeCoefficient
} from "../Valvetrain/IntakeValves.js";
import {
    EXHAUST_VALVE_OPEN_DEG, EXHAUST_VALVE_CLOSE_DEG, isExhaustValveOpen,
    getExhaustValveLift, getExhaustValveFlowArea, getExhaustValveDischargeCoefficient
} from "../Valvetrain/ExhaustValves.js";
import { calculateTurboExhaustBoundary } from "../Turbo/Turbocharger.js";
import {
    R_AIR, GAMMA_AIR, CV_AIR, CP_AIR, GAMMA_CYLINDER_GAS,
    CV_CYLINDER_GAS, CP_CYLINDER_GAS,
    calculateOneWayCompressibleMassFlow, calculateBidirectionalCompressibleMassFlow
} from "../Physics/CompressibleFlow.js";
import {
    getCombustionDurationDegForRpm, getIgnitionAdvanceForTargetCA50
} from "../Thermodynamics/Thermodynamics.js";
import { calculateMechanicalLosses, updateOverrunFuelCut } from "../Crankshaft/MechanicalLosses.js";
import {
    calculateCrankAngleSubstep, BASE_CRANK_ANGLE_STEP_DEG, MAX_INTERNAL_TIME_STEP
} from "../Numerics/CrankAngleIntegrator.js";
import { interpolateMonotonicThresholdCrossing } from "../Cycle/CycleRecorder.js";
import { CYCLE_VALIDATION_STATUS } from "./cycle-validation.js";
import { setText, formatNumber, escapeHtml } from "./utils.js";

export function createUnitTestsModule({ liveData, ui }: any) {
    function formatUnitValue(value: any, decimals = 6) {
        if (!Number.isFinite(value)) return "non fini";
        const absoluteValue = Math.abs(value);

        if (absoluteValue !== 0
            && (absoluteValue < 1e-4 || absoluteValue >= 1e6)) {
            return value.toExponential(3);
        }

        return value.toLocaleString("fr-FR", {
            minimumFractionDigits: 0,
            maximumFractionDigits: decimals
        });
    }

    function runSubmoduleUnitTests() {
        const rows: any = [];
        const startedAt = performance.now();
        const radians = (degrees: any) => degrees * Math.PI / 180;

        const record = (group: any, name: any, criterion: any, callback: any) => {
            try {
                const result = callback() ?? {};
                if (result.pass === false) {
                    throw new Error(result.detail || "Assertion non respectée.");
                }

                rows.push({
                    group,
                    name,
                    criterion,
                    status: "pass",
                    measured: result.measured ?? "Conforme",
                    detail: result.detail ?? ""
                });
            } catch (error) {
                rows.push({
                    group,
                    name,
                    criterion,
                    status: "fail",
                    measured: "Échec",
                    detail: error instanceof Error
                        ? error.message
                        : String(error)
                });
            }
        };

        const near = (
            actual: any,
            expected: any,
            tolerance: any,
            measured: any,
            detail = ""
        ) => ({
            pass: Number.isFinite(actual)
                && Math.abs(actual - expected) <= tolerance,
            measured,
            detail: detail || (
                `attendu ${formatUnitValue(expected)} ± `
                + formatUnitValue(tolerance)
            )
        });

        const scanMaximum = (
            startDeg: any,
            endDeg: any,
            stepDeg: any,
            evaluator: any
        ) => {
            let maximumValue = Number.NEGATIVE_INFINITY;
            let maximumAngleDeg = startDeg;
            let minimumValue = Number.POSITIVE_INFINITY;

            for (
                let angleDeg = startDeg;
                angleDeg <= endDeg + stepDeg * 0.25;
                angleDeg += stepDeg
            ) {
                const value = evaluator(radians(angleDeg));
                minimumValue = Math.min(minimumValue, value);

                if (value > maximumValue) {
                    maximumValue = value;
                    maximumAngleDeg = angleDeg;
                }
            }

            return {
                maximumValue,
                maximumAngleDeg,
                minimumValue
            };
        };

        record("Géométrie", "Volume au PMH", "V(0°) = volume mort", () => {
            const actual = getCylinderVolume(0);
            return near(
                actual,
                CLEARANCE_VOLUME,
                1e-14,
                `${formatUnitValue(actual * 1e6, 6)} cm³`
            );
        });

        record("Géométrie", "Volume au PMB", "V(180°) = Vc + Vd", () => {
            const actual = getCylinderVolume(Math.PI);
            const expected = CLEARANCE_VOLUME + SWEPT_VOLUME;
            return near(
                actual,
                expected,
                1e-14,
                `${formatUnitValue(actual * 1e6, 6)} cm³`
            );
        });

        record(
            "Géométrie",
            "Périodicité du volume",
            "V(0°) = V(360°) = V(720°)",
            () => {
                const values = [
                    getCylinderVolume(0),
                    getCylinderVolume(2 * Math.PI),
                    getCylinderVolume(4 * Math.PI)
                ];
                const span = Math.max(...values) - Math.min(...values);

                return {
                    pass: span <= 1e-14,
                    measured: `écart ${formatUnitValue(span, 3)} m³`,
                    detail: "Fermeture géométrique sur deux tours."
                };
            }
        );

        record(
            "Géométrie",
            "Course du piston",
            "x(PMH) = 0 et x(PMB) = course",
            () => {
                const tdc = getPistonDisplacementFromTDC(0);
                const bdc = getPistonDisplacementFromTDC(Math.PI);
                const error = Math.max(
                    Math.abs(tdc),
                    Math.abs(bdc - STROKE)
                );

                return {
                    pass: error <= 1e-14,
                    measured:
                        `PMH ${formatUnitValue(tdc * 1e3, 6)} mm · `
                        + `PMB ${formatUnitValue(bdc * 1e3, 6)} mm`,
                    detail: `Course attendue ${formatUnitValue(STROKE * 1e3, 3)} mm.`
                };
            }
        );

        record(
            "Géométrie",
            "Bras de couple aux points morts",
            "dx/dθ ≈ 0 au PMH et au PMB",
            () => {
                const maximum = Math.max(
                    Math.abs(getTorqueArm(0)),
                    Math.abs(getTorqueArm(Math.PI)),
                    Math.abs(getTorqueArm(2 * Math.PI))
                );

                return {
                    pass: maximum <= 1e-12,
                    measured: `${formatUnitValue(maximum, 3)} m/rad`,
                    detail: "Aucun bras de levier aux points morts."
                };
            }
        );

        record(
            "Géométrie",
            "Signe du bras de couple",
            "positif en descente, négatif en remontée",
            () => {
                const descending = getTorqueArm(Math.PI / 2);
                const rising = getTorqueArm(3 * Math.PI / 2);

                return {
                    pass: descending > 0 && rising < 0,
                    measured:
                        `${formatUnitValue(descending, 6)} / `
                        + `${formatUnitValue(rising, 6)} m/rad`,
                    detail: "Convention compatible avec les travaux virtuels."
                };
            }
        );

        record(
            "Géométrie",
            "Déphasages cylindre",
            "4 phases uniques sur 720°",
            () => {
                const phases = CYLINDER_OFFSETS.map(angle =>
                    Math.round(
                        (((angle % (4 * Math.PI)) + 4 * Math.PI)
                            % (4 * Math.PI)) * 180 / Math.PI
                    )
                );

                return {
                    pass: phases.length === 4
                        && new Set(phases).size === 4,
                    measured: phases.map(value => `${value}°`).join(" · "),
                    detail: "Déphasages correspondant à l’ordre 1–3–4–2."
                };
            }
        );

        record("Gaz parfait", "Identité Cp − Cv", "Cp − Cv = R", () => {
            const actual = CP_AIR - CV_AIR;
            return near(
                actual,
                R_AIR,
                1e-10,
                `${formatUnitValue(actual, 6)} J/(kg·K)`
            );
        });

        record("Gaz parfait", "Rapport Cp / Cv", "Cp / Cv = γ air", () => {
            const actual = CP_AIR / CV_AIR;
            return near(
                actual,
                GAMMA_AIR,
                1e-12,
                formatUnitValue(actual, 9)
            );
        });

        record(
            "Gaz parfait",
            "Propriétés des gaz cylindre",
            "Cp − Cv = R et Cp / Cv = γ gaz",
            () => {
                const gasConstant = CP_CYLINDER_GAS - CV_CYLINDER_GAS;
                const gamma = CP_CYLINDER_GAS / CV_CYLINDER_GAS;

                return {
                    pass: Math.abs(gasConstant - R_AIR) <= 1e-10
                        && Math.abs(gamma - GAMMA_CYLINDER_GAS) <= 1e-12,
                    measured:
                        `R ${formatUnitValue(gasConstant, 6)} · `
                        + `γ ${formatUnitValue(gamma, 6)}`,
                    detail: "Propriétés thermodynamiques auto-cohérentes."
                };
            }
        );

        const flowArea = 1e-4;
        const cd = 0.8;

        record(
            "Écoulement",
            "Pressions égales",
            "ΔP = 0 → débit nul",
            () => {
                const flow = calculateOneWayCompressibleMassFlow(
                    101325,
                    293,
                    101325,
                    flowArea,
                    cd
                );

                return {
                    pass: flow === 0,
                    measured: `${formatUnitValue(flow, 6)} kg/s`,
                    detail: "Aucun débit sans gradient de pression."
                };
            }
        );

        record("Écoulement", "Section fermée", "A = 0 → débit nul", () => {
            const flow = calculateOneWayCompressibleMassFlow(
                150000,
                300,
                101325,
                0,
                cd
            );

            return {
                pass: flow === 0,
                measured: `${formatUnitValue(flow, 6)} kg/s`,
                detail: "Orifice fermé."
            };
        });

        record(
            "Écoulement",
            "Sens direct",
            "Pamont > Paval → débit positif",
            () => {
                const flow = calculateOneWayCompressibleMassFlow(
                    150000,
                    300,
                    101325,
                    flowArea,
                    cd
                );

                return {
                    pass: Number.isFinite(flow) && flow > 0,
                    measured: `${formatUnitValue(flow, 6)} kg/s`,
                    detail: "Débit fini orienté de l’amont vers l’aval."
                };
            }
        );

        record(
            "Écoulement",
            "Inversion du débit",
            "permutation A/B → signe opposé",
            () => {
                const forward = calculateBidirectionalCompressibleMassFlow(
                    150000,
                    300,
                    101325,
                    300,
                    flowArea,
                    cd
                );
                const reverse = calculateBidirectionalCompressibleMassFlow(
                    101325,
                    300,
                    150000,
                    300,
                    flowArea,
                    cd
                );
                const closure = Math.abs(forward + reverse);

                return {
                    pass: forward > 0
                        && reverse < 0
                        && closure <= Math.max(Math.abs(forward), 1) * 1e-12,
                    measured:
                        `${formatUnitValue(forward, 6)} / `
                        + `${formatUnitValue(reverse, 6)} kg/s`,
                    detail: "Antisymétrie avec températures identiques."
                };
            }
        );

        record(
            "Écoulement",
            "Proportionnalité à la section",
            "2A → 2ṁ",
            () => {
                const flowA = calculateOneWayCompressibleMassFlow(
                    150000,
                    300,
                    101325,
                    flowArea,
                    cd
                );
                const flow2A = calculateOneWayCompressibleMassFlow(
                    150000,
                    300,
                    101325,
                    2 * flowArea,
                    cd
                );
                const ratio = flow2A / flowA;

                return {
                    pass: Math.abs(ratio - 2) <= 1e-12,
                    measured: `rapport ${formatUnitValue(ratio, 9)}`,
                    detail: "Loi d’orifice linéaire avec l’aire."
                };
            }
        );

        record(
            "Écoulement",
            "Plateau d’étranglement",
            "sous le rapport critique, ṁ devient indépendant de Paval",
            () => {
                const flowA = calculateOneWayCompressibleMassFlow(
                    200000,
                    300,
                    40000,
                    flowArea,
                    cd
                );
                const flowB = calculateOneWayCompressibleMassFlow(
                    200000,
                    300,
                    20000,
                    flowArea,
                    cd
                );
                const relative = Math.abs(flowA - flowB)
                    / Math.max(Math.abs(flowA), 1e-15);

                return {
                    pass: relative <= 1e-12,
                    measured:
                        `écart ${formatUnitValue(relative * 100, 9)} %`,
                    detail: "Débit étranglé correctement plafonné."
                };
            }
        );

        record(
            "Écoulement",
            "Sensibilité subsonique",
            "une chute de pression plus forte augmente le débit",
            () => {
                const smallDrop = calculateOneWayCompressibleMassFlow(
                    120000,
                    300,
                    115000,
                    flowArea,
                    cd
                );
                const largeDrop = calculateOneWayCompressibleMassFlow(
                    120000,
                    300,
                    100000,
                    flowArea,
                    cd
                );

                return {
                    pass: smallDrop > 0 && largeDrop > smallDrop,
                    measured:
                        `${formatUnitValue(smallDrop, 6)} → `
                        + `${formatUnitValue(largeDrop, 6)} kg/s`,
                    detail: "Régime subsonique monotone."
                };
            }
        );

        record(
            "Admission",
            "Fenêtre d’ouverture",
            "fermée hors IVO–IVC",
            () => {
                const outside = radians(INTAKE_VALVE_CLOSE_DEG + 20);
                const inside = radians(
                    (INTAKE_VALVE_OPEN_DEG + INTAKE_VALVE_CLOSE_DEG) / 2
                );

                return {
                    pass: !isIntakeValveOpen(outside)
                        && isIntakeValveOpen(inside),
                    measured:
                        `IVO ${INTAKE_VALVE_OPEN_DEG}° · `
                        + `IVC ${INTAKE_VALVE_CLOSE_DEG}°`,
                    detail: "État logique de la soupape."
                };
            }
        );

        record(
            "Admission",
            "Levée aux événements",
            "levée nulle à IVO et IVC",
            () => {
                const maximum = Math.max(
                    Math.abs(getIntakeValveLift(radians(INTAKE_VALVE_OPEN_DEG))),
                    Math.abs(getIntakeValveLift(radians(INTAKE_VALVE_CLOSE_DEG)))
                );

                return {
                    pass: maximum <= 1e-12,
                    measured: `${formatUnitValue(maximum * 1e3, 9)} mm`,
                    detail: "Profil continu aux extrémités."
                };
            }
        );

        record(
            "Admission",
            "Sommet de levée",
            "maximum positif proche de 110°",
            () => {
                const scan = scanMaximum(
                    INTAKE_VALVE_OPEN_DEG,
                    INTAKE_VALVE_CLOSE_DEG,
                    0.25,
                    getIntakeValveLift
                );

                return {
                    pass: scan.maximumValue > 0
                        && scan.minimumValue >= -1e-14
                        && Math.abs(scan.maximumAngleDeg - 110) <= 0.5,
                    measured:
                        `${formatUnitValue(scan.maximumValue * 1e3, 4)} mm `
                        + `à ${formatUnitValue(scan.maximumAngleDeg, 2)}°`,
                    detail: "Profil asymétrique de la calibration actuelle."
                };
            }
        );

        record(
            "Admission",
            "Aire de passage",
            "aire nulle fermée, positive ouverte",
            () => {
                const closed = getIntakeValveFlowArea(
                    radians(INTAKE_VALVE_CLOSE_DEG + 20)
                );
                const open = getIntakeValveFlowArea(radians(110));

                return {
                    pass: closed === 0
                        && Number.isFinite(open)
                        && open > 0,
                    measured:
                        `${formatUnitValue(closed * 1e6, 3)} / `
                        + `${formatUnitValue(open * 1e6, 3)} mm²`,
                    detail: "Aire géométrique bornée et non négative."
                };
            }
        );

        record(
            "Admission",
            "Coefficient de décharge",
            "0 < Cd < 1 et Cd augmente avec la turbulence",
            () => {
                const angle = radians(110);
                const low = getIntakeValveDischargeCoefficient(1000, angle);
                const high = getIntakeValveDischargeCoefficient(6500, angle);

                return {
                    pass: low > 0 && high < 1 && high >= low,
                    measured:
                        `${formatUnitValue(low, 4)} → `
                        + `${formatUnitValue(high, 4)}`,
                    detail: "Transition Reynolds continue."
                };
            }
        );

        record(
            "Échappement",
            "Fenêtre d’ouverture",
            "fermée avant EVO et à EVC",
            () => {
                const before = isExhaustValveOpen(
                    radians(EXHAUST_VALVE_OPEN_DEG - 20)
                );
                const inside = isExhaustValveOpen(radians(
                    (EXHAUST_VALVE_OPEN_DEG + EXHAUST_VALVE_CLOSE_DEG) / 2
                ));
                const close = isExhaustValveOpen(
                    radians(EXHAUST_VALVE_CLOSE_DEG)
                );

                return {
                    pass: !before && inside && !close,
                    measured:
                        `EVO ${EXHAUST_VALVE_OPEN_DEG}° · `
                        + `EVC ${EXHAUST_VALVE_CLOSE_DEG}°`,
                    detail: "État logique de la soupape."
                };
            }
        );

        record(
            "Échappement",
            "Levée aux événements",
            "levée nulle à EVO et EVC",
            () => {
                const maximum = Math.max(
                    Math.abs(getExhaustValveLift(radians(EXHAUST_VALVE_OPEN_DEG))),
                    Math.abs(getExhaustValveLift(radians(EXHAUST_VALVE_CLOSE_DEG)))
                );

                return {
                    pass: maximum <= 1e-12,
                    measured: `${formatUnitValue(maximum * 1e3, 9)} mm`,
                    detail: "Profil continu aux extrémités."
                };
            }
        );

        record(
            "Échappement",
            "Sommet de levée",
            "maximum positif au milieu de la durée",
            () => {
                const expected = (
                    EXHAUST_VALVE_OPEN_DEG + EXHAUST_VALVE_CLOSE_DEG
                ) / 2;
                const scan = scanMaximum(
                    EXHAUST_VALVE_OPEN_DEG,
                    EXHAUST_VALVE_CLOSE_DEG,
                    0.25,
                    getExhaustValveLift
                );

                return {
                    pass: scan.maximumValue > 0
                        && scan.minimumValue >= -1e-14
                        && Math.abs(scan.maximumAngleDeg - expected) <= 0.5,
                    measured:
                        `${formatUnitValue(scan.maximumValue * 1e3, 4)} mm `
                        + `à ${formatUnitValue(scan.maximumAngleDeg, 2)}°`,
                    detail: "Profil sin² symétrique."
                };
            }
        );

        record(
            "Échappement",
            "Aire de passage",
            "aire nulle fermée, positive ouverte",
            () => {
                const closed = getExhaustValveFlowArea(
                    radians(EXHAUST_VALVE_OPEN_DEG - 20)
                );
                const open = getExhaustValveFlowArea(radians(
                    (EXHAUST_VALVE_OPEN_DEG + EXHAUST_VALVE_CLOSE_DEG) / 2
                ));

                return {
                    pass: closed === 0
                        && Number.isFinite(open)
                        && open > 0,
                    measured:
                        `${formatUnitValue(closed * 1e6, 3)} / `
                        + `${formatUnitValue(open * 1e6, 3)} mm²`,
                    detail: "Aire géométrique bornée et non négative."
                };
            }
        );

        record(
            "Échappement",
            "Coefficient de décharge",
            "0 < Cd < 1 et Cd augmente avec le régime",
            () => {
                const low = getExhaustValveDischargeCoefficient(1000);
                const high = getExhaustValveDischargeCoefficient(6500);

                return {
                    pass: low > 0 && high < 1 && high >= low,
                    measured:
                        `${formatUnitValue(low, 4)} → `
                        + `${formatUnitValue(high, 4)}`,
                    detail: "Transition Reynolds continue."
                };
            }
        );

        record(
            "Combustion",
            "Durée à bas régime",
            "durée = 50° sous 3 000 tr/min",
            () => near(
                getCombustionDurationDegForRpm(1000),
                50,
                1e-12,
                `${formatUnitValue(
                    getCombustionDurationDegForRpm(1000),
                    3
                )}° CA`
            )
        );

        record(
            "Combustion",
            "Durée à haut régime",
            "durée = 44° à partir de 6 000 tr/min",
            () => near(
                getCombustionDurationDegForRpm(6500),
                44,
                1e-12,
                `${formatUnitValue(
                    getCombustionDurationDegForRpm(6500),
                    3
                )}° CA`
            )
        );

        record(
            "Combustion",
            "Raccourcissement monotone",
            "50° ≥ durée 4 500 ≥ 44°",
            () => {
                const low = getCombustionDurationDegForRpm(3000);
                const middle = getCombustionDurationDegForRpm(4500);
                const high = getCombustionDurationDegForRpm(6000);

                return {
                    pass: low >= middle && middle >= high && low > high,
                    measured:
                        `${formatUnitValue(low, 2)} → `
                        + `${formatUnitValue(middle, 2)} → `
                        + `${formatUnitValue(high, 2)}°`,
                    detail: "Transition continue avec le régime."
                };
            }
        );

        record(
            "Combustion",
            "Commande de CA50",
            "+1° de CA50 demandé → −1° d’avance",
            () => {
                const advanceA = getIgnitionAdvanceForTargetCA50(4000, 9.5);
                const advanceB = getIgnitionAdvanceForTargetCA50(4000, 10.5);
                const difference = advanceA - advanceB;

                return near(
                    difference,
                    1,
                    1e-12,
                    `Δ avance ${formatUnitValue(difference, 6)}°`
                );
            }
        );

        record(
            "Combustion",
            "Avance cohérente",
            "l’avance diminue quand la durée raccourcit",
            () => {
                const low = getIgnitionAdvanceForTargetCA50(3000, 9.5);
                const high = getIgnitionAdvanceForTargetCA50(6000, 9.5);

                return {
                    pass: Number.isFinite(low)
                        && Number.isFinite(high)
                        && low > high,
                    measured:
                        `${formatUnitValue(low, 3)}° → `
                        + `${formatUnitValue(high, 3)}°`,
                    detail: "Phasage analytique sans table de couple."
                };
            }
        );

        record(
            "Combustion",
            "Interpolation CA mesuré",
            "franchissement xb=0,5 interpolé entre deux sous-pas",
            () => {
                const crossing = interpolateMonotonicThresholdCrossing(
                    370,
                    0.40,
                    371,
                    0.60,
                    0.50
                );
                return near(
                    crossing,
                    370.5,
                    1e-12,
                    `${formatUnitValue(crossing, 6)}° CA`,
                    "Le CA50 mesuré ne dépend pas du calcul analytique de la position de Wiebe."
                );
            }
        );

        const createLossState = (rpm: any) => {
            const state = new Engine().state;
            state.rpm = rpm;
            state.crankAngle = 0;
            state.cylinderPressures.fill(5e6);
            state.currentCyclePeakCylinderPressure.fill(5e6);
            state.lastCyclePeakCylinderPressure.fill(5e6);
            state.lossModelPreviousCylinderAngles.fill(0);
            return state;
        };

        record(
            "Pertes mécaniques",
            "Résultats finis",
            "FMEP, frottement et accessoires ≥ 0",
            () => {
                const result = calculateMechanicalLosses(
                    createLossState(3000)
                );
                const values = [
                    result.totalFMEP,
                    result.frictionTorque,
                    result.accessoryTorque,
                    result.totalMechanicalLossTorque
                ];

                return {
                    pass: values.every(
                        value => Number.isFinite(value) && value >= 0
                    ),
                    measured:
                        `${formatUnitValue(result.totalFMEP / 1e5, 4)} bar · `
                        + `${formatUnitValue(
                            result.totalMechanicalLossTorque,
                            4
                        )} N·m`,
                    detail: "Aucune perte négative ou non finie."
                };
            }
        );

        record(
            "Pertes mécaniques",
            "Fermeture des pertes",
            "total = frottement + accessoires",
            () => {
                const result = calculateMechanicalLosses(
                    createLossState(3000)
                );
                const residual = Math.abs(
                    result.totalMechanicalLossTorque
                    - result.frictionTorque
                    - result.accessoryTorque
                );

                return {
                    pass: residual <= 1e-12,
                    measured: `résidu ${formatUnitValue(residual, 3)} N·m`,
                    detail: "Décomposition mécanique exactement fermée."
                };
            }
        );

        record(
            "Pertes mécaniques",
            "Croissance avec le régime",
            "pertes à 6 000 > pertes à 1 000 tr/min",
            () => {
                const low = calculateMechanicalLosses(createLossState(1000));
                const high = calculateMechanicalLosses(createLossState(6000));

                return {
                    pass: high.totalMechanicalLossTorque
                        > low.totalMechanicalLossTorque,
                    measured:
                        `${formatUnitValue(
                            low.totalMechanicalLossTorque,
                            3
                        )} → ${formatUnitValue(
                            high.totalMechanicalLossTorque,
                            3
                        )} N·m`,
                    detail: "Termes de vitesse et accessoires actifs."
                };
            }
        );

        record(
            "Commande moteur",
            "Activation de la coupure",
            "papillon fermé et régime élevé → coupure active",
            () => {
                const state = {
                    throttle: 0,
                    rpm: 2000,
                    fuelCutActive: false,
                    engineBrakingActive: false
                };
                updateOverrunFuelCut(state as any);

                return {
                    pass: state.fuelCutActive
                        && state.engineBrakingActive,
                    measured: state.fuelCutActive ? "active" : "inactive",
                    detail: "Seuil haut de l’hystérésis."
                };
            }
        );

        record(
            "Commande moteur",
            "Réactivation au papillon",
            "papillon > 4 % → coupure désactivée",
            () => {
                const state = {
                    throttle: 0.05,
                    rpm: 2500,
                    fuelCutActive: true,
                    engineBrakingActive: true
                };
                updateOverrunFuelCut(state as any);

                return {
                    pass: !state.fuelCutActive
                        && !state.engineBrakingActive,
                    measured: state.fuelCutActive ? "active" : "inactive",
                    detail: "Hystérésis de réouverture."
                };
            }
        );

        record(
            "Commande moteur",
            "Réactivation à bas régime",
            "régime ≤ 1 200 tr/min → coupure désactivée",
            () => {
                const state = {
                    throttle: 0,
                    rpm: 1000,
                    fuelCutActive: true,
                    engineBrakingActive: true
                };
                updateOverrunFuelCut(state as any);

                return {
                    pass: !state.fuelCutActive
                        && !state.engineBrakingActive,
                    measured: state.fuelCutActive ? "active" : "inactive",
                    detail: "Protection du retour au ralenti."
                };
            }
        );

        const turboState = (
            turboRpm = 0,
            wastegatePosition = 0
        ) => {
            const state = new Engine().state;
            state.turboShaftAngularSpeed = turboRpm * 2 * Math.PI / 60;
            state.wastegatePosition = wastegatePosition;
            state.turbineFlowUtilization.fill(0);
            state.turbineAerodynamicEfficiency.fill(0);
            return state;
        };

        record(
            "Turbo",
            "Absence de détente",
            "Pamont ≤ Psortie → débit turbine nul",
            () => {
                const result = calculateTurboExhaustBoundary(
                    turboState(),
                    0,
                    101325,
                    800
                );

                return {
                    pass: result.requestedTurbineMassFlow === 0
                        && result.availableGasPower === 0,
                    measured:
                        `${formatUnitValue(
                            result.requestedTurbineMassFlow,
                            6
                        )} kg/s`,
                    detail: "Aucune énergie créée sans rapport de détente."
                };
            }
        );

        record(
            "Turbo",
            "Frontière turbine active",
            "pression et température élevées → débit et puissance positifs",
            () => {
                const result = calculateTurboExhaustBoundary(
                    turboState(80000),
                    0,
                    200000,
                    900
                );

                return {
                    pass: result.requestedTurbineMassFlow > 0
                        && result.availableGasPower > 0
                        && result.turbineTorque >= 0,
                    measured:
                        `${formatUnitValue(
                            result.requestedTurbineMassFlow,
                            5
                        )} kg/s · ${formatUnitValue(
                            result.availableGasPower / 1000,
                            3
                        )} kW`,
                    detail: "Conversion énergétique finie."
                };
            }
        );

        record(
            "Turbo",
            "Wastegate fermée",
            "position 0 → débit wastegate nul",
            () => {
                const result = calculateTurboExhaustBoundary(
                    turboState(80000, 0),
                    0,
                    200000,
                    900
                );

                return {
                    pass: result.requestedWastegateMassFlow === 0
                        && result.wastegateArea === 0,
                    measured:
                        `${formatUnitValue(
                            result.requestedWastegateMassFlow,
                            6
                        )} kg/s`,
                    detail: "Aucune fuite artificielle par la wastegate."
                };
            }
        );

        record(
            "Turbo",
            "Wastegate ouverte",
            "position 1 → débit dérivé positif",
            () => {
                const result = calculateTurboExhaustBoundary(
                    turboState(80000, 1),
                    0,
                    200000,
                    900
                );

                return {
                    pass: result.requestedWastegateMassFlow > 0
                        && result.wastegateArea > 0,
                    measured:
                        `${formatUnitValue(
                            result.requestedWastegateMassFlow,
                            5
                        )} kg/s`,
                    detail: "La section de dérivation répond à la commande."
                };
            }
        );

        record(
            "Turbo",
            "Rendement borné",
            "0 ≤ Parbre / Pgaz ≤ 1",
            () => {
                const state = turboState(100000);
                const result = calculateTurboExhaustBoundary(
                    state,
                    0,
                    200000,
                    900
                );
                const efficiency = state.turbineAerodynamicEfficiency[0];

                return {
                    pass: efficiency >= 0
                        && efficiency <= 1
                        && result.turbineShaftPower
                        <= result.availableGasPower + 1e-9,
                    measured:
                        `${formatUnitValue(efficiency * 100, 3)} %`,
                    detail: "La puissance arbre ne dépasse pas celle des gaz."
                };
            }
        );

        record(
            "Turbo",
            "Limite couple-vitesse",
            "le couple turbine ne croît pas à survitesse",
            () => {
                const slow = calculateTurboExhaustBoundary(
                    turboState(0),
                    0,
                    200000,
                    900
                );
                const fast = calculateTurboExhaustBoundary(
                    turboState(220000),
                    0,
                    200000,
                    900
                );

                return {
                    pass: fast.turbineTorque
                        <= slow.turbineTorque + 1e-12,
                    measured:
                        `${formatUnitValue(slow.turbineTorque, 6)} → `
                        + `${formatUnitValue(fast.turbineTorque, 6)} N·m`,
                    detail: "Facteur couple-vitesse borné."
                };
            }
        );

        record(
            "Intégrateur",
            "Pas à l’arrêt",
            "RPM = 0 → limite temporelle maximale",
            () => {
                const state = new Engine().state;
                state.rpm = 0;
                const substep = calculateCrankAngleSubstep(state);

                return near(
                    substep.dt,
                    MAX_INTERNAL_TIME_STEP,
                    1e-15,
                    `${formatUnitValue(substep.dt * 1e6, 6)} µs`
                );
            }
        );

        record(
            "Intégrateur",
            "Limite angulaire à haut régime",
            "avance prédite ≤ pas demandé",
            () => {
                const state = new Engine().state;
                state.rpm = 6000;
                state.crankAngle = radians(100);
                state.ignitionTimingDeg = 15;
                const substep = calculateCrankAngleSubstep(state);

                return {
                    pass: substep.dt <= MAX_INTERNAL_TIME_STEP
                        && substep.predictedAngleAdvanceDeg
                        <= substep.targetAngleStepDeg + 1e-9
                        && substep.targetAngleStepDeg
                        <= BASE_CRANK_ANGLE_STEP_DEG,
                    measured:
                        `${formatUnitValue(
                            substep.predictedAngleAdvanceDeg,
                            6
                        )}° pour cible ${formatUnitValue(
                            substep.targetAngleStepDeg,
                            3
                        )}°`,
                    detail: "Sous-pas borné par la résolution locale."
                };
            }
        );

        record(
            "Intégrateur",
            "Fin de combustion partagée",
            "le solveur tombe sur la fin réelle à plusieurs régimes",
            () => {
                const checks = [1000, 4500, 6500].map(rpm => {
                    const state = new Engine().state;
                    state.rpm = rpm;
                    state.ignitionTimingDeg = 15;
                    const combustionEndDeg = 360 - state.ignitionTimingDeg
                        + getCombustionDurationDegForRpm(rpm);
                    state.crankAngle = radians(combustionEndDeg - 0.1);
                    const substep = calculateCrankAngleSubstep(state);
                    return {
                        rpm,
                        combustionEndDeg,
                        advanceDeg: substep.predictedAngleAdvanceDeg,
                        pass: Math.abs(
                            substep.predictedAngleAdvanceDeg - 0.1
                        ) <= 1e-6
                    };
                });

                return {
                    pass: checks.every(check => check.pass),
                    measured: checks.map(check =>
                        `${check.rpm} tr/min → fin ${formatUnitValue(
                            check.combustionEndDeg,
                            2
                        )}°`
                    ).join(" · "),
                    detail:
                        "Chaque sous-pas part de 0,1° avant la fin réelle. "
                        + "La durée variable 44–50° vient de la même fonction que Thermodynamics.js."
                };
            }
        );

        record(
            "État moteur",
            "Dimensionnement des tableaux",
            "tableaux cylindre alignés sur les déphasages",
            () => {
                const state = new Engine().state;
                const arrays = [
                    state.pistonPositions,
                    state.cylinderVolumes,
                    state.cylinderPressures,
                    state.cylinderTemperatures,
                    state.intakeValveLift,
                    state.exhaustValveLift
                ];

                return {
                    pass: arrays.every(
                        array => (
                            Array.isArray(array)
                            || ArrayBuffer.isView(array)
                        ) && array.length === CYLINDER_OFFSETS.length
                    ),
                    measured:
                        `${arrays.length} tableaux × `
                        + `${CYLINDER_OFFSETS.length} cylindres`,
                    detail: "État partagé cohérent avec l’architecture actuelle."
                };
            }
        );

        const passed = rows.filter((row: any) => row.status === "pass").length;
        const failed = rows.length - passed;
        const report = {
            generatedAt: new Date().toISOString(),
            durationMs: performance.now() - startedAt,
            status: failed === 0
                ? CYCLE_VALIDATION_STATUS.PASS
                : CYCLE_VALIDATION_STATUS.FAIL,
            summary: {
                total: rows.length,
                passed,
                failed
            },
            rows,
            conclusion: failed === 0
                ? `${passed} tests unitaires validés. Les invariants élémentaires des sous-modules sont cohérents.`
                : `${failed} test(s) en échec sur ${rows.length}. Examiner les lignes rouges avant de relancer une campagne moteur.`
        };

        liveData.submoduleUnitTestReport = report;
        renderSubmoduleUnitTestReport(report);

        return report;
    }

    function renderSubmoduleUnitTestReport(report: any = null) {
        const panel = ui.submoduleUnitTestGlobalStatus
            ?.closest(".submodule-unit-tests");
        const status = report?.status ?? CYCLE_VALIDATION_STATUS.UNAVAILABLE;

        if (panel) {
            panel.dataset.validationStatus = status;
        }

        setText(
            ui.submoduleUnitTestGlobalStatus,
            status === CYCLE_VALIDATION_STATUS.PASS
                ? "Validé"
                : status === CYCLE_VALIDATION_STATUS.FAIL
                    ? "Échec"
                    : "Non exécuté"
        );

        if (!report) {
            setText(ui.submoduleUnitTestSummary, "Aucun test exécuté.");
            setText(ui.submoduleUnitTestSummaryBadge, "En attente");
            setText(ui.submoduleUnitTestTimestamp, "—");
            setText(
                ui.submoduleUnitTestConclusion,
                "Les tests rapides seront exécutés au chargement."
            );
            if (ui.submoduleUnitTestExportButton) {
                ui.submoduleUnitTestExportButton.disabled = true;
            }
            return;
        }

        setText(
            ui.submoduleUnitTestSummary,
            `${report.summary.passed} validé(s) · `
            + `${report.summary.failed} échec(s) · `
            + `${formatNumber(report.durationMs, 1)} ms`
        );
        setText(
            ui.submoduleUnitTestSummaryBadge,
            report.summary.failed === 0
                ? `${report.summary.passed}/${report.summary.total} validés`
                : `${report.summary.failed} échec(s)`
        );
        setText(
            ui.submoduleUnitTestTimestamp,
            new Date(report.generatedAt).toLocaleString("fr-FR")
        );
        setText(ui.submoduleUnitTestConclusion, report.conclusion);

        if (ui.submoduleUnitTestTableBody) {
            ui.submoduleUnitTestTableBody.innerHTML = report.rows.map((row: any) => `
                <tr data-test-status="${escapeHtml(row.status)}">
                    <td>${escapeHtml(row.group)}</td>
                    <td>
                        <strong>${escapeHtml(row.name)}</strong>
                        ${row.detail
                ? `<span>${escapeHtml(row.detail)}</span>`
                : ""}
                    </td>
                    <td class="cycle-validation-status">
                        ${row.status === "pass" ? "Validé" : "Échec"}
                    </td>
                    <td>${escapeHtml(row.measured)}</td>
                    <td>${escapeHtml(row.criterion)}</td>
                </tr>
            `).join("");
        }

        if (ui.submoduleUnitTestExportButton) {
            ui.submoduleUnitTestExportButton.disabled = false;
        }
    }

    function submoduleUnitTestReportToCsv(report: any) {
        if (!report?.rows?.length) return "";

        const escapeCsv = (value: any) =>
            `"${String(value ?? "").replaceAll('"', '""')}"`;

        return [
            [
                "groupe",
                "test",
                "statut",
                "valeur_mesuree",
                "critere",
                "detail"
            ].map(escapeCsv).join(";"),
            ...report.rows.map((row: any) => [
                row.group,
                row.name,
                row.status,
                row.measured,
                row.criterion,
                row.detail
            ].map(escapeCsv).join(";"))
        ].join("\\n");
    }


    return {
        formatUnitValue,
        runSubmoduleUnitTests,
        renderSubmoduleUnitTestReport,
        submoduleUnitTestReportToCsv
    };
}