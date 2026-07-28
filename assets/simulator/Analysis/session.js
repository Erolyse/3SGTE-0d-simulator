import Engine from "../engine/Engine.js";
import { ENGINE_OPERATING_STATES } from "../EngineControl/EngineControl.js";
import {
    BORE, STROKE, COMP_RATIO, SWEPT_VOLUME
} from "../Geometry/Geometry.js";
import { INTAKE_VALVE_OPEN_DEG, INTAKE_VALVE_CLOSE_DEG } from "../Valvetrain/IntakeValves.js";
import { EXHAUST_VALVE_OPEN_DEG, EXHAUST_VALVE_CLOSE_DEG } from "../Valvetrain/ExhaustValves.js";
import { TURBO_SHAFT_INERTIA } from "../Turbo/Turbocharger.js";
import {
    HORSEPOWER_WATTS, PASCAL_TO_BAR, CYLINDER_COUNT, SESSION_STORAGE_KEY,
    SAVED_SESSIONS_KEY, MAX_SAVED_SESSIONS, MINIMUM_LOG_VALUE,
    PV_MIN_VOLUME_CM3, PV_MAX_VOLUME_CM3
} from "./config.js";
import {
    finite, setText, setHidden, formatNumber, downloadText, dynoModeLabel,
    engineStatusLabel, escapeHtml
} from "./utils.js";
import { CYCLE_VALIDATION_STATUS, evaluatePvTorqueClosure } from "./cycle-validation.js";
import {
    MODEL_REFERENCE_STORAGE_KEY, buildModelReference, compareReportWithReference,
    isCompleteReferenceCandidate, loadModelReference, modelFingerprint,
    persistModelReference, regressionStatusLabel, validateModelReference
} from "./non-regression.js";

export function createSessionModule({
    motor, cycleValidator, dynoSweep, liveData, referenceRun, ui,
    chartsApi, transientApi
}) {
    const {
        cycleChart, pvChart, turboChart, residualChart,
        clearCycleValidationReport, renderCycleValidationReport,
        clearMultiPointValidationReport, renderMultiPointValidationReport,
        renderDyno, cycleEventMarkers, meanSampleValue, normalizedCycleAngleDeg,
        pvVolumeM3, pvPointFromSample, formatCrankEvent, formatCycleAngle,
        findExtreme, getDisplayedCycle, getDynoPoints, getLatestTelemetry,
        getTelemetrySeries
    } = chartsApi;
    const { clearTransientValidationReport, renderTransientValidationReport } = transientApi;

    function renderNonRegressionReport(report = null) {
        liveData.nonRegressionReport = report;
        const reference = loadModelReference();
        const panel = ui.nonRegressionGlobalStatus?.closest(".non-regression-report");
        const status = report?.status ?? CYCLE_VALIDATION_STATUS.UNAVAILABLE;
        if (panel) panel.dataset.validationStatus = status;

        setText(ui.nonRegressionGlobalStatus, regressionStatusLabel(status));
        setText(
            ui.nonRegressionReference,
            reference
                ? `${reference.label} · ${reference.id}`
                : "Aucune référence définie"
        );
        setText(
            ui.nonRegressionComparisonTimestamp,
            report?.generatedAt
                ? new Date(report.generatedAt).toLocaleString("fr-FR")
                : "—"
        );

        if (report?.rows?.length) {
            setText(
                ui.nonRegressionSummary,
                `${report.counts.pass} conforme(s) · ${report.counts.warning} variation(s) · ${report.counts.fail} régression(s) · ${report.counts.unavailable} non comparé(s)`
            );
            setText(ui.nonRegressionConclusion, report.conclusion);
            if (ui.nonRegressionTableBody) {
                ui.nonRegressionTableBody.innerHTML = report.rows.map(row => `
                    <tr data-test-status="${row.status}">
                        <td>${escapeHtml(row.group)}</td>
                        <td>
                            <strong>${escapeHtml(row.label)}</strong>
                            ${row.detail ? `<span>${escapeHtml(row.detail)}</span>` : ""}
                        </td>
                        <td>${escapeHtml(row.referenceLabel)}</td>
                        <td>${escapeHtml(row.currentLabel)}</td>
                        <td>${escapeHtml(row.differenceLabel)}</td>
                        <td>${escapeHtml(row.criterionLabel)}</td>
                        <td><span class="cycle-validation-status">${regressionStatusLabel(row.status)}</span></td>
                    </tr>
                `).join("");
            }
        } else {
            setText(
                ui.nonRegressionSummary,
                reference
                    ? "Référence active · aucun tir déterministe comparable sélectionné"
                    : "Créez ou importez une référence après un tir déterministe sain"
            );
            setText(
                ui.nonRegressionConclusion,
                report?.conclusion
                    ?? "La référence ne sera jamais créée ou remplacée automatiquement."
            );
            if (ui.nonRegressionTableBody) {
                ui.nonRegressionTableBody.innerHTML = `
                    <tr class="cycle-validation-empty-row">
                        <td colspan="7">${escapeHtml(report?.conclusion ?? "Aucune comparaison disponible.")}</td>
                    </tr>
                `;
            }
        }

        updateNonRegressionControls();
    }

    function currentSessionIsReferenceCompatible() {
        const protocol = liveData.mode === "snapshot"
            ? liveData.snapshot?.referenceProtocol
            : liveData.referenceProtocol;
        const campaign = liveData.mode === "snapshot"
            ? liveData.snapshot?.multiPointValidation
            : liveData.multiPointValidation;
        const transients = liveData.mode === "snapshot"
            ? liveData.snapshot?.transientValidation
            : liveData.transientValidation;
        return protocol?.type === "deterministic-reference"
            && Array.isArray(campaign?.points)
            && campaign.points.length > 0
            && Array.isArray(transients?.scenarios)
            && transients.scenarios.length > 0;
    }

    function updateNonRegressionControls() {
        const reference = loadModelReference();
        if (ui.nonRegressionSetReferenceButton) {
            ui.nonRegressionSetReferenceButton.disabled
                = !currentSessionIsReferenceCompatible();
            ui.nonRegressionSetReferenceButton.title
                = currentSessionIsReferenceCompatible()
                    ? "Utiliser explicitement la session affichée comme nouvelle référence"
                    : "Sélectionnez ou exécutez un tir déterministe complet avec transitoires";
        }
        if (ui.nonRegressionExportReferenceButton) {
            ui.nonRegressionExportReferenceButton.disabled = !reference;
        }
        if (ui.nonRegressionDeleteReferenceButton) {
            ui.nonRegressionDeleteReferenceButton.disabled = !reference;
        }
        if (ui.nonRegressionExportComparisonButton) {
            ui.nonRegressionExportComparisonButton.disabled
                = !liveData.nonRegressionReport?.rows?.length;
        }
    }

    function refreshNonRegressionComparison() {
        const reference = loadModelReference();
        if (!reference) {
            renderNonRegressionReport(compareReportWithReference(null, null));
            return null;
        }

        const report = currentSessionReport();
        const comparison = compareReportWithReference(report, reference);
        renderNonRegressionReport(comparison);
        return comparison;
    }

    function setCurrentSessionAsModelReference() {
        const report = currentSessionReport();
        if (!isCompleteReferenceCandidate(report)) {
            window.alert("La session affichée n'est pas un tir déterministe complet avec campagnes multipoint et transitoire.");
            return;
        }

        const previous = loadModelReference();
        if (previous && !window.confirm(
            `Remplacer la référence « ${previous.label} » par la session affichée ?\n\nCette action est explicite et ne peut pas être annulée, sauf si l'ancienne référence a été exportée.`
        )) {
            return;
        }

        const selectedLabel = ui.analysisSessionSelect?.selectedOptions?.[0]?.textContent?.trim();
        const reference = persistModelReference(
            buildModelReference(report, selectedLabel || null)
        );
        renderNonRegressionReport(compareReportWithReference(report, reference));
    }

    function exportModelReference() {
        const reference = loadModelReference();
        if (!reference) return;
        const created = String(reference.createdAt ?? new Date().toISOString())
            .slice(0, 10);
        downloadText(
            `reference-3sgte-st205-v1-${created}.json`,
            JSON.stringify(reference, null, 2),
            "application/json"
        );
    }

    function deleteModelReference() {
        const reference = loadModelReference();
        if (!reference) return;
        if (!window.confirm(
            `Supprimer la référence « ${reference.label} » du navigateur ?\n\nExportez-la d'abord si elle doit être conservée dans le dépôt.`
        )) {
            return;
        }
        localStorage.removeItem(MODEL_REFERENCE_STORAGE_KEY);
        renderNonRegressionReport(compareReportWithReference(null, null));
    }

    async function importModelReferenceFile(file) {
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            const reference = validateModelReference(parsed);
            const currentFingerprint = modelFingerprint(currentSessionReport());
            if (reference.modelFingerprint !== currentFingerprint) {
                throw new Error("L'empreinte du modèle importé ne correspond pas à la configuration 3S-GTE actuellement chargée.");
            }
            const previous = loadModelReference();
            if (previous && !window.confirm(
                `Remplacer la référence locale « ${previous.label} » par « ${reference.label} » ?`
            )) {
                return;
            }
            persistModelReference(reference);
            refreshNonRegressionComparison();
        } catch (error) {
            console.error("Import de référence impossible.", error);
            window.alert(error?.message ?? "Le fichier de référence est invalide.");
        } finally {
            if (ui.nonRegressionImportFileInput) {
                ui.nonRegressionImportFileInput.value = "";
            }
        }
    }

    function nonRegressionReportToCsv(report) {
        const csvCell = value => {
            const text = value === null || value === undefined ? "" : String(value);
            return `"${text.replaceAll('"', '""')}"`;
        };
        const columns = [
            "groupe", "indicateur", "reference", "actuel", "ecart",
            "tolerance", "statut", "detail"
        ];
        const rows = (report?.rows ?? []).map(row => [
            row.group,
            row.label,
            row.referenceLabel,
            row.currentLabel,
            row.differenceLabel,
            row.criterionLabel,
            regressionStatusLabel(row.status),
            row.detail
        ].map(csvCell).join(";"));
        return [columns.map(csvCell).join(";"), ...rows].join("\n");
    }

    function runCycleValidation(cycle = getDisplayedCycle()) {
        if (!cycle?.samples?.length) {
            clearCycleValidationReport();
            return null;
        }

        if (liveData.mode === "snapshot"
            && liveData.snapshot?.cycleValidation) {
            renderCycleValidationReport(liveData.snapshot.cycleValidation);
            return liveData.snapshot.cycleValidation;
        }

        const cycleHistory = liveData.automaticValidation?.repeatabilityCycles
            ?? (liveData.mode === "live"
                ? motor.cycleRecorder.getHistory?.() ?? []
                : [cycle]);

        const convergenceCycles = liveData.automaticValidation?.convergenceCycles
            ?? null;

        const report = cycleValidator.validate(cycle, {
            cycleHistory,
            convergenceCycles
        });
        renderCycleValidationReport(report);
        return report;
    }

    function calculatePvMetrics(cycle) {
        const samples = cycle?.samples;
        if (!Array.isArray(samples) || samples.length < 2) return null;

        let netWorkJ = 0;
        let closedWorkJ = 0;
        let pumpingWorkJ = 0;

        for (let index = 1; index < samples.length; index++) {
            const previous = samples[index - 1];
            const current = samples[index];
            const meanPressure = 0.5 * (
                finite(previous.cylinderPressurePa)
                + finite(current.cylinderPressurePa)
            );
            const deltaVolume = pvVolumeM3(current)
                - pvVolumeM3(previous);
            const segmentWork = meanPressure * deltaVolume;
            const closed = !previous.intakeValveOpen
                && !previous.exhaustValveOpen
                && !current.intakeValveOpen
                && !current.exhaustValveOpen;

            netWorkJ += segmentWork;
            if (closed) {
                closedWorkJ += segmentWork;
            } else {
                pumpingWorkJ += segmentWork;
            }
        }

        const netImepBar = netWorkJ / SWEPT_VOLUME * PASCAL_TO_BAR;
        const grossImepBar = closedWorkJ / SWEPT_VOLUME * PASCAL_TO_BAR;
        const pmepBar = pumpingWorkJ / SWEPT_VOLUME * PASCAL_TO_BAR;
        const torqueFromPvNm = netWorkJ * CYLINDER_COUNT / (4 * Math.PI);
        const meanIndicatedTorqueNm = meanSampleValue(samples.slice(0, -1), "indicatedTorqueNm");
        const consistencyErrorNm = Math.abs(
            torqueFromPvNm - meanIndicatedTorqueNm
        );
        const consistencyErrorPercent = Math.abs(meanIndicatedTorqueNm) > 1e-9
            ? consistencyErrorNm / Math.abs(meanIndicatedTorqueNm) * 100
            : 0;

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
            consistencyErrorPercent
        };
    }

    function renderCycle(cycle = getDisplayedCycle()) {
        const hasCycle = Boolean(
            cycle?.samples?.length
            && finite(cycle.samples.at(-1)?.angleDeg)
                - finite(cycle.samples[0]?.angleDeg) >= 719
        );
        setHidden(ui.cycleEmptyState, hasCycle);
        setHidden(ui.pvEmptyState, hasCycle);

        if (!hasCycle) {
            cycleChart.data.datasets.forEach(dataset => { dataset.data = []; });
            pvChart.data.datasets.forEach(dataset => { dataset.data = []; });
            cycleChart.update("none");
            pvChart.update("none");
            clearCycleValidationReport();
            return;
        }

        const samples = cycle.samples;
        const summary = cycle.summary ?? {};

        cycleChart.data.datasets[0].data = samples.map(sample => ({
            x: sample.angleDeg,
            y: sample.cylinderPressurePa * PASCAL_TO_BAR,
            phase: sample.phase
        }));
        cycleChart.data.datasets[1].data = samples.map(sample => ({
            x: sample.angleDeg,
            y: sample.intakePressurePa * PASCAL_TO_BAR,
            phase: sample.phase
        }));
        cycleChart.data.datasets[2].data = samples.map(sample => ({
            x: sample.angleDeg,
            y: sample.exhaustPressurePa * PASCAL_TO_BAR,
            phase: sample.phase
        }));
        cycleChart.data.datasets[3].data = samples.map(sample => ({
            x: sample.angleDeg,
            y: sample.intakeValveLiftM * 1000,
            phase: sample.phase
        }));
        cycleChart.data.datasets[4].data = samples.map(sample => ({
            x: sample.angleDeg,
            y: sample.exhaustValveLiftM * 1000,
            phase: sample.phase
        }));
        cycleChart.options.plugins.engineeringMarkers.items = cycleEventMarkers(cycle);
        cycleChart.update("none");

        setText(ui.cycleMeanRpm, `${formatNumber(summary.meanRpm)} tr/min`);
        setText(ui.cycleMeanBoost, `${formatNumber(summary.meanBoostBarGauge, 2)} bar rel.`);
        setText(
            ui.cyclePeakPressure,
            `${formatNumber(summary.peakPressurePa * PASCAL_TO_BAR, 1)} bar à ${formatNumber(summary.peakPressureAngleDeg, 1)}°`
        );
        const events = cycle.events ?? {};
        setText(ui.cycleCa10, formatCrankEvent(events.ca10Deg));
        setText(ui.cycleCa50, formatCrankEvent(events.ca50Deg));
        setText(
            ui.cycleCa50Target,
            formatCrankEvent(events.ca50TargetDeg)
        );
        setText(
            ui.cycleCa50Model,
            formatCrankEvent(events.ca50ModelDeg)
        );
        setText(ui.cycleCa90, formatCrankEvent(events.ca90Deg));
        setText(ui.cycleIgnitionStart, formatCrankEvent(events.ignitionStartDeg));
        setText(
            ui.cycleCombustionDuration,
            `${formatNumber(summary.meanCombustionDurationDeg, 1)}° CA`
        );
        setText(ui.cycleIntakeOpen, formatCycleAngle(events.intakeValveOpenDeg));
        setText(ui.cycleIntakeClose, formatCycleAngle(events.intakeValveCloseDeg));
        setText(ui.cycleExhaustOpen, formatCycleAngle(events.exhaustValveOpenDeg));
        setText(ui.cycleExhaustClose, formatCycleAngle(events.exhaustValveCloseDeg));
        setText(ui.cycleHeatReleased, `${formatNumber(summary.heatReleasedJ, 1)} J/cycle`);
        setText(
            ui.cyclePeakTemperature,
            `${formatNumber(finite(summary.peakTemperatureK) - 273.15, 0)} °C à ${formatNumber(summary.peakTemperatureAngleDeg, 1)}°`
        );
        setText(ui.cycleNetImep, `${formatNumber(summary.netIndicatedMeanEffectivePressurePa * PASCAL_TO_BAR, 2)} bar`);
        setText(ui.cycleResolution, `${formatNumber(summary.sampleCount)} points à ${formatNumber(cycle.angularStepDeg, 1)}°`);

        renderPv(cycle);
        if (liveData.mode === "snapshot"
            && liveData.snapshot?.cycleValidation) {
            renderCycleValidationReport(liveData.snapshot.cycleValidation);
        } else {
            runCycleValidation(cycle);
        }
    }

    function uniqueSortedCycleSamples(samples) {
        const byAngle = new Map();
        for (const sample of samples ?? []) {
            if (!Number.isFinite(sample?.angleDeg)) continue;
            const angle = normalizedCycleAngleDeg(sample.angleDeg);
            byAngle.set(angle.toFixed(6), { ...sample, angleDeg: angle });
        }
        return [...byAngle.values()].sort((a, b) => a.angleDeg - b.angleDeg);
    }

    /**
     * Reconstruit les deux parcours dans leur ordre physique :
     * - cycle fermé : IVC -> EVO ;
     * - pompage : EVO -> 720° puis 0° -> IVC.
     */
    function buildPvPhaseSegments(cycle) {
        const samples = uniqueSortedCycleSamples(cycle?.samples);
        if (samples.length < 2) {
            return { closedPoints: [], pumpingPoints: [] };
        }

        const events = cycle?.events ?? {};
        const ivc = finite(events.intakeValveCloseDeg, INTAKE_VALVE_CLOSE_DEG);
        const evo = finite(events.exhaustValveOpenDeg, EXHAUST_VALVE_OPEN_DEG);

        const closedSamples = samples.filter(sample =>
            sample.angleDeg >= ivc - 1e-6
            && sample.angleDeg <= evo + 1e-6
        );
        const pumpingSamples = [
            ...samples.filter(sample => sample.angleDeg >= evo - 1e-6),
            ...samples.filter(sample => sample.angleDeg <= ivc + 1e-6)
        ];

        return {
            closedPoints: closedSamples.map(pvPointFromSample),
            pumpingPoints: pumpingSamples.map(pvPointFromSample)
        };
    }

    function renderPv(cycle = getDisplayedCycle()) {
        if (!cycle?.samples?.length) return;

        const { closedPoints, pumpingPoints } = buildPvPhaseSegments(cycle);

        pvChart.data.datasets[0].data = closedPoints;
        pvChart.data.datasets[1].data = pumpingPoints;

        const allPoints = [...closedPoints, ...pumpingPoints];
        const peakPressureBar = Math.max(
            ...allPoints.map(point => finite(point.y)),
            1
        );
        const pumpingPressureBar = Math.max(
            ...pumpingPoints.map(point => finite(point.y)),
            1
        );

        pvChart.options.scales.x.min = Math.floor(PV_MIN_VOLUME_CM3 / 10) * 10;
        pvChart.options.scales.x.max = Math.ceil(PV_MAX_VOLUME_CM3 / 10) * 10;
        pvChart.options.scales.y.type = liveData.pvPumpingZoom
            ? "linear"
            : "logarithmic";
        pvChart.options.scales.y.min = liveData.pvPumpingZoom ? 0.5 : 0.2;
        pvChart.options.scales.y.max = liveData.pvPumpingZoom
            ? Math.max(5, Math.ceil(pumpingPressureBar * 1.15 * 2) / 2)
            : Math.max(120, Math.ceil(peakPressureBar * 1.12 / 10) * 10);
        pvChart.update("none");

        const metrics = calculatePvMetrics(cycle);
        if (!metrics) return;

        setText(ui.pvNetWork, `${formatNumber(metrics.netWorkJ, 1)} J/cylindre/cycle`);
        setText(ui.pvGrossImep, `${formatNumber(metrics.grossImepBar, 2)} bar`);
        setText(ui.pvPmep, `${formatNumber(metrics.pmepBar, 2)} bar`);
        setText(ui.pvNetImep, `${formatNumber(metrics.netImepBar, 2)} bar`);
        setText(ui.pvTorqueFromWork, `${formatNumber(metrics.torqueFromPvNm, 1)} N·m`);
        setText(ui.pvCrankTorque, `${formatNumber(metrics.meanIndicatedTorqueNm, 1)} N·m`);

        const pvClosureAssessment = evaluatePvTorqueClosure(
            metrics.torqueFromPvNm,
            metrics.meanIndicatedTorqueNm
        );
        const pvClosureCompact = `${formatNumber(metrics.consistencyErrorPercent, 2)} % · ${pvClosureAssessment.label}`;
        setText(ui.pvConsistency, pvClosureCompact);
        setText(ui.summaryPvConsistency, pvClosureCompact);
        setText(
            ui.validationPvClosure,
            `${pvClosureAssessment.label} · ${formatNumber(metrics.consistencyErrorPercent, 2)} % · Δ ${formatNumber(metrics.consistencyErrorNm, 3)} N·m`
        );

        const lowTorqueExplanation = pvClosureAssessment.isLowTorque
            ? " À faible couple, le classement repose sur l’écart absolu en N·m."
            : "";
        const conclusion = `${pvClosureAssessment.label} : le travail intégré sur le diagramme P-V retrouve le couple indiqué avec un écart de ${formatNumber(metrics.consistencyErrorPercent, 2)} % et ${formatNumber(metrics.consistencyErrorNm, 3)} N·m.${lowTorqueExplanation}`;
        setText(ui.pvValidationConclusion, conclusion);
        ui.pvValidationConclusion?.classList.toggle(
            "is-valid",
            pvClosureAssessment.status === CYCLE_VALIDATION_STATUS.PASS
        );
        ui.pvValidationConclusion?.classList.toggle(
            "is-warning",
            pvClosureAssessment.status !== CYCLE_VALIDATION_STATUS.PASS
        );
    }

    function telemetryToPoints(samples, key, transform = value => value) {
        return samples.map(sample => ({
            x: finite(sample.time),
            y: transform(finite(sample[key]))
        }));
    }

    function renderTurbo(samples = getTelemetrySeries()) {
        const hasData = samples.length > 1;
        setHidden(ui.turboEmptyState, hasData);

        const datasets = turboChart.data.datasets;
        datasets[0].data = telemetryToPoints(samples, "turbineAvailablePower", value => value / 1000);
        datasets[1].data = telemetryToPoints(samples, "turbinePower", value => value / 1000);
        datasets[2].data = telemetryToPoints(samples, "compressorPower", value => value / 1000);
        datasets[3].data = telemetryToPoints(samples, "turboBearingFrictionPower", value => value / 1000);
        datasets[4].data = telemetryToPoints(samples, "turboNetPower", value => value / 1000);
        datasets[5].data = telemetryToPoints(samples, "turboRPM", value => value / 1000);
        datasets[6].data = telemetryToPoints(samples, "wastegatePosition", value => value * 100);
        turboChart.update("none");

        const sample = samples.at(-1);
        if (!sample) return;

        setText(ui.turboChargePressure, `${formatNumber(sample.chargeAirPressure * PASCAL_TO_BAR, 2)} bar abs`);
        setText(ui.turboBoostValue, `${formatNumber(sample.boost, 2)} bar rel.`);
        setText(ui.turboMassFlow, `${formatNumber(sample.compressorMassFlow * 1000, 1)} g/s`);
        setText(ui.turboPressureRatio, formatNumber(sample.compressorPressureRatio, 2));
        setText(ui.turboEfficiency, `${formatNumber(sample.compressorEfficiency * 100, 1)} %`);
        setText(ui.intercoolerEfficiency, `${formatNumber(sample.intercoolerEffectiveness * 100, 1)} %`);
        setText(ui.wastegatePosition, `${formatNumber(sample.wastegatePosition * 100, 1)} %`);
        setText(ui.wastegateMassFlow, `${formatNumber(sample.wastegateMassFlow * 1000, 1)} g/s`);
    }

    function renderResiduals(samples = getTelemetrySeries()) {
        const hasData = samples.length > 1;
        setHidden(ui.residualEmptyState, hasData);

        residualChart.data.datasets[0].data = telemetryToPoints(
            samples,
            "maximumMassResidualPercent",
            value => Math.max(Math.abs(value), MINIMUM_LOG_VALUE)
        );
        residualChart.data.datasets[1].data = telemetryToPoints(
            samples,
            "maximumEnergyResidualPercent",
            value => Math.max(Math.abs(value), MINIMUM_LOG_VALUE)
        );
        residualChart.data.datasets[2].data = telemetryToPoints(
            samples,
            "cumulativeAbsoluteMassResidual",
            value => Math.max(Math.abs(value), MINIMUM_LOG_VALUE)
        );
        residualChart.data.datasets[3].data = telemetryToPoints(
            samples,
            "cumulativeAbsoluteEnergyResidual",
            value => Math.max(Math.abs(value), MINIMUM_LOG_VALUE)
        );
        residualChart.update("none");

        const massMax = samples.reduce(
            (maximum, sample) => Math.max(maximum, Math.abs(finite(sample.maximumMassResidualPercent))),
            0
        );
        const energyMax = samples.reduce(
            (maximum, sample) => Math.max(maximum, Math.abs(finite(sample.maximumEnergyResidualPercent))),
            0
        );

        setText(ui.summaryMassResidual, `${massMax.toExponential(2)} %`);
        setText(ui.summaryEnergyResidual, `${energyMax.toExponential(2)} %`);

        const acceptable = massMax <= 1e-2 && energyMax <= 1e-2;
        const excellent = massMax <= 1e-5 && energyMax <= 1e-3;
        const status = excellent
            ? "Convergence vérifiée"
            : acceptable
                ? "Convergence acceptable"
                : "À vérifier";

        setText(ui.numericalConvergenceStatus, status);
        setText(
            ui.numericalConclusion,
            acceptable
                ? "Les résidus restent sous les seuils définis pendant la fenêtre analysée."
                : "Au moins un résidu dépasse le seuil acceptable ; la session doit être examinée."
        );
        ui.numericalConclusion?.classList.toggle("is-valid", acceptable);
        ui.numericalConclusion?.classList.toggle("is-warning", !acceptable);
        setText(ui.validationConservation, status);
    }

    function renderHeader() {
        const sample = getLatestTelemetry();

        if (referenceRun.active) {
            setText(ui.analysisEngineStatus, "Calcul de référence");
            setText(ui.analysisDynoMode, "Protocole déterministe");
            setText(
                ui.analysisCurrentRpm,
                `${formatNumber(referenceRun.currentRpm)} tr/min`
            );
            return;
        }

        if (liveData.mode === "snapshot") {
            setText(ui.analysisEngineStatus, "Session enregistrée");
            setText(ui.analysisDynoMode, liveData.snapshot?.meta?.dynoMode ?? "Inertiel");
            setText(
                ui.analysisCurrentRpm,
                `${formatNumber(sample?.rpm ?? liveData.snapshot?.meta?.rpm ?? 0)} tr/min`
            );
            return;
        }

        setText(ui.analysisEngineStatus, engineStatusLabel(motor.state));
        setText(ui.analysisDynoMode, dynoModeLabel(motor.state.dynoMode));
        setText(ui.analysisCurrentRpm, `${formatNumber(sample?.rpm ?? motor.state.rpm)} tr/min`);

        if (ui.analysisEngineButton) {
            const running = motor.state.engineOperatingState === ENGINE_OPERATING_STATES.RUNNING;
            ui.analysisEngineButton.textContent = running
                ? "Arrêter le moteur"
                : "Démarrer le moteur";
            ui.analysisEngineButton.dataset.state = motor.state.engineOperatingState;
        }
    }

    function refreshAllCharts() {
        renderDyno();
        renderCycle();
        renderTurbo();
        renderResiduals();
    }

    function currentSessionReport() {
        const cycle = getDisplayedCycle();
        const pvMetrics = calculatePvMetrics(cycle);
        const points = getDynoPoints();
        const telemetry = getTelemetrySeries();
        const peakTorque = findExtreme(points, "torque");
        const peakPower = findExtreme(points, "power");

        return {
            generatedAt: new Date().toISOString(),
            project: "3S-GTE 0D Engine Simulator",
            model: {
                boreM: BORE,
                strokeM: STROKE,
                sweptVolumePerCylinderM3: SWEPT_VOLUME,
                totalDisplacementM3: SWEPT_VOLUME * CYLINDER_COUNT,
                compressionRatio: COMP_RATIO,
                firingOrder: "1-3-4-2",
                turboShaftInertiaKgM2: TURBO_SHAFT_INERTIA,
                intakeValveOpenDeg: INTAKE_VALVE_OPEN_DEG,
                intakeValveCloseDeg: INTAKE_VALVE_CLOSE_DEG,
                exhaustValveOpenDeg: EXHAUST_VALVE_OPEN_DEG,
                exhaustValveCloseDeg: EXHAUST_VALVE_CLOSE_DEG
            },
            numericalMethod: {
                externalPhysicsStepSeconds: 0.0001,
                displayedCycleStepDeg: 0.5,
                telemetryRateHz: 30,
                cycleResolution: cycle?.samples?.length ?? 0,
                angularSolver: "pas temporel avec sous-pas angulaire adaptatif"
            },
            cycleValidation: liveData.cycleValidationReport
                ?? runCycleValidation(cycle),
            multiPointValidation: liveData.multiPointValidation,
            transientValidation: liveData.transientValidation,
            referenceProtocol: liveData.referenceProtocol,
            nonRegression: liveData.nonRegressionReport,
            submoduleUnitTests: liveData.submoduleUnitTestReport,
            activeModelReference: (() => {
                const reference = loadModelReference();
                return reference ? {
                    id: reference.id,
                    label: reference.label,
                    createdAt: reference.createdAt,
                    modelFingerprint: reference.modelFingerprint
                } : null;
            })(),
            results: {
                peakTorqueNm: peakTorque?.torque ?? null,
                peakTorqueRpm: peakTorque?.rpm ?? null,
                peakPowerHp: peakPower ? peakPower.power / HORSEPOWER_WATTS : null,
                peakPowerRpm: peakPower?.rpm ?? null,
                pvMetrics,
                maximumMassResidualPercent: telemetry.reduce(
                    (maximum, sample) => Math.max(maximum, Math.abs(finite(sample.maximumMassResidualPercent))),
                    0
                ),
                maximumEnergyResidualPercent: telemetry.reduce(
                    (maximum, sample) => Math.max(maximum, Math.abs(finite(sample.maximumEnergyResidualPercent))),
                    0
                )
            },
            dynoPoints: points,
            cycle,
            telemetry
        };
    }

    const STORED_TELEMETRY_KEYS = Object.freeze([
        "sequence", "time", "duration", "rpm", "throttle", "torque", "power",
        "closedCycleIndicatedTorque", "pumpingTorque", "mechanicalFrictionTorque",
        "accessoryTorque", "boost", "intakePressure", "chargeAirPressure",
        "chargeAirTemperature", "compressorMassFlow", "compressorPressureRatio",
        "compressorEfficiency", "intercoolerEffectiveness", "turboRPM",
        "turbineAvailablePower", "turbinePower", "compressorPower",
        "turboBearingFrictionPower", "turboNetPower", "wastegatePosition",
        "wastegateMassFlow", "maximumMassResidualPercent",
        "maximumEnergyResidualPercent", "cumulativeAbsoluteMassResidual",
        "cumulativeAbsoluteEnergyResidual"
    ]);

    const STORED_CYCLE_SAMPLE_KEYS = Object.freeze([
        "angleDeg", "phase", "intakeValveOpen", "exhaustValveOpen", "rpm",
        "throttle", "indicatedTorqueNm", "closedCycleTorqueNm", "pumpingTorqueNm",
        "boostBarGauge", "cylinderPressurePa", "cylinderVolumeM3",
        "cylinderTemperatureK", "intakePressurePa", "exhaustPressurePa",
        "intakeValveLiftM", "exhaustValveLiftM", "burnedFraction",
        "heatReleaseRateW"
    ]);

    function pickFields(source, keys) {
        const result = {};
        for (const key of keys) {
            if (source?.[key] !== undefined) result[key] = source[key];
        }
        return result;
    }

    function compactReportForStorage(report) {
        const telemetry = Array.isArray(report.telemetry) ? report.telemetry : [];
        const stride = Math.max(Math.ceil(telemetry.length / 300), 1);
        const compactTelemetry = [];
        for (let index = 0; index < telemetry.length; index += stride) {
            compactTelemetry.push(pickFields(telemetry[index], STORED_TELEMETRY_KEYS));
        }

        const cycle = report.cycle?.samples?.length
            ? {
                ...report.cycle,
                samples: report.cycle.samples.map(sample =>
                    pickFields(sample, STORED_CYCLE_SAMPLE_KEYS)
                )
            }
            : report.cycle;

        return {
            generatedAt: report.generatedAt,
            project: report.project,
            model: report.model,
            numericalMethod: report.numericalMethod,
            cycleValidation: report.cycleValidation,
            multiPointValidation: report.multiPointValidation,
            transientValidation: report.transientValidation,
            referenceProtocol: report.referenceProtocol,
            nonRegression: report.nonRegression,
            activeModelReference: report.activeModelReference,
            results: report.results,
            dynoPoints: report.dynoPoints,
            cycle,
            telemetry: compactTelemetry
        };
    }

    function sessionTimestamp(session) {
        const explicit = Date.parse(session?.createdAt ?? session?.report?.generatedAt ?? "");
        if (Number.isFinite(explicit)) return explicit;

        const match = /^session-(\d+)$/.exec(String(session?.id ?? ""));
        return match ? Number(match[1]) : 0;
    }

    function buildSessionLabel(report, createdAt) {
        const date = new Date(createdAt);
        const dateLabel = Number.isFinite(date.getTime())
            ? date.toLocaleString("fr-FR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit"
            })
            : "date inconnue";

        const torque = report?.results?.peakTorqueNm;
        const power = report?.results?.peakPowerHp;
        const values = [];

        if (Number.isFinite(torque)) values.push(`${Math.round(torque)} N·m`);
        if (Number.isFinite(power)) values.push(`${power.toFixed(1)} ch`);

        return `Tir ${dateLabel}${values.length ? ` · ${values.join(" · ")}` : ""}`;
    }

    function persistSavedSessions(sessions) {
        const ordered = [...sessions]
            .filter(session => session?.id && session?.report)
            .sort((left, right) => sessionTimestamp(right) - sessionTimestamp(left))
            .slice(0, MAX_SAVED_SESSIONS);

        try {
            localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(ordered));
            return ordered;
        } catch (error) {
            // En cas de quota localStorage, les sessions les plus anciennes sont retirées.
            const reduced = [...ordered];
            while (reduced.length > 1) {
                reduced.pop();
                try {
                    localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(reduced));
                    return reduced;
                } catch {
                }
            }
            console.warn("Impossible d'enregistrer la session d'analyse.", error);
            return [];
        }
    }

    function saveCurrentSession(label = null) {
        const report = compactReportForStorage(currentSessionReport());
        const createdAt = report.generatedAt ?? new Date().toISOString();
        const id = `session-${Date.now()}`;
        const sessions = loadSavedSessions();

        const entry = {
            id,
            createdAt,
            label: label ?? buildSessionLabel(report, createdAt),
            report
        };

        persistSavedSessions([entry, ...sessions]);
        populateSessionSelector(id);
        selectSession(id);
        return id;
    }

    function loadSavedSessions() {
        try {
            const parsed = JSON.parse(localStorage.getItem(SAVED_SESSIONS_KEY) ?? "[]");
            if (!Array.isArray(parsed)) return [];

            return parsed
                .filter(session => session?.id && session?.report)
                .map(session => ({
                    ...session,
                    createdAt: session.createdAt
                        ?? session.report?.generatedAt
                        ?? new Date(sessionTimestamp(session)).toISOString(),
                    label: session.label
                        ?? buildSessionLabel(
                            session.report,
                            session.createdAt ?? session.report?.generatedAt
                        )
                }))
                .sort((left, right) => sessionTimestamp(right) - sessionTimestamp(left));
        } catch {
            return [];
        }
    }

    function deleteSelectedSession() {
        const selectedId = ui.analysisSessionSelect?.value;
        if (!selectedId?.startsWith("session-")) return;

        const sessions = loadSavedSessions();
        const selected = sessions.find(session => session.id === selectedId);
        const confirmed = window.confirm(
            `Supprimer définitivement « ${selected?.label ?? "ce tir"} » ?`
        );
        if (!confirmed) return;

        const remaining = sessions.filter(session => session.id !== selectedId);
        persistSavedSessions(remaining);
        liveData.mode = "live";
        liveData.snapshot = null;
        populateSessionSelector("live");
        selectSession("live");
    }

    function loadViewerSnapshot() {
        try {
            const parsed = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "null");
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
            return null;
        }
    }

    function updateSessionControls() {
        if (!ui.analysisDeleteSessionButton) return;
        const selectedId = ui.analysisSessionSelect?.value ?? "live";
        const canDelete = selectedId.startsWith("session-");
        ui.analysisDeleteSessionButton.disabled = !canDelete;
        ui.analysisDeleteSessionButton.title = canDelete
            ? "Supprimer définitivement le tir sélectionné"
            : "Sélectionnez un tir enregistré pour le supprimer";
    }

    function populateSessionSelector(preferredValue = null) {
        if (!ui.analysisSessionSelect) return;

        const currentValue = preferredValue ?? ui.analysisSessionSelect.value;
        const snapshot = loadViewerSnapshot();
        const sessions = loadSavedSessions();

        ui.analysisSessionSelect.innerHTML = "";

        const activeGroup = document.createElement("optgroup");
        activeGroup.label = "Données actives";

        const liveOption = document.createElement("option");
        liveOption.value = "live";
        liveOption.textContent = "Simulation locale en direct";
        activeGroup.appendChild(liveOption);

        if (snapshot) {
            const option = document.createElement("option");
            option.value = "viewer-snapshot";
            option.textContent = "Données transmises depuis le viewer";
            activeGroup.appendChild(option);
        }

        ui.analysisSessionSelect.appendChild(activeGroup);

        if (sessions.length) {
            const savedGroup = document.createElement("optgroup");
            savedGroup.label = `Tirs enregistrés (${sessions.length})`;

            for (const session of sessions) {
                const option = document.createElement("option");
                option.value = session.id;
                option.textContent = session.label;
                savedGroup.appendChild(option);
            }
            ui.analysisSessionSelect.appendChild(savedGroup);
        }

        const availableValues = [...ui.analysisSessionSelect.options].map(option => option.value);
        ui.analysisSessionSelect.value = availableValues.includes(currentValue)
            ? currentValue
            : "live";

        updateSessionControls();
    }

    function normalizeSnapshot(snapshot) {
        if (!snapshot) return null;

        if (snapshot.report) {
            return {
                telemetry: snapshot.report.telemetry ?? [],
                dynoPoints: snapshot.report.dynoPoints ?? [],
                cycle: snapshot.report.cycle ?? null,
                cycleValidation: snapshot.report.cycleValidation ?? null,
                multiPointValidation: snapshot.report.multiPointValidation ?? null,
                transientValidation: snapshot.report.transientValidation ?? null,
                referenceProtocol: snapshot.report.referenceProtocol ?? null,
                nonRegression: snapshot.report.nonRegression ?? null,
                activeModelReference: snapshot.report.activeModelReference ?? null,
                meta: {
                    rpm: snapshot.report.telemetry?.at(-1)?.rpm ?? 0,
                    dynoMode: "Inertiel"
                }
            };
        }

        return {
            telemetry: Array.isArray(snapshot.telemetry) ? snapshot.telemetry : [],
            dynoPoints: Array.isArray(snapshot.dynoPoints) ? snapshot.dynoPoints : [],
            cycle: snapshot.cycle ?? null,
            cycleValidation: snapshot.cycleValidation ?? null,
            multiPointValidation: snapshot.multiPointValidation ?? null,
            transientValidation: snapshot.transientValidation ?? null,
            referenceProtocol: snapshot.referenceProtocol ?? null,
            nonRegression: snapshot.nonRegression ?? null,
            activeModelReference: snapshot.activeModelReference ?? null,
            meta: snapshot.meta ?? {}
        };
    }

    function selectSession(value) {
        if (value === "live") {
            liveData.mode = "live";
            liveData.snapshot = null;
            updateSessionControls();
            refreshAllCharts();
            renderHeader();
            refreshNonRegressionComparison();
            return;
        }

        let snapshot = null;

        if (value === "viewer-snapshot") {
            snapshot = loadViewerSnapshot();
        } else {
            const session = loadSavedSessions().find(item => item.id === value);
            snapshot = session?.report ? { report: session.report } : null;
        }

        liveData.snapshot = normalizeSnapshot(snapshot);
        liveData.mode = liveData.snapshot ? "snapshot" : "live";
        liveData.referenceProtocol = liveData.snapshot?.referenceProtocol ?? null;
        liveData.automaticValidation = null;
        if (liveData.snapshot?.cycleValidation) {
            renderCycleValidationReport(liveData.snapshot.cycleValidation);
        } else {
            clearCycleValidationReport();
        }
        if (liveData.snapshot?.multiPointValidation) {
            renderMultiPointValidationReport(
                liveData.snapshot.multiPointValidation
            );
        } else {
            clearMultiPointValidationReport();
        }
        if (liveData.snapshot?.transientValidation) {
            renderTransientValidationReport(
                liveData.snapshot.transientValidation
            );
        } else {
            clearTransientValidationReport();
        }
        updateSessionControls();
        refreshAllCharts();
        renderHeader();
        refreshNonRegressionComparison();
    }

    function clearLiveData() {
        liveData.mode = "live";
        liveData.snapshot = null;
        if (ui.analysisSessionSelect) ui.analysisSessionSelect.value = "live";
        updateSessionControls();
        liveData.telemetry.length = 0;
        liveData.dynoPoints.length = 0;
        liveData.cycle = null;
        liveData.displayedCycle = null;
        liveData.automaticValidation = null;
        liveData.multiPointValidation = null;
        liveData.transientValidation = null;
        liveData.referenceProtocol = null;
        liveData.nonRegressionReport = null;
        dynoSweep.clear();
        motor.telemetry.clear({ resetTime: false });
        motor.cycleRecorder.clear?.();
        clearCycleValidationReport();
        clearMultiPointValidationReport();
        clearTransientValidationReport();
        refreshAllCharts();
        renderNonRegressionReport(compareReportWithReference(null, loadModelReference()));
    }


    return {
        renderNonRegressionReport,
        currentSessionIsReferenceCompatible,
        updateNonRegressionControls,
        refreshNonRegressionComparison,
        setCurrentSessionAsModelReference,
        exportModelReference,
        deleteModelReference,
        importModelReferenceFile,
        nonRegressionReportToCsv,
        runCycleValidation,
        calculatePvMetrics,
        renderCycle,
        uniqueSortedCycleSamples,
        buildPvPhaseSegments,
        renderPv,
        telemetryToPoints,
        renderTurbo,
        renderResiduals,
        renderHeader,
        refreshAllCharts,
        currentSessionReport,
        STORED_TELEMETRY_KEYS,
        STORED_CYCLE_SAMPLE_KEYS,
        pickFields,
        compactReportForStorage,
        sessionTimestamp,
        buildSessionLabel,
        persistSavedSessions,
        saveCurrentSession,
        loadSavedSessions,
        deleteSelectedSession,
        loadViewerSnapshot,
        updateSessionControls,
        populateSessionSelector,
        normalizeSnapshot,
        selectSession,
        clearLiveData
    };
}
