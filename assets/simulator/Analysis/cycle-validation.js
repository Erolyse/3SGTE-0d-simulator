const PV_TORQUE_CLOSURE_POLICY = Object.freeze({
    excellentRelativeErrorPercent: 0.50,
    validatedRelativeErrorPercent: 0.75,
    warningRelativeErrorPercent: 1.00,
    lowTorqueThresholdNm: 50,
    lowTorqueExcellentAbsoluteErrorNm: 0.30,
    lowTorqueValidatedAbsoluteErrorNm: 0.50,
    lowTorqueWarningAbsoluteErrorNm: 1.00
});

function evaluatePvTorqueClosure(
    torqueFromPvNm,
    indicatedTorqueNm,
    policy = PV_TORQUE_CLOSURE_POLICY
) {
    if (!Number.isFinite(torqueFromPvNm)
        || !Number.isFinite(indicatedTorqueNm)) {
        return {
            status: "unavailable",
            label: "Non exécuté",
            rank: "unavailable",
            basis: "unavailable",
            absoluteErrorNm: NaN,
            relativeErrorPercent: NaN,
            isLowTorque: false
        };
    }

    const absoluteErrorNm = Math.abs(torqueFromPvNm - indicatedTorqueNm);
    const absoluteIndicatedTorqueNm = Math.abs(indicatedTorqueNm);
    const relativeErrorPercent = absoluteIndicatedTorqueNm > 1e-12
        ? absoluteErrorNm / absoluteIndicatedTorqueNm * 100
        : NaN;
    const isLowTorque = absoluteIndicatedTorqueNm < policy.lowTorqueThresholdNm;

    if (isLowTorque) {
        if (absoluteErrorNm <= policy.lowTorqueExcellentAbsoluteErrorNm) {
            return {
                status: "pass",
                label: "Excellent — faible couple",
                rank: "excellent-low-torque",
                basis: "absolute",
                absoluteErrorNm,
                relativeErrorPercent,
                isLowTorque
            };
        }
        if (absoluteErrorNm <= policy.lowTorqueValidatedAbsoluteErrorNm) {
            return {
                status: "pass",
                label: "Validé — faible couple",
                rank: "validated-low-torque",
                basis: "absolute",
                absoluteErrorNm,
                relativeErrorPercent,
                isLowTorque
            };
        }
        if (absoluteErrorNm <= policy.lowTorqueWarningAbsoluteErrorNm) {
            return {
                status: "warning",
                label: "Avertissement — faible couple",
                rank: "warning-low-torque",
                basis: "absolute",
                absoluteErrorNm,
                relativeErrorPercent,
                isLowTorque
            };
        }
        return {
            status: "fail",
            label: "Échec — faible couple",
            rank: "fail-low-torque",
            basis: "absolute",
            absoluteErrorNm,
            relativeErrorPercent,
            isLowTorque
        };
    }

    if (relativeErrorPercent <= policy.excellentRelativeErrorPercent) {
        return {
            status: "pass",
            label: "Excellent",
            rank: "excellent",
            basis: "relative",
            absoluteErrorNm,
            relativeErrorPercent,
            isLowTorque
        };
    }
    if (relativeErrorPercent <= policy.validatedRelativeErrorPercent) {
        return {
            status: "pass",
            label: "Validé",
            rank: "validated",
            basis: "relative",
            absoluteErrorNm,
            relativeErrorPercent,
            isLowTorque
        };
    }
    if (relativeErrorPercent <= policy.warningRelativeErrorPercent) {
        return {
            status: "warning",
            label: "Avertissement",
            rank: "warning",
            basis: "relative",
            absoluteErrorNm,
            relativeErrorPercent,
            isLowTorque
        };
    }
    return {
        status: "fail",
        label: "Échec",
        rank: "fail",
        basis: "relative",
        absoluteErrorNm,
        relativeErrorPercent,
        isLowTorque
    };
}

const {
    CycleValidationReport,
    CYCLE_VALIDATION_STATUS,
    cycleValidationReportToCsv
} = (() => {
    const FULL_CYCLE_DEG = 720;
    const PASCAL_TO_BAR = 1e-5;
    const M3_TO_CM3 = 1e6;
    const FOUR_PI = 4 * Math.PI;
    const EPSILON = 1e-12;

    const CYCLE_VALIDATION_STATUS = Object.freeze({
        PASS: "pass",
        WARNING: "warning",
        FAIL: "fail",
        UNAVAILABLE: "unavailable"
    });

    const DEFAULT_CYCLE_VALIDATION_THRESHOLDS = Object.freeze({
        angleBoundaryToleranceDeg: 0.05,
        angularStepRelativeTolerance: 0.08,
        angularGapMultiplierWarning: 1.35,
        angularGapMultiplierFail: 2.25,
        expectedSampleCountTolerance: 2,
        minimumPressurePa: 1000,
        maximumPressurePa: 25e6,
        minimumTemperatureK: 150,
        maximumTemperatureK: 4500,
        volumeMaximumErrorCm3Pass: 0.05,
        volumeMaximumErrorCm3Warning: 0.25,
        volumeRmsErrorCm3Pass: 0.01,
        volumeRmsErrorCm3Warning: 0.08,
        displacedVolumeRelativeErrorPass: 0.001,
        displacedVolumeRelativeErrorWarning: 0.005,
        landmarkAngleToleranceDeg: 1.0,
        closedValveLiftToleranceMm: 0.03,
        negativeValveLiftToleranceMm: 0.001,
        pvTorqueErrorPercentExcellent: 0.50,
        pvTorqueErrorPercentPass: 0.75,
        pvTorqueErrorPercentWarning: 1.00,
        pvLowTorqueThresholdNm: 50,
        pvLowTorqueAbsoluteErrorNmExcellent: 0.30,
        pvLowTorqueAbsoluteErrorNmPass: 0.50,
        pvLowTorqueAbsoluteErrorNmWarning: 1.00,
        imepClosureErrorBarPass: 1e-8,
        imepClosureErrorBarWarning: 1e-5,
        boundaryPressureRelativeErrorPass: 0.03,
        boundaryPressureRelativeErrorWarning: 0.10,
        rpmSpanPercentPass: 0.75,
        rpmSpanPercentWarning: 2.0,
        repeatabilityCvPercentPass: 0.10,
        repeatabilityCvPercentWarning: 0.50,
        convergenceRelativeChangePercentPass: 0.50,
        convergenceRelativeChangePercentWarning: 1.00,
        convergenceAngleChangeDegPass: 0.15,
        convergenceAngleChangeDegWarning: 0.50,
        convergenceMonotonicToleranceRatio: 1.05,
        ca50MeasurementAgreementDegPass: 0.15,
        ca50MeasurementAgreementDegWarning: 0.50,
        mechanicalClosurePercentPass: 1e-6,
        mechanicalClosurePercentWarning: 1e-3,
        valveDurationMaximumDeg: 400,
        peakPressureAfterCa90ToleranceDeg: 25
    });

    function finite(value, fallback = 0) {
        return Number.isFinite(value) ? value : fallback;
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function normalize720(angleDeg) {
        if (!Number.isFinite(angleDeg)) return NaN;
        if (Math.abs(angleDeg - FULL_CYCLE_DEG) <= 1e-9) return FULL_CYCLE_DEG;
        return ((angleDeg % FULL_CYCLE_DEG) + FULL_CYCLE_DEG) % FULL_CYCLE_DEG;
    }

    function circularDistanceDeg(a, b, period = 360) {
        const difference = Math.abs(a - b) % period;
        return Math.min(difference, period - difference);
    }

    function mean(values) {
        if (!Array.isArray(values) || values.length === 0) return NaN;
        let total = 0;
        let count = 0;
        for (const value of values) {
            if (!Number.isFinite(value)) continue;
            total += value;
            count++;
        }
        return count > 0 ? total / count : NaN;
    }

    function standardDeviation(values) {
        const average = mean(values);
        if (!Number.isFinite(average)) return NaN;
        const finiteValues = values.filter(Number.isFinite);
        if (finiteValues.length < 2) return 0;
        const variance = finiteValues.reduce(
            (sum, value) => sum + (value - average) ** 2,
            0
        ) / (finiteValues.length - 1);
        return Math.sqrt(variance);
    }

    function coefficientOfVariationPercent(values) {
        const average = mean(values);
        if (!Number.isFinite(average) || Math.abs(average) <= EPSILON) return NaN;
        return standardDeviation(values) / Math.abs(average) * 100;
    }

    function percentile(values, p) {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (sorted.length === 0) return NaN;
        const position = clamp(p, 0, 1) * (sorted.length - 1);
        const lower = Math.floor(position);
        const upper = Math.ceil(position);
        if (lower === upper) return sorted[lower];
        const fraction = position - lower;
        return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
    }

    function unwrapAfterReference(angleDeg, referenceDeg = 360) {
        if (!Number.isFinite(angleDeg)) return NaN;
        let value = angleDeg;
        while (value < referenceDeg - 180) value += FULL_CYCLE_DEG;
        while (value > referenceDeg + 540) value -= FULL_CYCLE_DEG;
        return value;
    }

    function makeTest({
        id,
        group,
        label,
        status,
        measured = null,
        expected = null,
        detail = "",
        severity = "normal",
        statusLabel = null,
        diagnostics = null
    }) {
        return {
            id,
            group,
            label,
            status,
            measured,
            expected,
            detail,
            severity,
            statusLabel,
            diagnostics
        };
    }

    function classifyUpper(value, passLimit, warningLimit) {
        if (!Number.isFinite(value)) return CYCLE_VALIDATION_STATUS.UNAVAILABLE;
        if (value <= passLimit) return CYCLE_VALIDATION_STATUS.PASS;
        if (value <= warningLimit) return CYCLE_VALIDATION_STATUS.WARNING;
        return CYCLE_VALIDATION_STATUS.FAIL;
    }

    function classifyRange(value, minimum, maximum) {
        if (!Number.isFinite(value)) return CYCLE_VALIDATION_STATUS.UNAVAILABLE;
        return value >= minimum && value <= maximum
            ? CYCLE_VALIDATION_STATUS.PASS
            : CYCLE_VALIDATION_STATUS.FAIL;
    }

    function summarizeTests(tests) {
        const counts = {
            pass: 0,
            warning: 0,
            fail: 0,
            unavailable: 0
        };

        for (const test of tests) {
            if (counts[test.status] !== undefined) counts[test.status]++;
        }

        const status = counts.fail > 0
            ? CYCLE_VALIDATION_STATUS.FAIL
            : counts.warning > 0
                ? CYCLE_VALIDATION_STATUS.WARNING
                : counts.pass > 0
                    ? CYCLE_VALIDATION_STATUS.PASS
                    : CYCLE_VALIDATION_STATUS.UNAVAILABLE;

        return { status, counts };
    }

    function cycleSamples(cycle) {
        return Array.isArray(cycle?.samples)
            ? cycle.samples.filter(sample => sample && typeof sample === "object")
            : [];
    }

    function computePvMetrics(samples, {
        sweptVolumeM3,
        cylinderCount,
        getGeometricVolumeM3
    }) {
        if (samples.length < 2
            || !Number.isFinite(sweptVolumeM3)
            || sweptVolumeM3 <= 0
            || typeof getGeometricVolumeM3 !== "function") {
            return null;
        }

        let netWorkJ = 0;
        let closedWorkJ = 0;
        let pumpingWorkJ = 0;

        for (let index = 1; index < samples.length; index++) {
            const previous = samples[index - 1];
            const current = samples[index];
            const previousVolume = getGeometricVolumeM3(previous.angleDeg);
            const currentVolume = getGeometricVolumeM3(current.angleDeg);
            const meanPressurePa = 0.5 * (
                finite(previous.cylinderPressurePa)
                + finite(current.cylinderPressurePa)
            );
            const segmentWorkJ = meanPressurePa * (currentVolume - previousVolume);
            const closed = !previous.intakeValveOpen
                && !previous.exhaustValveOpen
                && !current.intakeValveOpen
                && !current.exhaustValveOpen;

            netWorkJ += segmentWorkJ;
            if (closed) closedWorkJ += segmentWorkJ;
            else pumpingWorkJ += segmentWorkJ;
        }

        const netImepBar = netWorkJ / sweptVolumeM3 * PASCAL_TO_BAR;
        const grossImepBar = closedWorkJ / sweptVolumeM3 * PASCAL_TO_BAR;
        const pmepBar = pumpingWorkJ / sweptVolumeM3 * PASCAL_TO_BAR;
        const torqueFromPvNm = netWorkJ * cylinderCount / FOUR_PI;
        const meanIndicatedTorqueNm = mean(
            samples.slice(0, -1).map(sample => sample.indicatedTorqueNm)
        );
        const consistencyErrorNm = Math.abs(
            torqueFromPvNm - meanIndicatedTorqueNm
        );
        const consistencyErrorPercent = Math.abs(meanIndicatedTorqueNm) > EPSILON
            ? consistencyErrorNm / Math.abs(meanIndicatedTorqueNm) * 100
            : NaN;

        return {
            netWorkJ,
            closedWorkJ,
            pumpingWorkJ,
            netImepBar,
            grossImepBar,
            pmepBar,
            torqueFromPvNm,
            meanIndicatedTorqueNm,
            consistencyErrorNm,
            consistencyErrorPercent,
            imepClosureErrorBar: Math.abs(
                netImepBar - (grossImepBar + pmepBar)
            )
        };
    }

    function validateRepeatability(history, options, thresholds) {
        const cycles = (history ?? [])
            .filter(cycle => cycleSamples(cycle).length >= 2)
            .slice(-10);

        if (cycles.length < 3) {
            return makeTest({
                id: "repeatability",
                group: "Répétabilité",
                label: "Dispersion sur plusieurs cycles",
                status: CYCLE_VALIDATION_STATUS.UNAVAILABLE,
                measured: `${cycles.length} cycle(s) disponible(s)`,
                expected: "3 cycles minimum",
                detail: "Le contrôle sera calculé automatiquement lorsque l’historique contiendra au moins trois cycles complets."
            });
        }

        const imepValues = [];
        const torqueValues = [];
        const peakPressureValues = [];
        const ca50Values = [];

        for (const cycle of cycles) {
            const metrics = computePvMetrics(cycleSamples(cycle), options);
            if (metrics) {
                imepValues.push(metrics.netImepBar);
                torqueValues.push(metrics.torqueFromPvNm);
            }
            peakPressureValues.push(cycle?.summary?.peakPressurePa * PASCAL_TO_BAR);
            ca50Values.push(cycle?.events?.ca50Deg);
        }

        const cvValues = [
            coefficientOfVariationPercent(imepValues),
            coefficientOfVariationPercent(torqueValues),
            coefficientOfVariationPercent(peakPressureValues),
            coefficientOfVariationPercent(ca50Values)
        ].filter(Number.isFinite);
        const maximumCvPercent = cvValues.length > 0 ? Math.max(...cvValues) : NaN;
        const status = classifyUpper(
            maximumCvPercent,
            thresholds.repeatabilityCvPercentPass,
            thresholds.repeatabilityCvPercentWarning
        );

        return makeTest({
            id: "repeatability",
            group: "Répétabilité",
            label: "Dispersion sur plusieurs cycles",
            status,
            measured: Number.isFinite(maximumCvPercent)
                ? `${maximumCvPercent.toFixed(3)} % (CV max)`
                : "Indisponible",
            expected: `≤ ${thresholds.repeatabilityCvPercentPass.toFixed(2)} %`,
            detail: `${cycles.length} cycles comparés : IMEP, couple P-V, pic de pression et CA50.`
        });
    }

    function validateConvergence(convergenceCycles, options, thresholds) {
        const entries = Object.entries(convergenceCycles ?? {})
            .map(([step, cycle]) => ({ step: Number(step), cycle }))
            .filter(entry =>
                Number.isFinite(entry.step)
                && cycleSamples(entry.cycle).length >= 2
            )
            .sort((a, b) => b.step - a.step);

        const findStep = target => entries.find(
            entry => Math.abs(entry.step - target) <= 1e-9
        );
        const coarse = findStep(1);
        const medium = findStep(0.5);
        const fine = findStep(0.25);

        if (!coarse || !medium || !fine) {
            return makeTest({
                id: "convergence",
                group: "Convergence",
                label: "Convergence sur trois résolutions",
                status: CYCLE_VALIDATION_STATUS.UNAVAILABLE,
                measured: `${entries.length} résolution(s) exploitable(s)`,
                expected: "1,00° + 0,50° + 0,25°",
                detail: "Les trois niveaux sont nécessaires pour vérifier la contraction E₂ < E₁ et estimer un ordre apparent."
            });
        }

        const buildMetrics = entry => {
            const samples = cycleSamples(entry.cycle);
            const pv = computePvMetrics(samples, options);
            if (!pv) return null;
            return {
                torquePvNm: pv.torqueFromPvNm,
                netImepBar: pv.netImepBar,
                peakPressurePa: entry.cycle?.summary?.peakPressurePa,
                peakPressureAngleDeg:
                    entry.cycle?.summary?.peakPressureAngleDeg,
                ca50MeasuredDeg:
                    entry.cycle?.events?.ca50MeasuredDeg
                    ?? entry.cycle?.events?.ca50Deg,
                meanBoostBar:
                    entry.cycle?.summary?.meanBoostBarGauge,
                meanTurboRpm: mean(
                    samples.map(sample => sample?.turboRPM)
                )
            };
        };

        const q1 = buildMetrics(coarse);
        const q05 = buildMetrics(medium);
        const q025 = buildMetrics(fine);
        if (!q1 || !q05 || !q025) {
            return makeTest({
                id: "convergence",
                group: "Convergence",
                label: "Convergence sur trois résolutions",
                status: CYCLE_VALIDATION_STATUS.UNAVAILABLE,
                measured: "Calcul impossible",
                expected: "Cycles complets et géométrie disponible"
            });
        }

        const metricDefinitions = [
            {
                key: "torquePvNm",
                label: "Couple P-V",
                unit: "N·m",
                mode: "relative"
            },
            {
                key: "netImepBar",
                label: "IMEP",
                unit: "bar",
                mode: "relative"
            },
            {
                key: "peakPressurePa",
                label: "Pmax",
                unit: "Pa",
                mode: "relative"
            },
            {
                key: "peakPressureAngleDeg",
                label: "Angle Pmax",
                unit: "°CA",
                mode: "angle"
            },
            {
                key: "ca50MeasuredDeg",
                label: "CA50 mesuré",
                unit: "°CA",
                mode: "angle"
            },
            {
                key: "meanBoostBar",
                label: "Boost",
                unit: "bar",
                mode: "relative"
            },
            {
                key: "meanTurboRpm",
                label: "Régime turbo",
                unit: "tr/min",
                mode: "relative"
            }
        ];

        const diagnostics = [];
        let overallStatus = CYCLE_VALIDATION_STATUS.PASS;

        const worsenStatus = status => {
            const rank = {
                [CYCLE_VALIDATION_STATUS.PASS]: 0,
                [CYCLE_VALIDATION_STATUS.WARNING]: 1,
                [CYCLE_VALIDATION_STATUS.FAIL]: 2,
                [CYCLE_VALIDATION_STATUS.UNAVAILABLE]: 1
            };
            if (rank[status] > rank[overallStatus]) {
                overallStatus = status;
            }
        };

        for (const definition of metricDefinitions) {
            const a = q1[definition.key];
            const b = q05[definition.key];
            const c = q025[definition.key];
            if (![a, b, c].every(Number.isFinite)) {
                diagnostics.push({
                    ...definition,
                    available: false
                });
                worsenStatus(CYCLE_VALIDATION_STATUS.WARNING);
                continue;
            }

            const e1 = Math.abs(a - b);
            const e2 = Math.abs(b - c);
            const scale = Math.max(Math.abs(c), EPSILON);
            const e2RelativePercent = e2 / scale * 100;
            const noiseFloor = definition.mode === "angle"
                ? 1e-7
                : scale * 1e-9;
            const effectivelyIdentical = e1 <= noiseFloor
                && e2 <= noiseFloor;
            const monotonic = effectivelyIdentical
                || e2 <= e1
                    * thresholds.convergenceMonotonicToleranceRatio
                    + noiseFloor;

            let apparentOrder = NaN;
            if (e1 > noiseFloor && e2 > noiseFloor) {
                apparentOrder = Math.log(e1 / e2) / Math.log(2);
            }

            let metricStatus;
            if (definition.mode === "angle") {
                metricStatus = classifyUpper(
                    e2,
                    thresholds.convergenceAngleChangeDegPass,
                    thresholds.convergenceAngleChangeDegWarning
                );
            } else {
                metricStatus = classifyUpper(
                    e2RelativePercent,
                    thresholds.convergenceRelativeChangePercentPass,
                    thresholds.convergenceRelativeChangePercentWarning
                );
            }

            // Une faible variation 0,5°→0,25° mais sans contraction des erreurs
            // reste exploitable, mais ne mérite pas un statut "validé".
            if (!monotonic
                && metricStatus === CYCLE_VALIDATION_STATUS.PASS) {
                metricStatus = CYCLE_VALIDATION_STATUS.WARNING;
            }
            worsenStatus(metricStatus);

            diagnostics.push({
                ...definition,
                available: true,
                q1: a,
                q05: b,
                q025: c,
                e1,
                e2,
                e2RelativePercent,
                monotonic,
                apparentOrder,
                status: metricStatus
            });
        }

        const available = diagnostics.filter(item => item.available);
        if (available.length === 0) {
            overallStatus = CYCLE_VALIDATION_STATUS.UNAVAILABLE;
        }

        const monotonicCount = available.filter(item => item.monotonic).length;
        const relativeChanges = available
            .filter(item => item.mode === "relative")
            .map(item => item.e2RelativePercent)
            .filter(Number.isFinite);
        const angleChanges = available
            .filter(item => item.mode === "angle")
            .map(item => item.e2)
            .filter(Number.isFinite);
        const finiteOrders = available
            .map(item => item.apparentOrder)
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        const medianOrder = finiteOrders.length
            ? finiteOrders[Math.floor(finiteOrders.length / 2)]
            : NaN;

        const maxRelative = relativeChanges.length
            ? Math.max(...relativeChanges)
            : NaN;
        const maxAngle = angleChanges.length
            ? Math.max(...angleChanges)
            : NaN;

        const compactDetail = available.map(item => {
            const e1Text = item.mode === "angle"
                ? `${item.e1.toFixed(3)}°`
                : `${(item.e1 / Math.max(Math.abs(item.q05), EPSILON) * 100).toFixed(3)} %`;
            const e2Text = item.mode === "angle"
                ? `${item.e2.toFixed(3)}°`
                : `${item.e2RelativePercent.toFixed(3)} %`;
            const pText = Number.isFinite(item.apparentOrder)
                ? item.apparentOrder.toFixed(2)
                : "≈";
            return `${item.label}: E₁ ${e1Text}, E₂ ${e2Text}, p ${pText}${item.monotonic ? "" : " [non monotone]"}`;
        }).join(" · ");

        return makeTest({
            id: "convergence",
            group: "Convergence",
            label: "Convergence 1° / 0,5° / 0,25°",
            status: overallStatus,
            measured:
                `${monotonicCount}/${available.length} métrique(s) avec E₂ ≤ E₁`
                + (Number.isFinite(maxRelative)
                    ? ` · Δfin max ${maxRelative.toFixed(3)} %`
                    : "")
                + (Number.isFinite(maxAngle)
                    ? ` · Δangle max ${maxAngle.toFixed(3)}°`
                    : "")
                + (Number.isFinite(medianOrder)
                    ? ` · p médian ${medianOrder.toFixed(2)}`
                    : ""),
            expected:
                `E₂ ≤ E₁ · `
                + `Δfin ≤ ${thresholds.convergenceRelativeChangePercentPass.toFixed(2)} %`
                + ` ou ≤ ${thresholds.convergenceAngleChangeDegPass.toFixed(2)}° pour les angles`,
            detail: compactDetail,
            diagnostics
        });
    }

    function validateEngineCycle(cycle, {
        sweptVolumeM3,
        cylinderCount = 4,
        getGeometricVolumeM3,
        cycleHistory = [],
        convergenceCycles = null,
        thresholds: thresholdOverrides = {}
    } = {}) {
        const thresholds = {
            ...DEFAULT_CYCLE_VALIDATION_THRESHOLDS,
            ...thresholdOverrides
        };
        const samples = cycleSamples(cycle);
        const tests = [];
        const now = new Date().toISOString();

        if (samples.length < 2) {
            tests.push(makeTest({
                id: "cycle-available",
                group: "Acquisition",
                label: "Cycle 720° disponible",
                status: CYCLE_VALIDATION_STATUS.FAIL,
                measured: `${samples.length} point(s)`,
                expected: "Cycle complet",
                detail: "Aucun rapport scientifique ne peut être produit sans cycle complet."
            }));
            const summary = summarizeTests(tests);
            return {
                generatedAt: now,
                status: summary.status,
                counts: summary.counts,
                tests,
                metrics: null,
                conclusion: "Validation impossible : aucun cycle complet n’est disponible."
            };
        }

        const angles = samples.map(sample => finite(sample.angleDeg, NaN));
        const firstAngle = angles[0];
        const lastAngle = angles.at(-1);
        const angularSteps = [];
        let duplicateCount = 0;
        let reverseCount = 0;
        for (let index = 1; index < angles.length; index++) {
            const step = angles[index] - angles[index - 1];
            if (Math.abs(step) <= 1e-9) duplicateCount++;
            if (step < -1e-9) reverseCount++;
            if (step > 1e-9) angularSteps.push(step);
        }

        const nominalStepDeg = finite(
            cycle?.angularStepDeg,
            percentile(angularSteps, 0.5)
        );
        const expectedSampleCount = Number.isFinite(nominalStepDeg) && nominalStepDeg > 0
            ? Math.round(FULL_CYCLE_DEG / nominalStepDeg) + 1
            : NaN;
        const maximumAngularGapDeg = angularSteps.length > 0
            ? Math.max(...angularSteps)
            : NaN;
        const medianAngularStepDeg = percentile(angularSteps, 0.5);
        const stepRelativeError = nominalStepDeg > 0
            ? Math.abs(medianAngularStepDeg - nominalStepDeg) / nominalStepDeg
            : NaN;

        const boundaryErrorDeg = Math.max(
            Math.abs(firstAngle),
            Math.abs(lastAngle - FULL_CYCLE_DEG)
        );
        tests.push(makeTest({
            id: "cycle-coverage",
            group: "Acquisition",
            label: "Couverture angulaire 0–720°",
            status: classifyUpper(
                boundaryErrorDeg,
                thresholds.angleBoundaryToleranceDeg,
                thresholds.angleBoundaryToleranceDeg * 4
            ),
            measured: `${firstAngle.toFixed(3)}° → ${lastAngle.toFixed(3)}°`,
            expected: `0° → 720° ± ${thresholds.angleBoundaryToleranceDeg}°`
        }));

        const sampleCountError = Number.isFinite(expectedSampleCount)
            ? Math.abs(samples.length - expectedSampleCount)
            : Infinity;
        tests.push(makeTest({
            id: "sample-count",
            group: "Acquisition",
            label: "Résolution du cycle",
            status: sampleCountError <= thresholds.expectedSampleCountTolerance
                ? CYCLE_VALIDATION_STATUS.PASS
                : sampleCountError <= thresholds.expectedSampleCountTolerance * 4
                    ? CYCLE_VALIDATION_STATUS.WARNING
                    : CYCLE_VALIDATION_STATUS.FAIL,
            measured: `${samples.length} points à ${nominalStepDeg.toFixed(3)}°`,
            expected: Number.isFinite(expectedSampleCount)
                ? `${expectedSampleCount} ± ${thresholds.expectedSampleCountTolerance} points`
                : "Pas angulaire connu"
        }));

        const gapStatus = !Number.isFinite(maximumAngularGapDeg)
            ? CYCLE_VALIDATION_STATUS.FAIL
            : maximumAngularGapDeg <= nominalStepDeg * thresholds.angularGapMultiplierWarning
                && stepRelativeError <= thresholds.angularStepRelativeTolerance
                && duplicateCount === 0
                && reverseCount === 0
                ? CYCLE_VALIDATION_STATUS.PASS
                : maximumAngularGapDeg <= nominalStepDeg * thresholds.angularGapMultiplierFail
                    && reverseCount === 0
                    ? CYCLE_VALIDATION_STATUS.WARNING
                    : CYCLE_VALIDATION_STATUS.FAIL;
        tests.push(makeTest({
            id: "angle-continuity",
            group: "Acquisition",
            label: "Continuité et monotonie angulaire",
            status: gapStatus,
            measured: `pas médian ${medianAngularStepDeg.toFixed(3)}° · trou max ${maximumAngularGapDeg.toFixed(3)}°`,
            expected: `aucun doublon, aucun retour, trou ≤ ${(nominalStepDeg * thresholds.angularGapMultiplierWarning).toFixed(3)}°`,
            detail: `${duplicateCount} doublon(s), ${reverseCount} retour(s) angulaire(s).`
        }));

        const requiredNumericKeys = [
            "angleDeg",
            "cylinderPressurePa",
            "cylinderVolumeM3",
            "cylinderTemperatureK",
            "intakeValveLiftM",
            "exhaustValveLiftM"
        ];
        let invalidValueCount = 0;
        for (const sample of samples) {
            for (const key of requiredNumericKeys) {
                if (!Number.isFinite(sample?.[key])) invalidValueCount++;
            }
        }
        tests.push(makeTest({
            id: "numeric-validity",
            group: "Acquisition",
            label: "Validité numérique des échantillons",
            status: invalidValueCount === 0
                ? CYCLE_VALIDATION_STATUS.PASS
                : CYCLE_VALIDATION_STATUS.FAIL,
            measured: `${invalidValueCount} valeur(s) invalide(s)`,
            expected: "0 NaN / Infinity"
        }));

        const pressures = samples.map(sample => sample.cylinderPressurePa);
        const temperatures = samples.map(sample => sample.cylinderTemperatureK);
        const pressureRangeStatus = pressures.every(value =>
            Number.isFinite(value)
            && value >= thresholds.minimumPressurePa
            && value <= thresholds.maximumPressurePa
        ) ? CYCLE_VALIDATION_STATUS.PASS : CYCLE_VALIDATION_STATUS.FAIL;
        tests.push(makeTest({
            id: "pressure-range",
            group: "Thermodynamique",
            label: "Plage de pression physique",
            status: pressureRangeStatus,
            measured: `${(Math.min(...pressures) * PASCAL_TO_BAR).toFixed(3)}–${(Math.max(...pressures) * PASCAL_TO_BAR).toFixed(1)} bar abs.`,
            expected: `${(thresholds.minimumPressurePa * PASCAL_TO_BAR).toFixed(3)}–${(thresholds.maximumPressurePa * PASCAL_TO_BAR).toFixed(0)} bar abs.`
        }));

        const temperatureRangeStatus = temperatures.every(value =>
            Number.isFinite(value)
            && value >= thresholds.minimumTemperatureK
            && value <= thresholds.maximumTemperatureK
        ) ? CYCLE_VALIDATION_STATUS.PASS : CYCLE_VALIDATION_STATUS.FAIL;
        tests.push(makeTest({
            id: "temperature-range",
            group: "Thermodynamique",
            label: "Plage de température physique",
            status: temperatureRangeStatus,
            measured: `${(Math.min(...temperatures) - 273.15).toFixed(0)}–${(Math.max(...temperatures) - 273.15).toFixed(0)} °C`,
            expected: `${(thresholds.minimumTemperatureK - 273.15).toFixed(0)}–${(thresholds.maximumTemperatureK - 273.15).toFixed(0)} °C`
        }));

        const geometricVolumes = [];
        const recordedVolumes = [];
        const geometryErrorsCm3 = [];
        if (typeof getGeometricVolumeM3 === "function") {
            for (const sample of samples) {
                const geometricVolumeM3 = getGeometricVolumeM3(sample.angleDeg);
                geometricVolumes.push(geometricVolumeM3);
                recordedVolumes.push(sample.cylinderVolumeM3);
                geometryErrorsCm3.push(
                    Math.abs(sample.cylinderVolumeM3 - geometricVolumeM3) * M3_TO_CM3
                );
            }
        }

        if (geometryErrorsCm3.length === samples.length) {
            const maximumGeometryErrorCm3 = Math.max(...geometryErrorsCm3);
            const rmsGeometryErrorCm3 = Math.sqrt(mean(
                geometryErrorsCm3.map(value => value ** 2)
            ));
            const geometryStatus = maximumGeometryErrorCm3 <= thresholds.volumeMaximumErrorCm3Pass
                && rmsGeometryErrorCm3 <= thresholds.volumeRmsErrorCm3Pass
                ? CYCLE_VALIDATION_STATUS.PASS
                : maximumGeometryErrorCm3 <= thresholds.volumeMaximumErrorCm3Warning
                    && rmsGeometryErrorCm3 <= thresholds.volumeRmsErrorCm3Warning
                    ? CYCLE_VALIDATION_STATUS.WARNING
                    : CYCLE_VALIDATION_STATUS.FAIL;
            tests.push(makeTest({
                id: "geometry-volume",
                group: "Géométrie",
                label: "Volume enregistré / géométrie",
                status: geometryStatus,
                measured: `max ${maximumGeometryErrorCm3.toFixed(4)} cm³ · RMS ${rmsGeometryErrorCm3.toFixed(4)} cm³`,
                expected: `max ≤ ${thresholds.volumeMaximumErrorCm3Pass} cm³ · RMS ≤ ${thresholds.volumeRmsErrorCm3Pass} cm³`
            }));

            const minimumVolumeM3 = Math.min(...geometricVolumes);
            const maximumVolumeM3 = Math.max(...geometricVolumes);
            const measuredDisplacementM3 = maximumVolumeM3 - minimumVolumeM3;
            const displacementRelativeError = Number.isFinite(sweptVolumeM3) && sweptVolumeM3 > 0
                ? Math.abs(measuredDisplacementM3 - sweptVolumeM3) / sweptVolumeM3
                : NaN;
            const displacementStatus = classifyUpper(
                displacementRelativeError,
                thresholds.displacedVolumeRelativeErrorPass,
                thresholds.displacedVolumeRelativeErrorWarning
            );
            tests.push(makeTest({
                id: "displaced-volume",
                group: "Géométrie",
                label: "Cylindrée unitaire reconstruite",
                status: displacementStatus,
                measured: `${(measuredDisplacementM3 * M3_TO_CM3).toFixed(3)} cm³`,
                expected: Number.isFinite(sweptVolumeM3)
                    ? `${(sweptVolumeM3 * M3_TO_CM3).toFixed(3)} cm³`
                    : "Cylindrée configurée"
            }));

            const minimumIndex = geometricVolumes.indexOf(minimumVolumeM3);
            const maximumIndex = geometricVolumes.indexOf(maximumVolumeM3);
            const minimumAngle = normalize720(samples[minimumIndex]?.angleDeg);
            const maximumAngle = normalize720(samples[maximumIndex]?.angleDeg);
            const minimumDistance = Math.min(
                circularDistanceDeg(minimumAngle % 360, 0, 360),
                circularDistanceDeg(minimumAngle % 360, 360, 360)
            );
            const maximumDistance = circularDistanceDeg(maximumAngle % 360, 180, 360);
            const landmarkErrorDeg = Math.max(minimumDistance, maximumDistance);
            tests.push(makeTest({
                id: "geometry-landmarks",
                group: "Géométrie",
                label: "Repères PMH / PMB",
                status: classifyUpper(
                    landmarkErrorDeg,
                    thresholds.landmarkAngleToleranceDeg,
                    thresholds.landmarkAngleToleranceDeg * 3
                ),
                measured: `Vmin à ${minimumAngle.toFixed(2)}° · Vmax à ${maximumAngle.toFixed(2)}°`,
                expected: "PMH à 0/360/720° · PMB à 180/540°"
            }));
        } else {
            tests.push(makeTest({
                id: "geometry-volume",
                group: "Géométrie",
                label: "Volume enregistré / géométrie",
                status: CYCLE_VALIDATION_STATUS.UNAVAILABLE,
                measured: "Fonction géométrique absente",
                expected: "getGeometricVolumeM3(angle)"
            }));
        }

        const events = cycle?.events ?? {};
        const ca10 = unwrapAfterReference(events.ca10Deg);
        const ca50 = unwrapAfterReference(events.ca50Deg);
        const ca90 = unwrapAfterReference(events.ca90Deg);
        const ignition = unwrapAfterReference(events.ignitionStartDeg);
        const eventsAvailable = [ignition, ca10, ca50, ca90].every(Number.isFinite);
        const eventOrderValid = eventsAvailable
            && ignition <= ca10
            && ca10 < ca50
            && ca50 < ca90;
        tests.push(makeTest({
            id: "combustion-events",
            group: "Combustion",
            label: "Ordre allumage / CA10 / CA50 / CA90",
            status: !eventsAvailable
                ? CYCLE_VALIDATION_STATUS.UNAVAILABLE
                : eventOrderValid
                    ? CYCLE_VALIDATION_STATUS.PASS
                    : CYCLE_VALIDATION_STATUS.FAIL,
            measured: eventsAvailable
                ? `${ignition.toFixed(1)}° · ${ca10.toFixed(1)}° · ${ca50.toFixed(1)}° · ${ca90.toFixed(1)}°`
                : "Événements incomplets",
            expected: "allumage ≤ CA10 < CA50 < CA90"
        }));

        const ca50Measured = unwrapAfterReference(
            events.ca50MeasuredDeg ?? events.ca50Deg
        );
        const ca50Model = unwrapAfterReference(events.ca50ModelDeg);
        const ca50Target = unwrapAfterReference(events.ca50TargetDeg);
        const ca50MeasurementDifferenceDeg =
            Number.isFinite(ca50Measured) && Number.isFinite(ca50Model)
                ? Math.abs(ca50Measured - ca50Model)
                : NaN;
        tests.push(makeTest({
            id: "combustion-ca50-measurement",
            group: "Combustion",
            label: "CA50 mesuré / loi de Wiebe",
            status: classifyUpper(
                ca50MeasurementDifferenceDeg,
                thresholds.ca50MeasurementAgreementDegPass,
                thresholds.ca50MeasurementAgreementDegWarning
            ),
            measured: Number.isFinite(ca50MeasurementDifferenceDeg)
                ? `mesuré ${ca50Measured.toFixed(2)}° · modèle ${ca50Model.toFixed(2)}° · Δ ${ca50MeasurementDifferenceDeg.toFixed(3)}°`
                : "Mesure indépendante indisponible",
            expected:
                `Δ ≤ ${thresholds.ca50MeasurementAgreementDegPass.toFixed(2)}° validé`,
            detail: Number.isFinite(ca50Target)
                ? `Cible contrôleur : ${ca50Target.toFixed(2)}°. Le statut compare uniquement le franchissement xb=0,5 réellement enregistré à la position analytique de Wiebe.`
                : "Le statut compare le franchissement xb=0,5 réellement enregistré à la position analytique de Wiebe."
        }));

        const peakPressureSample = samples.reduce((peak, sample) =>
            finite(sample.cylinderPressurePa) > finite(peak?.cylinderPressurePa)
                ? sample
                : peak,
        samples[0]);
        const peakPressureAngle = unwrapAfterReference(peakPressureSample?.angleDeg);
        const peakTimingAvailable = eventsAvailable && Number.isFinite(peakPressureAngle);
        const peakTimingValid = peakTimingAvailable
            && peakPressureAngle >= ignition
            && peakPressureAngle <= ca90 + thresholds.peakPressureAfterCa90ToleranceDeg;
        tests.push(makeTest({
            id: "peak-pressure-timing",
            group: "Combustion",
            label: "Position du pic de pression",
            status: !peakTimingAvailable
                ? CYCLE_VALIDATION_STATUS.UNAVAILABLE
                : peakTimingValid
                    ? CYCLE_VALIDATION_STATUS.PASS
                    : CYCLE_VALIDATION_STATUS.WARNING,
            measured: Number.isFinite(peakPressureAngle)
                ? `${peakPressureAngle.toFixed(1)}° CA · ${(finite(peakPressureSample?.cylinderPressurePa) * PASCAL_TO_BAR).toFixed(1)} bar`
                : "Indisponible",
            expected: `entre l’allumage et CA90 + ${thresholds.peakPressureAfterCa90ToleranceDeg}°`
        }));

        const valveEventValues = [
            events.intakeValveOpenDeg,
            events.intakeValveCloseDeg,
            events.exhaustValveOpenDeg,
            events.exhaustValveCloseDeg
        ];
        const valveEventsAvailable = valveEventValues.every(Number.isFinite);
        const cyclicDuration = (openDeg, closeDeg) =>
            ((closeDeg - openDeg) % FULL_CYCLE_DEG + FULL_CYCLE_DEG) % FULL_CYCLE_DEG;
        const intakeDurationDeg = valveEventsAvailable
            ? cyclicDuration(events.intakeValveOpenDeg, events.intakeValveCloseDeg)
            : NaN;
        const exhaustDurationDeg = valveEventsAvailable
            ? cyclicDuration(events.exhaustValveOpenDeg, events.exhaustValveCloseDeg)
            : NaN;
        const valveEventsValid = valveEventsAvailable
            && intakeDurationDeg > 0
            && intakeDurationDeg <= thresholds.valveDurationMaximumDeg
            && exhaustDurationDeg > 0
            && exhaustDurationDeg <= thresholds.valveDurationMaximumDeg;
        tests.push(makeTest({
            id: "valve-events",
            group: "Distribution",
            label: "Événements de distribution",
            status: !valveEventsAvailable
                ? CYCLE_VALIDATION_STATUS.UNAVAILABLE
                : valveEventsValid
                    ? CYCLE_VALIDATION_STATUS.PASS
                    : CYCLE_VALIDATION_STATUS.FAIL,
            measured: valveEventsAvailable
                ? `admission ${intakeDurationDeg.toFixed(1)}° · échappement ${exhaustDurationDeg.toFixed(1)}°`
                : "Événements incomplets",
            expected: `durées cycliques comprises entre 0° et ${thresholds.valveDurationMaximumDeg}°`
        }));

        const intakeLiftsMm = samples.map(sample => finite(sample.intakeValveLiftM) * 1000);
        const exhaustLiftsMm = samples.map(sample => finite(sample.exhaustValveLiftM) * 1000);
        const minimumValveLiftMm = Math.min(...intakeLiftsMm, ...exhaustLiftsMm);
        const closedValveLeakMm = Math.max(
            ...samples.map(sample => !sample.intakeValveOpen
                ? Math.max(finite(sample.intakeValveLiftM) * 1000, 0)
                : 0),
            ...samples.map(sample => !sample.exhaustValveOpen
                ? Math.max(finite(sample.exhaustValveLiftM) * 1000, 0)
                : 0)
        );
        const valveStatus = minimumValveLiftMm >= -thresholds.negativeValveLiftToleranceMm
            && closedValveLeakMm <= thresholds.closedValveLiftToleranceMm
            ? CYCLE_VALIDATION_STATUS.PASS
            : minimumValveLiftMm >= -thresholds.negativeValveLiftToleranceMm * 4
                && closedValveLeakMm <= thresholds.closedValveLiftToleranceMm * 4
                ? CYCLE_VALIDATION_STATUS.WARNING
                : CYCLE_VALIDATION_STATUS.FAIL;
        tests.push(makeTest({
            id: "valve-lifts",
            group: "Distribution",
            label: "Levées de soupapes",
            status: valveStatus,
            measured: `min ${minimumValveLiftMm.toFixed(4)} mm · fuite fermée ${closedValveLeakMm.toFixed(4)} mm`,
            expected: `levée ≥ 0 · fermée ≤ ${thresholds.closedValveLiftToleranceMm} mm`
        }));

        const meanClosedCycleTorqueNm = mean(
            samples.slice(0, -1).map(sample => sample.closedCycleTorqueNm)
        );
        const meanPumpingTorqueNm = mean(
            samples.slice(0, -1).map(sample => sample.pumpingTorqueNm)
        );
        const meanIndicatedTorqueForClosureNm = mean(
            samples.slice(0, -1).map(sample => sample.indicatedTorqueNm)
        );
        const mechanicalClosureErrorPercent = Math.abs(meanIndicatedTorqueForClosureNm) > EPSILON
            ? Math.abs(
                meanClosedCycleTorqueNm
                + meanPumpingTorqueNm
                - meanIndicatedTorqueForClosureNm
            ) / Math.abs(meanIndicatedTorqueForClosureNm) * 100
            : NaN;
        tests.push(makeTest({
            id: "mechanical-indicated-closure",
            group: "Mécanique",
            label: "Fermeture du couple indiqué",
            status: classifyUpper(
                mechanicalClosureErrorPercent,
                thresholds.mechanicalClosurePercentPass,
                thresholds.mechanicalClosurePercentWarning
            ),
            measured: Number.isFinite(mechanicalClosureErrorPercent)
                ? `${meanClosedCycleTorqueNm.toFixed(2)} + ${meanPumpingTorqueNm.toFixed(2)} = ${meanIndicatedTorqueForClosureNm.toFixed(2)} N·m · écart ${mechanicalClosureErrorPercent.toExponential(2)} %`
                : "Données de couple indisponibles",
            expected: "couple fermé + pompage signé = couple indiqué"
        }));

        const pvMetrics = computePvMetrics(samples, {
            sweptVolumeM3,
            cylinderCount,
            getGeometricVolumeM3
        });

        if (pvMetrics) {
            tests.push(makeTest({
                id: "pv-work-signs",
                group: "P-V",
                label: "Sens du travail thermodynamique",
                status: pvMetrics.netWorkJ > 0 && pvMetrics.closedWorkJ > 0
                    ? pvMetrics.pumpingWorkJ <= 0
                        ? CYCLE_VALIDATION_STATUS.PASS
                        : CYCLE_VALIDATION_STATUS.WARNING
                    : CYCLE_VALIDATION_STATUS.FAIL,
                measured: `fermé ${pvMetrics.closedWorkJ.toFixed(1)} J · pompage ${pvMetrics.pumpingWorkJ.toFixed(1)} J · net ${pvMetrics.netWorkJ.toFixed(1)} J`,
                expected: "travail fermé > 0 · travail net > 0",
                detail: pvMetrics.pumpingWorkJ > 0
                    ? "Le pompage est positif sur ce point ; cela peut être physique sous forte suralimentation, mais doit être interprété."
                    : "Le travail de pompage est signé négativement."
            }));

            tests.push(makeTest({
                id: "imep-closure",
                group: "P-V",
                label: "Fermeture IMEP",
                status: classifyUpper(
                    pvMetrics.imepClosureErrorBar,
                    thresholds.imepClosureErrorBarPass,
                    thresholds.imepClosureErrorBarWarning
                ),
                measured: `${pvMetrics.imepClosureErrorBar.toExponential(3)} bar`,
                expected: `≤ ${thresholds.imepClosureErrorBarPass.toExponential(1)} bar`,
                detail: "IMEP net = IMEP cycle fermé + PMEP signé."
            }));

            const pvClosureAssessment = evaluatePvTorqueClosure(
                pvMetrics.torqueFromPvNm,
                pvMetrics.meanIndicatedTorqueNm,
                {
                    excellentRelativeErrorPercent:
                        thresholds.pvTorqueErrorPercentExcellent,
                    validatedRelativeErrorPercent:
                        thresholds.pvTorqueErrorPercentPass,
                    warningRelativeErrorPercent:
                        thresholds.pvTorqueErrorPercentWarning,
                    lowTorqueThresholdNm:
                        thresholds.pvLowTorqueThresholdNm,
                    lowTorqueExcellentAbsoluteErrorNm:
                        thresholds.pvLowTorqueAbsoluteErrorNmExcellent,
                    lowTorqueValidatedAbsoluteErrorNm:
                        thresholds.pvLowTorqueAbsoluteErrorNmPass,
                    lowTorqueWarningAbsoluteErrorNm:
                        thresholds.pvLowTorqueAbsoluteErrorNmWarning
                }
            );
            tests.push(makeTest({
                id: "pv-torque-closure",
                group: "P-V",
                label: "Couple P-V / couple indiqué vilebrequin",
                status: pvClosureAssessment.status,
                statusLabel: pvClosureAssessment.label,
                measured: `${pvMetrics.torqueFromPvNm.toFixed(2)} / ${pvMetrics.meanIndicatedTorqueNm.toFixed(2)} N·m · Δ ${pvMetrics.consistencyErrorNm.toFixed(3)} N·m · écart ${pvMetrics.consistencyErrorPercent.toFixed(3)} %`,
                expected: pvClosureAssessment.isLowTorque
                    ? `faible couple < ${thresholds.pvLowTorqueThresholdNm.toFixed(0)} N·m : excellent ≤ ${thresholds.pvLowTorqueAbsoluteErrorNmExcellent.toFixed(2)} N·m · validé ≤ ${thresholds.pvLowTorqueAbsoluteErrorNmPass.toFixed(2)} N·m · avertissement ≤ ${thresholds.pvLowTorqueAbsoluteErrorNmWarning.toFixed(2)} N·m`
                    : `excellent ≤ ${thresholds.pvTorqueErrorPercentExcellent.toFixed(2)} % · validé ≤ ${thresholds.pvTorqueErrorPercentPass.toFixed(2)} % · avertissement ≤ ${thresholds.pvTorqueErrorPercentWarning.toFixed(2)} %`,
                detail: pvClosureAssessment.isLowTorque
                    ? "À faible couple, le pourcentage amplifie une petite différence. Le classement utilise donc l’écart absolu en N·m ; le pourcentage reste affiché à titre informatif."
                    : "Classement relatif : excellent, validé, avertissement ou échec."
            }));
        } else {
            tests.push(makeTest({
                id: "pv-torque-closure",
                group: "P-V",
                label: "Couple P-V / couple indiqué vilebrequin",
                status: CYCLE_VALIDATION_STATUS.UNAVAILABLE,
                measured: "Calcul impossible",
                expected: "Cycle, géométrie et cylindrée disponibles"
            }));
        }

        const firstPressure = pressures[0];
        const lastPressure = pressures.at(-1);
        const boundaryPressureRelativeError = Math.max(
            Math.abs(firstPressure),
            Math.abs(lastPressure),
            EPSILON
        ) > 0
            ? Math.abs(lastPressure - firstPressure)
                / Math.max(Math.abs(firstPressure), Math.abs(lastPressure), EPSILON)
            : NaN;
        tests.push(makeTest({
            id: "periodic-boundary",
            group: "Stabilité",
            label: "Continuité 0° / 720°",
            status: classifyUpper(
                boundaryPressureRelativeError,
                thresholds.boundaryPressureRelativeErrorPass,
                thresholds.boundaryPressureRelativeErrorWarning
            ),
            measured: `${(boundaryPressureRelativeError * 100).toFixed(3)} % sur la pression`,
            expected: `≤ ${(thresholds.boundaryPressureRelativeErrorPass * 100).toFixed(1)} %`
        }));

        const rpms = samples.map(sample => sample.rpm).filter(Number.isFinite);
        const meanRpm = mean(rpms);
        const rpmSpanPercent = rpms.length > 0 && Math.abs(meanRpm) > EPSILON
            ? (Math.max(...rpms) - Math.min(...rpms)) / Math.abs(meanRpm) * 100
            : NaN;
        tests.push(makeTest({
            id: "operating-point-stability",
            group: "Stabilité",
            label: "Stabilité du régime sur le cycle",
            status: classifyUpper(
                rpmSpanPercent,
                thresholds.rpmSpanPercentPass,
                thresholds.rpmSpanPercentWarning
            ),
            measured: `${rpmSpanPercent.toFixed(3)} % · ${Math.min(...rpms).toFixed(0)}–${Math.max(...rpms).toFixed(0)} tr/min`,
            expected: `variation ≤ ${thresholds.rpmSpanPercentPass.toFixed(2)} %`
        }));

        tests.push(validateRepeatability(
            cycleHistory,
            { sweptVolumeM3, cylinderCount, getGeometricVolumeM3 },
            thresholds
        ));
        tests.push(validateConvergence(
            convergenceCycles,
            { sweptVolumeM3, cylinderCount, getGeometricVolumeM3 },
            thresholds
        ));

        const summary = summarizeTests(tests);
        const conclusion = summary.status === CYCLE_VALIDATION_STATUS.PASS
            ? "Validation P-V et cycle acceptée pour les contrôles exécutés."
            : summary.status === CYCLE_VALIDATION_STATUS.WARNING
                ? "Cycle exploitable, avec un ou plusieurs points à surveiller avant validation définitive."
                : "Validation refusée : au moins un critère critique n’est pas respecté.";

        return {
            generatedAt: now,
            cycleSequence: cycle?.sequence ?? null,
            cylinderIndex: cycle?.cylinderIndex ?? null,
            status: summary.status,
            counts: summary.counts,
            tests,
            metrics: pvMetrics,
            operatingPoint: {
                meanRpm,
                rpmSpanPercent,
                meanBoostBarGauge: mean(
                    samples.map(sample => sample.boostBarGauge)
                )
            },
            acquisition: {
                sampleCount: samples.length,
                nominalStepDeg,
                medianStepDeg: medianAngularStepDeg,
                maximumGapDeg: maximumAngularGapDeg,
                firstAngleDeg: firstAngle,
                lastAngleDeg: lastAngle
            },
            conclusion
        };
    }

    function cycleValidationReportToCsv(report) {
        const columns = [
            "groupe",
            "controle",
            "statut",
            "mesure",
            "critere",
            "detail"
        ];
        const escape = value => {
            const text = String(value ?? "");
            return `"${text.replaceAll('"', '""')}"`;
        };
        const rows = [columns.join(";")];
        for (const test of report?.tests ?? []) {
            rows.push([
                test.group,
                test.label,
                test.statusLabel ?? test.status,
                test.measured,
                test.expected,
                test.detail
            ].map(escape).join(";"));
        }
        return rows.join("\n");
    }

    class CycleValidationReport {
        constructor(options = {}) {
            this.options = { ...options };
            this.latestReport = null;
        }

        validate(cycle, overrides = {}) {
            this.latestReport = validateEngineCycle(cycle, {
                ...this.options,
                ...overrides
            });
            return this.latestReport;
        }

        getLatestReport() {
            return this.latestReport;
        }

        clear() {
            this.latestReport = null;
        }
    }

    return {
        CycleValidationReport,
        CYCLE_VALIDATION_STATUS,
        cycleValidationReportToCsv
    };
})();

export {
    PV_TORQUE_CLOSURE_POLICY,
    evaluatePvTorqueClosure,
    CycleValidationReport,
    CYCLE_VALIDATION_STATUS,
    cycleValidationReportToCsv
};
