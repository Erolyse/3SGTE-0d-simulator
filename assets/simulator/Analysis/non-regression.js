import { PASCAL_TO_BAR } from "./config.js";
import { CYCLE_VALIDATION_STATUS } from "./cycle-validation.js";
import { formatNumber, summarizeValidationStatuses } from "./utils.js";

const MODEL_REFERENCE_STORAGE_KEY = "3sgte.modelReference.v2";
const MODEL_REFERENCE_SCHEMA_VERSION = 2;
const MODEL_REFERENCE_KIND = "3sgte-deterministic-model-reference";

const NON_REGRESSION_TOLERANCES = Object.freeze({
    global: Object.freeze({
        peakTorqueRelativePercent: Object.freeze({ pass: 0.50, warning: 1.50 }),
        peakPowerRelativePercent: Object.freeze({ pass: 0.50, warning: 1.50 }),
        peakRpmAbsolute: Object.freeze({ pass: 100, warning: 250 })
    }),
    cycle: Object.freeze({
        torqueRelativePercent: Object.freeze({ pass: 0.50, warning: 1.50 }),
        imepRelativePercent: Object.freeze({ pass: 0.50, warning: 1.50 }),
        peakPressureRelativePercent: Object.freeze({ pass: 1.00, warning: 3.00 }),
        ca50AbsoluteDeg: Object.freeze({ pass: 0.50, warning: 1.50 }),
        repeatabilityUpperPercent: Object.freeze({ pass: 0.05, warning: 0.20 }),
        convergenceUpperPercent: Object.freeze({ pass: 0.05, warning: 0.20 }),
        pvClosureUpperPercent: Object.freeze({ pass: 0.05, warning: 0.20 }),
        massResidualUpperPercent: Object.freeze({ pass: 1e-5, warning: 1e-3 }),
        energyResidualUpperPercent: Object.freeze({ pass: 2.5e-4, warning: 2e-3 })
    }),
    transient: Object.freeze({
        timeAbsoluteSeconds: Object.freeze({ pass: 0.10, warning: 0.50 }),
        boostAbsoluteBar: Object.freeze({ pass: 0.02, warning: 0.05 }),
        turboRpmAbsolute: Object.freeze({ pass: 1500, warning: 5000 }),
        percentageAbsolute: Object.freeze({ pass: 1.0, warning: 5.0 })
    }),
    point: Object.freeze({
        rpmAbsolute: Object.freeze({ pass: 50, warning: 150 }),
        boostAbsoluteBar: Object.freeze({ pass: 0.02, warning: 0.05 }),
        torqueRelativePercent: Object.freeze({ pass: 0.75, warning: 2.00 }),
        imepRelativePercent: Object.freeze({ pass: 0.75, warning: 2.00 }),
        peakPressureRelativePercent: Object.freeze({ pass: 1.00, warning: 3.00 }),
        ca50AbsoluteDeg: Object.freeze({ pass: 0.50, warning: 1.50 }),
        repeatabilityUpperPercent: Object.freeze({ pass: 0.05, warning: 0.20 }),
        lowTorquePvClosureAbsoluteNm: Object.freeze({ pass: 0.10, warning: 0.50 }),
        pvClosureUpperPercent: Object.freeze({ pass: 0.05, warning: 0.20 }),
        massResidualUpperPercent: Object.freeze({ pass: 1e-5, warning: 1e-3 }),
        energyResidualUpperPercent: Object.freeze({ pass: 2.5e-4, warning: 2e-3 })
    })
});

function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function modelFingerprint(report) {
    const stableModel = {
        project: report?.project ?? null,
        model: report?.model ?? null,
        numericalMethod: {
            angularSolver: report?.numericalMethod?.angularSolver ?? null,
            displayedCycleStepDeg: report?.numericalMethod?.displayedCycleStepDeg ?? null
        }
    };
    return `fnv1a-${hashText(JSON.stringify(stableModel))}`;
}

function numericTestValue(report, testId) {
    const test = report?.cycleValidation?.tests?.find(
        candidate => candidate.id === testId
    );
    if (!test) return null;

    // La non-régression stocke directement les métriques structurées de convergence.
    if (testId === "convergence" && Array.isArray(test.diagnostics)) {
        const relativeChanges = test.diagnostics
            .filter(item =>
                item?.available
                && item?.mode === "relative"
                && Number.isFinite(item?.e2RelativePercent)
            )
            .map(item => item.e2RelativePercent);
        if (relativeChanges.length > 0) {
            return Math.max(...relativeChanges);
        }
    }

    const match = String(test.measured ?? "")
        .replace(",", ".")
        .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
    return match ? Number(match[0]) : null;
}

function extractReferenceMetrics(report) {
    const cycleMetrics = report?.cycleValidation?.metrics ?? {};
    const cycle = report?.cycle ?? null;
    const points = Object.fromEntries(
        (report?.multiPointValidation?.points ?? []).map(point => [
            point.id,
            {
                id: point.id,
                label: point.label,
                targetRpm: point.targetRpm,
                throttle: point.throttle,
                meanRpm: point.meanRpm,
                meanBoostBarGauge: point.meanBoostBarGauge,
                torqueFromPvNm: point.torqueFromPvNm,
                indicatedTorqueNm: point.indicatedTorqueNm,
                netImepBar: point.netImepBar,
                peakPressureBar: point.peakPressureBar,
                ca50Deg: point.ca50MeasuredDeg ?? point.ca50Deg,
                ca50ModelDeg: point.ca50ModelDeg ?? null,
                ca50TargetDeg: point.ca50TargetDeg ?? null,
                pvClosureErrorPercent: point.pvClosureErrorPercent,
                pvClosureErrorNm: point.pvClosureErrorNm,
                repeatabilityCvPercent: point.repeatabilityCvPercent,
                maximumMassResidualPercent: point.maximumMassResidualPercent,
                maximumEnergyResidualPercent: point.maximumEnergyResidualPercent,
                status: point.status
            }
        ])
    );

    const transients = Object.fromEntries(
        (report?.transientValidation?.scenarios ?? []).map(scenario => [
            scenario.id,
            {
                id: scenario.id,
                label: scenario.label,
                status: scenario.status,
                metrics: scenario.metrics ?? {}
            }
        ])
    );

    return {
        global: {
            peakTorqueNm: report?.results?.peakTorqueNm ?? null,
            peakTorqueRpm: report?.results?.peakTorqueRpm ?? null,
            peakPowerHp: report?.results?.peakPowerHp ?? null,
            peakPowerRpm: report?.results?.peakPowerRpm ?? null,
            maximumMassResidualPercent:
                report?.results?.maximumMassResidualPercent ?? null,
            maximumEnergyResidualPercent:
                report?.results?.maximumEnergyResidualPercent ?? null
        },
        cycle: {
            torqueFromPvNm: cycleMetrics.torqueFromPvNm ?? null,
            indicatedTorqueNm: cycleMetrics.meanIndicatedTorqueNm ?? null,
            netImepBar: cycleMetrics.netImepBar ?? null,
            peakPressureBar: Number.isFinite(cycle?.summary?.peakPressurePa)
                ? cycle.summary.peakPressurePa * PASCAL_TO_BAR
                : null,
            ca50Deg:
                cycle?.events?.ca50MeasuredDeg
                ?? cycle?.events?.ca50Deg
                ?? null,
            ca50ModelDeg: cycle?.events?.ca50ModelDeg ?? null,
            ca50TargetDeg: cycle?.events?.ca50TargetDeg ?? null,
            pvClosureErrorPercent: cycleMetrics.consistencyErrorPercent ?? null,
            pvClosureErrorNm: cycleMetrics.consistencyErrorNm ?? null,
            repeatabilityCvPercent: numericTestValue(report, "repeatability"),
            convergenceChangePercent: numericTestValue(report, "convergence")
        },
        points,
        transients
    };
}

function isCompleteDeterministicReport(report) {
    return report?.referenceProtocol?.type === "deterministic-reference"
        && Array.isArray(report?.multiPointValidation?.points)
        && report.multiPointValidation.points.length > 0
        && Number.isFinite(report?.results?.peakTorqueNm)
        && Number.isFinite(report?.results?.peakPowerHp);
}

function isCompleteReferenceCandidate(report) {
    return isCompleteDeterministicReport(report)
        && Array.isArray(report?.transientValidation?.scenarios)
        && report.transientValidation.scenarios.length > 0;
}

function createReferenceIdentifier() {
    if (globalThis.crypto?.randomUUID) {
        return `3sgte-st205-${globalThis.crypto.randomUUID()}`;
    }
    return `3sgte-st205-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildModelReference(report, label = null) {
    if (!isCompleteReferenceCandidate(report)) {
        throw new Error("La référence doit provenir d'un tir déterministe complet avec campagnes multipoint et transitoire.");
    }

    const createdAt = new Date().toISOString();
    return {
        schemaVersion: MODEL_REFERENCE_SCHEMA_VERSION,
        kind: MODEL_REFERENCE_KIND,
        id: createReferenceIdentifier(),
        label: label || `3S-GTE ST205 — référence ${new Date(createdAt).toLocaleString("fr-FR")}`,
        createdAt,
        source: {
            reportGeneratedAt: report.generatedAt ?? null,
            referenceProtocol: report.referenceProtocol,
            cycleValidationStatus: report.cycleValidation?.status ?? null,
            multiPointValidationStatus: report.multiPointValidation?.status ?? null,
            transientValidationStatus: report.transientValidation?.status ?? null,
            creationMode: "action explicite de l'utilisateur"
        },
        project: report.project,
        model: report.model,
        numericalMethod: report.numericalMethod,
        modelFingerprint: modelFingerprint(report),
        tolerances: NON_REGRESSION_TOLERANCES,
        metrics: extractReferenceMetrics(report)
    };
}

function validateModelReference(reference) {
    if (!reference || typeof reference !== "object") {
        throw new Error("Le fichier de référence n'est pas un objet JSON valide.");
    }
    if (reference.schemaVersion !== MODEL_REFERENCE_SCHEMA_VERSION) {
        throw new Error(`Version de référence incompatible : ${reference.schemaVersion ?? "absente"}.`);
    }
    if (reference.kind !== MODEL_REFERENCE_KIND) {
        throw new Error("Ce fichier n'est pas une référence déterministe 3S-GTE reconnue.");
    }
    if (!reference.id || !reference.metrics?.global || !reference.metrics?.points) {
        throw new Error("La référence est incomplète.");
    }
    return reference;
}

function loadModelReference() {
    try {
        const parsed = JSON.parse(localStorage.getItem(MODEL_REFERENCE_STORAGE_KEY) ?? "null");
        return parsed ? validateModelReference(parsed) : null;
    } catch (error) {
        console.warn("Référence de modèle illisible.", error);
        return null;
    }
}

function persistModelReference(reference) {
    const validated = validateModelReference(reference);
    localStorage.setItem(
        MODEL_REFERENCE_STORAGE_KEY,
        JSON.stringify(validated)
    );
    return validated;
}

function classifyRegressionValue(value, passLimit, warningLimit) {
    if (!Number.isFinite(value)) return CYCLE_VALIDATION_STATUS.UNAVAILABLE;
    if (value <= passLimit) return CYCLE_VALIDATION_STATUS.PASS;
    if (value <= warningLimit) return CYCLE_VALIDATION_STATUS.WARNING;
    return CYCLE_VALIDATION_STATUS.FAIL;
}

function formatRegressionNumber(value, unit = "", digits = 2) {
    if (!Number.isFinite(value)) return "—";
    const absolute = Math.abs(value);
    const number = absolute !== 0 && (absolute < 1e-3 || absolute >= 1e6)
        ? value.toExponential(2)
        : formatNumber(value, digits);
    return `${number}${unit ? ` ${unit}` : ""}`;
}

function createRegressionRow({
    group,
    id,
    label,
    referenceValue,
    currentValue,
    unit = "",
    digits = 2,
    mode = "relative",
    pass,
    warning,
    detail = ""
}) {
    let measuredDifference = NaN;
    let differenceLabel = "—";
    let criterionLabel = "—";

    if (Number.isFinite(referenceValue) && Number.isFinite(currentValue)) {
        const signedDifference = currentValue - referenceValue;

        if (mode === "relative") {
            measuredDifference = Math.abs(referenceValue) > 1e-12
                ? Math.abs(signedDifference) / Math.abs(referenceValue) * 100
                : Math.abs(signedDifference) <= 1e-12 ? 0 : Infinity;
            differenceLabel = `${signedDifference >= 0 ? "+" : ""}${formatNumber(signedDifference, digits)} ${unit} · ${formatNumber(measuredDifference, 3)} %`;
            criterionLabel = `≤ ${formatNumber(pass, 2)} % conforme · ≤ ${formatNumber(warning, 2)} % variation`;
        } else if (mode === "absolute") {
            measuredDifference = Math.abs(signedDifference);
            differenceLabel = `${signedDifference >= 0 ? "+" : ""}${formatRegressionNumber(signedDifference, unit, digits)}`;
            criterionLabel = `≤ ${formatRegressionNumber(pass, unit, digits)} conforme · ≤ ${formatRegressionNumber(warning, unit, digits)} variation`;
        } else if (mode === "increase") {
            measuredDifference = Math.max(signedDifference, 0);
            differenceLabel = `${signedDifference >= 0 ? "+" : ""}${formatRegressionNumber(signedDifference, unit, digits)}`;
            criterionLabel = `dégradation ≤ ${formatRegressionNumber(pass, unit, digits)} conforme · ≤ ${formatRegressionNumber(warning, unit, digits)} variation`;
        } else if (mode === "upper") {
            measuredDifference = currentValue;
            differenceLabel = `${formatRegressionNumber(currentValue, unit, digits)} actuel`;
            criterionLabel = `≤ ${formatRegressionNumber(pass, unit, digits)} conforme · ≤ ${formatRegressionNumber(warning, unit, digits)} variation`;
        }
    }

    return {
        group,
        id,
        label,
        referenceValue,
        currentValue,
        referenceLabel: formatRegressionNumber(referenceValue, unit, digits),
        currentLabel: formatRegressionNumber(currentValue, unit, digits),
        differenceLabel,
        criterionLabel,
        status: classifyRegressionValue(measuredDifference, pass, warning),
        detail
    };
}

function compareReportWithReference(report, reference) {
    if (!reference) {
        return {
            generatedAt: new Date().toISOString(),
            status: CYCLE_VALIDATION_STATUS.UNAVAILABLE,
            counts: { pass: 0, warning: 0, fail: 0, unavailable: 0 },
            reference: null,
            rows: [],
            conclusion: "Aucune référence versionnée n'est définie."
        };
    }

    if (!isCompleteDeterministicReport(report)) {
        return {
            generatedAt: new Date().toISOString(),
            status: CYCLE_VALIDATION_STATUS.UNAVAILABLE,
            counts: { pass: 0, warning: 0, fail: 0, unavailable: 0 },
            reference: {
                id: reference.id,
                label: reference.label,
                createdAt: reference.createdAt
            },
            rows: [],
            conclusion: "La référence est active, mais la session affichée n'est pas un tir déterministe complet comparable."
        };
    }

    const currentFingerprint = modelFingerprint(report);
    if (reference.modelFingerprint !== currentFingerprint) {
        return {
            generatedAt: new Date().toISOString(),
            status: CYCLE_VALIDATION_STATUS.FAIL,
            counts: { pass: 0, warning: 0, fail: 1, unavailable: 0 },
            reference: {
                id: reference.id,
                label: reference.label,
                createdAt: reference.createdAt
            },
            rows: [{
                group: "Configuration",
                id: "model-fingerprint",
                label: "Compatibilité de la définition moteur",
                referenceLabel: reference.modelFingerprint,
                currentLabel: currentFingerprint,
                differenceLabel: "Définition différente",
                criterionLabel: "Empreinte identique",
                status: CYCLE_VALIDATION_STATUS.FAIL,
                detail: "La géométrie ou la méthode numérique de la session ne correspond pas à la référence."
            }],
            conclusion: "Comparaison refusée : la session et la référence ne décrivent pas la même configuration de modèle."
        };
    }

    const baseline = reference.metrics;
    const current = extractReferenceMetrics(report);
    const tolerance = reference.tolerances ?? NON_REGRESSION_TOLERANCES;
    const rows = [];

    rows.push(
        createRegressionRow({
            group: "Banc moteur",
            id: "peak-torque",
            label: "Couple maximal",
            referenceValue: baseline.global.peakTorqueNm,
            currentValue: current.global.peakTorqueNm,
            unit: "N·m",
            digits: 2,
            mode: "relative",
            ...tolerance.global.peakTorqueRelativePercent
        }),
        createRegressionRow({
            group: "Banc moteur",
            id: "peak-torque-rpm",
            label: "Régime du couple maximal",
            referenceValue: baseline.global.peakTorqueRpm,
            currentValue: current.global.peakTorqueRpm,
            unit: "tr/min",
            digits: 0,
            mode: "absolute",
            ...tolerance.global.peakRpmAbsolute
        }),
        createRegressionRow({
            group: "Banc moteur",
            id: "peak-power",
            label: "Puissance maximale",
            referenceValue: baseline.global.peakPowerHp,
            currentValue: current.global.peakPowerHp,
            unit: "ch",
            digits: 2,
            mode: "relative",
            ...tolerance.global.peakPowerRelativePercent
        }),
        createRegressionRow({
            group: "Banc moteur",
            id: "peak-power-rpm",
            label: "Régime de puissance maximale",
            referenceValue: baseline.global.peakPowerRpm,
            currentValue: current.global.peakPowerRpm,
            unit: "tr/min",
            digits: 0,
            mode: "absolute",
            ...tolerance.global.peakRpmAbsolute
        })
    );

    rows.push(
        createRegressionRow({
            group: "Cycle de référence",
            id: "cycle-pv-torque",
            label: "Couple depuis P-V",
            referenceValue: baseline.cycle.torqueFromPvNm,
            currentValue: current.cycle.torqueFromPvNm,
            unit: "N·m",
            digits: 2,
            mode: "relative",
            ...tolerance.cycle.torqueRelativePercent
        }),
        createRegressionRow({
            group: "Cycle de référence",
            id: "cycle-imep",
            label: "IMEP net",
            referenceValue: baseline.cycle.netImepBar,
            currentValue: current.cycle.netImepBar,
            unit: "bar",
            digits: 3,
            mode: "relative",
            ...tolerance.cycle.imepRelativePercent
        }),
        createRegressionRow({
            group: "Cycle de référence",
            id: "cycle-peak-pressure",
            label: "Pression maximale",
            referenceValue: baseline.cycle.peakPressureBar,
            currentValue: current.cycle.peakPressureBar,
            unit: "bar",
            digits: 2,
            mode: "relative",
            ...tolerance.cycle.peakPressureRelativePercent
        }),
        createRegressionRow({
            group: "Cycle de référence",
            id: "cycle-ca50",
            label: "CA50 mesuré",
            referenceValue: baseline.cycle.ca50Deg,
            currentValue: current.cycle.ca50Deg,
            unit: "°CA",
            digits: 2,
            mode: "absolute",
            ...tolerance.cycle.ca50AbsoluteDeg
        }),
        createRegressionRow({
            group: "Gardes numériques",
            id: "cycle-repeatability",
            label: "Répétabilité du point de référence",
            referenceValue: baseline.cycle.repeatabilityCvPercent,
            currentValue: current.cycle.repeatabilityCvPercent,
            unit: "%",
            digits: 3,
            mode: "increase",
            ...tolerance.cycle.repeatabilityUpperPercent
        }),
        createRegressionRow({
            group: "Gardes numériques",
            id: "cycle-convergence",
            label: "Convergence angulaire maximale",
            referenceValue: baseline.cycle.convergenceChangePercent,
            currentValue: current.cycle.convergenceChangePercent,
            unit: "%",
            digits: 3,
            mode: "increase",
            ...tolerance.cycle.convergenceUpperPercent
        }),
        createRegressionRow({
            group: "Gardes numériques",
            id: "cycle-pv-closure",
            label: "Fermeture P-V / couple indiqué",
            referenceValue: baseline.cycle.pvClosureErrorPercent,
            currentValue: current.cycle.pvClosureErrorPercent,
            unit: "%",
            digits: 3,
            mode: "increase",
            ...tolerance.cycle.pvClosureUpperPercent
        }),
        createRegressionRow({
            group: "Gardes numériques",
            id: "mass-residual",
            label: "Résidu massique maximal",
            referenceValue: baseline.global.maximumMassResidualPercent,
            currentValue: current.global.maximumMassResidualPercent,
            unit: "%",
            digits: 6,
            mode: "increase",
            ...tolerance.cycle.massResidualUpperPercent
        }),
        createRegressionRow({
            group: "Gardes numériques",
            id: "energy-residual",
            label: "Résidu énergétique maximal",
            referenceValue: baseline.global.maximumEnergyResidualPercent,
            currentValue: current.global.maximumEnergyResidualPercent,
            unit: "%",
            digits: 6,
            mode: "increase",
            ...tolerance.cycle.energyResidualUpperPercent
        })
    );


    const transientDefinitions = [
        {
            id: "spool-3500",
            metrics: [
                ["boostTargetTimeSeconds", "Temps commande → 0,65 bar", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["boostRiseTimeSeconds", "Temps 0,10 → 0,65 bar", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["maximumBoostBar", "Boost maximal pendant le spool", "bar", 3, "absolute", tolerance.transient?.boostAbsoluteBar],
                ["maximumTurboRpm", "Régime turbo maximal", "tr/min", 0, "absolute", tolerance.transient?.turboRpmAbsolute]
            ]
        },
        {
            id: "wastegate-5500",
            metrics: [
                ["wastegateResponseTimeSeconds", "Délai d’ouverture wastegate", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["maximumBoostBar", "Boost maximal régulé", "bar", 3, "absolute", tolerance.transient?.boostAbsoluteBar],
                ["maximumTurboRpm", "Régime turbo maximal", "tr/min", 0, "absolute", tolerance.transient?.turboRpmAbsolute]
            ]
        },
        {
            id: "lift-off-4000",
            metrics: [
                ["bypassOpeningTimeSeconds", "Temps d’ouverture bypass", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["boostReleaseTimeSeconds", "Temps de décharge du boost", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["fuelCutTimeSeconds", "Temps d’activation fuel cut", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["turboSpeedReductionPercent", "Décélération turbo", "%", 2, "absolute", tolerance.transient?.percentageAbsolute]
            ]
        },
        {
            id: "reapplication-4000",
            metrics: [
                ["bypassClosingTimeSeconds", "Temps de fermeture bypass", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["boostRecoveryTimeSeconds", "Temps de récupération du boost", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["maximumBoostBar", "Boost maximal à la reprise", "bar", 3, "absolute", tolerance.transient?.boostAbsoluteBar]
            ]
        },
        {
            id: "rev-limiter",
            metrics: [
                ["activationTimeSeconds", "Temps d’activation du rupteur", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["injectionCutTimeSeconds", "Temps de suppression de l’injection", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["resumeTimeSeconds", "Temps de reprise du rupteur", "s", 3, "absolute", tolerance.transient?.timeAbsoluteSeconds],
                ["maximumRpm", "Régime maximal au rupteur", "tr/min", 0, "absolute", tolerance.global.peakRpmAbsolute]
            ]
        }
    ];

    if (Object.keys(baseline.transients ?? {}).length > 0) {
        for (const definition of transientDefinitions) {
            const referenceScenario = baseline.transients?.[definition.id];
            const currentScenario = current.transients?.[definition.id];
            const group = referenceScenario?.label
                ?? currentScenario?.label
                ?? definition.id;

            if (!referenceScenario || !currentScenario) {
                rows.push({
                    group,
                    id: `${definition.id}-available`,
                    label: "Scénario transitoire disponible",
                    referenceLabel: referenceScenario ? "Oui" : "Non",
                    currentLabel: currentScenario ? "Oui" : "Non",
                    differenceLabel: "Scénario manquant",
                    criterionLabel: "Présent dans les deux campagnes",
                    status: CYCLE_VALIDATION_STATUS.FAIL,
                    detail: "La référence et le tir actuel ne contiennent pas le même scénario transitoire."
                });
                continue;
            }

            for (const [key, label, unit, digits, mode, limits] of definition.metrics) {
                if (!limits) continue;
                rows.push(createRegressionRow({
                    group,
                    id: `${definition.id}-${key}`,
                    label,
                    referenceValue: referenceScenario.metrics?.[key],
                    currentValue: currentScenario.metrics?.[key],
                    unit,
                    digits,
                    mode,
                    ...limits
                }));
            }
        }
    }

    const pointIds = [...new Set([
        ...Object.keys(baseline.points ?? {}),
        ...Object.keys(current.points ?? {})
    ])];

    for (const pointId of pointIds) {
        const referencePoint = baseline.points?.[pointId];
        const currentPoint = current.points?.[pointId];
        const group = referencePoint?.label ?? currentPoint?.label ?? pointId;

        if (!referencePoint || !currentPoint) {
            rows.push({
                group,
                id: `${pointId}-available`,
                label: "Point de fonctionnement disponible",
                referenceLabel: referencePoint ? "Oui" : "Non",
                currentLabel: currentPoint ? "Oui" : "Non",
                differenceLabel: "Point manquant",
                criterionLabel: "Présent dans les deux campagnes",
                status: CYCLE_VALIDATION_STATUS.FAIL,
                detail: "La campagne actuelle et la référence ne contiennent pas le même ensemble de points."
            });
            continue;
        }

        rows.push(
            createRegressionRow({
                group,
                id: `${pointId}-rpm`,
                label: "Régime moyen",
                referenceValue: referencePoint.meanRpm,
                currentValue: currentPoint.meanRpm,
                unit: "tr/min",
                digits: 0,
                mode: "absolute",
                ...tolerance.point.rpmAbsolute
            }),
            createRegressionRow({
                group,
                id: `${pointId}-boost`,
                label: "Boost moyen relatif",
                referenceValue: referencePoint.meanBoostBarGauge,
                currentValue: currentPoint.meanBoostBarGauge,
                unit: "bar",
                digits: 3,
                mode: "absolute",
                ...tolerance.point.boostAbsoluteBar
            }),
            createRegressionRow({
                group,
                id: `${pointId}-torque`,
                label: "Couple depuis P-V",
                referenceValue: referencePoint.torqueFromPvNm,
                currentValue: currentPoint.torqueFromPvNm,
                unit: "N·m",
                digits: 2,
                mode: "relative",
                ...tolerance.point.torqueRelativePercent
            }),
            createRegressionRow({
                group,
                id: `${pointId}-imep`,
                label: "IMEP net",
                referenceValue: referencePoint.netImepBar,
                currentValue: currentPoint.netImepBar,
                unit: "bar",
                digits: 3,
                mode: "relative",
                ...tolerance.point.imepRelativePercent
            }),
            createRegressionRow({
                group,
                id: `${pointId}-peak-pressure`,
                label: "Pression maximale",
                referenceValue: referencePoint.peakPressureBar,
                currentValue: currentPoint.peakPressureBar,
                unit: "bar",
                digits: 2,
                mode: "relative",
                ...tolerance.point.peakPressureRelativePercent
            }),
            createRegressionRow({
                group,
                id: `${pointId}-ca50`,
                label: "CA50 mesuré",
                referenceValue: referencePoint.ca50Deg,
                currentValue: currentPoint.ca50Deg,
                unit: "°CA",
                digits: 2,
                mode: "absolute",
                ...tolerance.point.ca50AbsoluteDeg
            }),
            createRegressionRow({
                group,
                id: `${pointId}-repeatability`,
                label: "Répétabilité",
                referenceValue: referencePoint.repeatabilityCvPercent,
                currentValue: currentPoint.repeatabilityCvPercent,
                unit: "%",
                digits: 3,
                mode: "increase",
                ...tolerance.point.repeatabilityUpperPercent
            })
        );

        const lowTorque = Math.max(
            Math.abs(currentPoint.indicatedTorqueNm ?? 0),
            Math.abs(referencePoint.indicatedTorqueNm ?? 0)
        ) < 50;
        rows.push(createRegressionRow({
            group,
            id: `${pointId}-pv-closure`,
            label: lowTorque
                ? "Fermeture P-V — faible couple"
                : "Fermeture P-V / couple indiqué",
            referenceValue: lowTorque
                ? referencePoint.pvClosureErrorNm
                : referencePoint.pvClosureErrorPercent,
            currentValue: lowTorque
                ? currentPoint.pvClosureErrorNm
                : currentPoint.pvClosureErrorPercent,
            unit: lowTorque ? "N·m" : "%",
            digits: 3,
            mode: "increase",
            ...(lowTorque
                ? tolerance.point.lowTorquePvClosureAbsoluteNm
                : tolerance.point.pvClosureUpperPercent)
        }));

        rows.push(
            createRegressionRow({
                group,
                id: `${pointId}-mass-residual`,
                label: "Résidu massique maximal",
                referenceValue: referencePoint.maximumMassResidualPercent,
                currentValue: currentPoint.maximumMassResidualPercent,
                unit: "%",
                digits: 6,
                mode: "increase",
                ...tolerance.point.massResidualUpperPercent
            }),
            createRegressionRow({
                group,
                id: `${pointId}-energy-residual`,
                label: "Résidu énergétique maximal",
                referenceValue: referencePoint.maximumEnergyResidualPercent,
                currentValue: currentPoint.maximumEnergyResidualPercent,
                unit: "%",
                digits: 6,
                mode: "increase",
                ...tolerance.point.energyResidualUpperPercent
            })
        );
    }

    const summary = summarizeValidationStatuses(rows.map(row => row.status));
    if (summary.status === CYCLE_VALIDATION_STATUS.PASS
        && summary.counts.unavailable > 0) {
        summary.status = CYCLE_VALIDATION_STATUS.WARNING;
    }
    const conclusion = summary.status === CYCLE_VALIDATION_STATUS.PASS
        ? "Aucune régression significative détectée par rapport à la référence versionnée."
        : summary.status === CYCLE_VALIDATION_STATUS.WARNING
            ? "La campagne reste exploitable, mais certaines grandeurs ont évolué au-delà de la tolérance nominale."
            : "Régression détectée : au moins une grandeur dépasse la tolérance maximale ou un point est manquant.";

    return {
        generatedAt: new Date().toISOString(),
        status: summary.status,
        counts: summary.counts,
        reference: {
            id: reference.id,
            label: reference.label,
            createdAt: reference.createdAt,
            modelFingerprint: reference.modelFingerprint
        },
        current: {
            reportGeneratedAt: report.generatedAt,
            modelFingerprint: currentFingerprint
        },
        rows,
        conclusion
    };
}

function regressionStatusLabel(status) {
    switch (status) {
        case CYCLE_VALIDATION_STATUS.PASS:
            return "Conforme";
        case CYCLE_VALIDATION_STATUS.WARNING:
            return "Variation";
        case CYCLE_VALIDATION_STATUS.FAIL:
            return "Régression";
        default:
            return "Non comparé";
    }
}


export {
    MODEL_REFERENCE_STORAGE_KEY,
    MODEL_REFERENCE_SCHEMA_VERSION,
    MODEL_REFERENCE_KIND,
    NON_REGRESSION_TOLERANCES,
    hashText,
    modelFingerprint,
    numericTestValue,
    extractReferenceMetrics,
    isCompleteDeterministicReport,
    isCompleteReferenceCandidate,
    createReferenceIdentifier,
    buildModelReference,
    validateModelReference,
    loadModelReference,
    persistModelReference,
    classifyRegressionValue,
    formatRegressionNumber,
    createRegressionRow,
    compareReportWithReference,
    regressionStatusLabel
};
