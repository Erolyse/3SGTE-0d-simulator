import DynoSweepRecorder from "./simulator/Charts/DynoSweepRecorder.js";
import { SWEPT_VOLUME, CYLINDER_OFFSETS, getCylinderVolume } from "./simulator/Geometry/Geometry.js";
import {
    HORSEPOWER_WATTS, CYLINDER_COUNT, DEG_TO_RAD, MAX_DYNO_RPM,
    TELEMETRY_DISPLAY_SECONDS, MAX_TELEMETRY_POINTS, PHYSICS_CHUNK_SECONDS,
    MAX_PHYSICS_CHUNKS_PER_FRAME, MAX_PHYSICS_BUDGET_MS, MAX_ACCUMULATED_TIME,
    CHART_REFRESH_INTERVAL_MS, HEADER_REFRESH_INTERVAL_MS, REFERENCE_PROTOCOL
} from "./simulator/Analysis/config.js";
import { CycleValidationReport, cycleValidationReportToCsv } from "./simulator/Analysis/cycle-validation.js";
import { finite, clamp, setText, downloadText, validationStatusLabel } from "./simulator/Analysis/utils.js";
import { createAnalysisEngine } from "./simulator/Analysis/engine-factory.js";
import { ReferenceRunCancelledError } from "./simulator/Analysis/errors.js";
import { createChartsModule } from "./simulator/Analysis/charts.js";
import {
    compareReportWithReference, loadModelReference
} from "./simulator/Analysis/non-regression.js";
import { createUnitTestsModule } from "./simulator/Analysis/unit-tests.js";
import { createReferenceCampaignModule } from "./simulator/Analysis/reference-campaign.js";
import { createTransientCampaignModule } from "./simulator/Analysis/transient-campaign.js";
import { createSessionModule } from "./simulator/Analysis/session.js";

const Chart = globalThis.Chart;
if (typeof Chart !== "function") {
    throw new Error("Chart.js doit être chargé avant Analysis.js.");
}

const motor = createAnalysisEngine();

const cycleValidator = new CycleValidationReport({
    sweptVolumeM3: SWEPT_VOLUME,
    cylinderCount: CYLINDER_COUNT,
    getGeometricVolumeM3: angleDeg => getCylinderVolume(
        ((finite(angleDeg) % 360) + 360) % 360 * DEG_TO_RAD
    )
});

const dynoSweep = new DynoSweepRecorder({
    rpmBinSize: 100,
    minimumRpm: 1000,
    maximumRpm: MAX_DYNO_RPM,
    minimumThrottle: 0.65,
    minimumAngularAcceleration: -2
});

const liveData = {
    telemetry: [], dynoPoints: [], cycle: null, latestSample: null, mode: "live",
    snapshot: null, frozenCycle: false, displayedCycle: null, pvPumpingZoom: false,
    lastChartRefresh: 0, lastHeaderRefresh: 0, activeTab: "overview",
    density: "presentation", cycleValidationReport: null, automaticValidation: null,
    multiPointValidation: null, referenceProtocol: null, nonRegressionReport: null,
    submoduleUnitTestReport: null, transientValidation: null
};

const referenceRun = {
    active: false, cancelRequested: false, phase: "idle", progressPercent: 0,
    startedAt: null, currentRpm: 0
};

const ui = Object.fromEntries([
    "analysisEngineStatus",
    "analysisDynoMode",
    "analysisCurrentRpm",
    "analysisSessionSelect",
    "analysisDeleteSessionButton",
    "analysisBackButton",
    "analysisExportReportButton",
    "analysisEngineButton",
    "analysisSweepButton",
    "analysisClearButton",
    "referenceRunPhase",
    "referenceRunProgress",
    "dynoCaptureStatus",
    "dynoEmptyState",
    "pvEmptyState",
    "cycleEmptyState",
    "turboEmptyState",
    "residualEmptyState",
    "summaryPeakTorque",
    "summaryPeakPower",
    "summaryPvConsistency",
    "summaryMassResidual",
    "summaryEnergyResidual",
    "balanceClosedTorque",
    "balancePumpingTorque",
    "balanceFrictionTorque",
    "balanceAccessoryTorque",
    "balanceBrakeTorque",
    "pvZoomButton",
    "pvExportButton",
    "pvNetWork",
    "pvGrossImep",
    "pvPmep",
    "pvNetImep",
    "pvTorqueFromWork",
    "pvCrankTorque",
    "pvConsistency",
    "pvValidationConclusion",
    "cycleCylinderSelect",
    "cycleFreezeButton",
    "cycleExportButton",
    "cycleMeanRpm",
    "cycleMeanBoost",
    "cyclePeakPressure",
    "cycleCa10",
    "cycleCa50",
    "cycleCa50Target",
    "cycleCa50Model",
    "cycleCa90",
    "cycleIgnitionStart",
    "cycleCombustionDuration",
    "cycleIntakeOpen",
    "cycleIntakeClose",
    "cycleExhaustOpen",
    "cycleExhaustClose",
    "cycleHeatReleased",
    "cyclePeakTemperature",
    "cycleNetImep",
    "cycleResolution",
    "turboChargePressure",
    "turboBoostValue",
    "turboMassFlow",
    "turboPressureRatio",
    "turboEfficiency",
    "intercoolerEfficiency",
    "wastegatePosition",
    "wastegateMassFlow",
    "numericalConvergenceStatus",
    "numericalConclusion",
    "validationPeakTorque",
    "validationPeakTorqueRpm",
    "validationPeakPower",
    "validationPeakBoost",
    "validationPvClosure",
    "validationConservation",
    "validationMultiPoint",
    "cycleValidationGlobalStatus",
    "cycleValidationSummary",
    "cycleValidationTimestamp",
    "cycleValidationOperatingPoint",
    "cycleValidationAcquisition",
    "cycleValidationConclusion",
    "cycleValidationTableBody",
    "cycleValidationRunButton",
    "cycleValidationExportButton",
    "multiPointValidationGlobalStatus",
    "multiPointValidationSummary",
    "multiPointValidationTimestamp",
    "multiPointValidationTableBody",
    "multiPointValidationConclusion",
    "multiPointValidationExportButton",
    "nonRegressionGlobalStatus",
    "nonRegressionSummary",
    "nonRegressionReference",
    "nonRegressionComparisonTimestamp",
    "nonRegressionTableBody",
    "nonRegressionConclusion",
    "nonRegressionSetReferenceButton",
    "nonRegressionExportReferenceButton",
    "nonRegressionImportReferenceButton",
    "nonRegressionImportFileInput",
    "nonRegressionDeleteReferenceButton",
    "nonRegressionExportComparisonButton",
    "submoduleUnitTestGlobalStatus",
    "submoduleUnitTestSummary",
    "submoduleUnitTestSummaryBadge",
    "submoduleUnitTestTimestamp",
    "submoduleUnitTestTableBody",
    "submoduleUnitTestConclusion",
    "submoduleUnitTestRunButton",
    "submoduleUnitTestExportButton",
    "transientValidationGlobalStatus",
    "transientValidationSummary",
    "transientValidationSummaryBadge",
    "transientValidationTimestamp",
    "transientValidationTableBody",
    "transientValidationConclusion",
    "transientValidationExportButton"
].map(id => [id, document.getElementById(id)]));


const chartsApi = createChartsModule({ cycleValidator, liveData, ui });
const {
    charts, dynoChart, cycleChart, pvChart, turboChart, residualChart,
    applyDensityMode, renderDyno, renderCycleValidationReport,
    clearCycleValidationReport, clearMultiPointValidationReport,
    renderMultiPointValidationReport, multiPointValidationToCsv
} = chartsApi;

const unitTestsApi = createUnitTestsModule({ liveData, ui });
const { runSubmoduleUnitTests, submoduleUnitTestReportToCsv } = unitTestsApi;

const referenceApi = createReferenceCampaignModule({ cycleValidator, referenceRun, ui });
const {
    setReferenceRunUi, simulateDeterministically, restoreStateSnapshot,
    runDeterministicReferenceSweep, runAutomaticValidationCampaign,
    runMultiPointValidationCampaign
} = referenceApi;

const transientApi = createTransientCampaignModule({
    liveData, ui, restoreStateSnapshot, setReferenceRunUi, simulateDeterministically
});
const {
    runTransientValidationCampaign, clearTransientValidationReport,
    renderTransientValidationReport, transientValidationToCsv
} = transientApi;

const sessionApi = createSessionModule({
    motor, cycleValidator, dynoSweep, liveData, referenceRun, ui, chartsApi, transientApi
});
const {
    renderNonRegressionReport, refreshNonRegressionComparison,
    setCurrentSessionAsModelReference, exportModelReference, deleteModelReference,
    importModelReferenceFile, nonRegressionReportToCsv, runCycleValidation,
    renderCycle, renderPv, renderTurbo, renderResiduals, renderHeader,
    refreshAllCharts, currentSessionReport, saveCurrentSession, deleteSelectedSession,
    loadViewerSnapshot, updateSessionControls, populateSessionSelector,
    selectSession, clearLiveData
} = sessionApi;

function buildReferenceSessionLabel(report) {
    const torque = report?.results?.peakTorqueNm;
    const power = report?.results?.peakPowerHp;
    const dateLabel = new Date().toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
    return [
        `Référence ${dateLabel}`,
        Number.isFinite(torque) ? `${Math.round(torque)} N·m` : null,
        Number.isFinite(power) ? `${power.toFixed(1)} ch` : null
    ].filter(Boolean).join(" · ");
}

async function executeReferenceRun() {
    if (referenceRun.active) return;

    referenceRun.active = true;
    referenceRun.cancelRequested = false;
    referenceRun.startedAt = new Date().toISOString();
    liveData.mode = "live";
    liveData.snapshot = null;
    liveData.automaticValidation = null;
    liveData.multiPointValidation = null;
    liveData.transientValidation = null;
    liveData.referenceProtocol = null;
    liveData.nonRegressionReport = null;
    if (ui.analysisSessionSelect) ui.analysisSessionSelect.value = "live";
    updateSessionControls();

    ui.analysisSweepButton?.classList.add("is-active");
    setText(ui.analysisSweepButton, "Interrompre le tir de référence");
    if (ui.analysisEngineButton) ui.analysisEngineButton.disabled = true;
    if (ui.analysisClearButton) ui.analysisClearButton.disabled = true;

    try {
        clearLiveData();
        const sweep = await runDeterministicReferenceSweep();
        const validation = await runAutomaticValidationCampaign();
        const multiPointCampaign =
            await runMultiPointValidationCampaign(validation, {
                progressStart: 60,
                progressEnd: 88
            });
        const multiPointValidation = multiPointCampaign.report;
        const transientValidation =
            await runTransientValidationCampaign(
                multiPointCampaign.artifacts,
                {
                    progressStart: 88,
                    progressEnd: 99
                }
            );

        liveData.telemetry = sweep.telemetry.slice(-MAX_TELEMETRY_POINTS);
        liveData.dynoPoints = sweep.dynoPoints;
        liveData.cycle = validation.representativeCycle;
        liveData.displayedCycle = validation.representativeCycle;
        liveData.automaticValidation = {
            repeatabilityCycles: validation.repeatabilityCycles,
            convergenceCycles: validation.convergenceCycles
        };
        liveData.multiPointValidation = multiPointValidation;
        liveData.transientValidation = transientValidation;
        liveData.referenceProtocol = {
            type: "deterministic-reference",
            completedAt: new Date().toISOString(),
            startedAt: referenceRun.startedAt,
            physicsCallStepSeconds: REFERENCE_PROTOCOL.physicsCallStepSeconds,
            throttleClock: "temps simulé",
            sweepStopRpm: REFERENCE_PROTOCOL.sweepStopRpm,
            validationTargetRpm: REFERENCE_PROTOCOL.validationTargetRpm,
            repeatabilityCycleCount: validation.repeatabilityCycles.length,
            convergenceStepsDeg: REFERENCE_PROTOCOL.convergenceStepsDeg,
            multiPointCount: multiPointValidation.points.length,
            multiPointStatus: multiPointValidation.status,
            multiPointProtocol: multiPointValidation.protocol,
            transientScenarioCount: transientValidation.scenarios.length,
            transientStatus: transientValidation.status,
            transientProtocol: transientValidation.protocol,
            sweepSimulatedDurationSeconds: sweep.simulatedDurationSeconds
        };

        renderCycle(validation.representativeCycle);
        renderDyno(sweep.dynoPoints);
        renderTurbo(sweep.telemetry);
        renderResiduals(sweep.telemetry);

        const validationReport = cycleValidator.validate(
            validation.representativeCycle,
            {
                cycleHistory: validation.repeatabilityCycles,
                convergenceCycles: validation.convergenceCycles
            }
        );
        renderCycleValidationReport(validationReport);
        renderMultiPointValidationReport(multiPointValidation);
        renderTransientValidationReport(transientValidation);

        const comparisonSourceReport = currentSessionReport();
        const nonRegressionReport = compareReportWithReference(
            comparisonSourceReport,
            loadModelReference()
        );
        renderNonRegressionReport(nonRegressionReport);

        setReferenceRunUi({
            phase: "Référence terminée",
            progressPercent: 100,
            message: `Tir déterministe terminé · ${multiPointValidation.counts.pass}/${multiPointValidation.points.length} points multipoints validés · transitoires ${validationStatusLabel(transientValidation.status).toLowerCase()} · répétabilité et convergence calculées.`
        });

        const report = currentSessionReport();
        saveCurrentSession(buildReferenceSessionLabel(report));
    } catch (error) {
        if (error instanceof ReferenceRunCancelledError) {
            setReferenceRunUi({
                phase: "Interrompu",
                progressPercent: referenceRun.progressPercent,
                message: "Tir de référence interrompu. Aucune session incomplète n’a été enregistrée."
            });
        } else {
            console.error("Reference run failed:", error);
            setReferenceRunUi({
                phase: "Échec du protocole",
                progressPercent: referenceRun.progressPercent,
                message: error?.message ?? "Le tir de référence a échoué."
            });
        }
    } finally {
        referenceRun.active = false;
        referenceRun.cancelRequested = false;
        ui.analysisSweepButton?.classList.remove("is-active");
        setText(ui.analysisSweepButton, "Lancer le tir de référence");
        if (ui.analysisEngineButton) ui.analysisEngineButton.disabled = false;
        if (ui.analysisClearButton) ui.analysisClearButton.disabled = false;
    }
}

function startAutomaticSweep() {
    if (referenceRun.active) {
        referenceRun.cancelRequested = true;
        setText(ui.dynoCaptureStatus, "Interruption demandée à la prochaine tranche de calcul.");
        return;
    }
    void executeReferenceRun();
}

function updateAutomaticSweep() {
}

function configureTabs() {
    const tabs = [...document.querySelectorAll("[data-Analysis-tab]")];
    const sections = [...document.querySelectorAll("[data-Analysis-section]")];

    function activate(tabName) {
        liveData.activeTab = tabName;

        for (const tab of tabs) {
            const active = tab.dataset.analysisTab === tabName;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
        }

        for (const section of sections) {
            const sectionName = section.dataset.analysisSection;
            section.hidden = tabName !== "overview" && sectionName !== tabName;
        }

        window.requestAnimationFrame(() => {
            charts.forEach(chart => chart.resize());
        });
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => activate(tab.dataset.analysisTab));
    });

    activate("overview");
}

function configureDensity() {
    document.querySelectorAll("[data-Analysis-density]").forEach(button => {
        button.addEventListener("click", () => {
            liveData.density = button.dataset.analysisDensity;
            document.querySelectorAll("[data-Analysis-density]").forEach(candidate => {
                candidate.classList.toggle(
                    "is-active",
                    candidate.dataset.analysisDensity === liveData.density
                );
            });
            applyDensityMode();
        });
    });

    applyDensityMode();
}

function configureExpandedPanels() {
    document.querySelectorAll("[data-expand-panel]").forEach(button => {
        button.addEventListener("click", () => {
            const panel = document.getElementById(button.dataset.expandPanel);
            if (!panel) return;

            const expanded = panel.classList.toggle("is-expanded");
            document.body.classList.toggle("Analysis-panel-open", expanded);
            button.textContent = expanded ? "Réduire" : "Agrandir";
            window.requestAnimationFrame(() => charts.forEach(chart => chart.resize()));
        });
    });

    window.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        const panel = document.querySelector(".Analysis-panel.is-expanded");
        if (!panel) return;
        panel.classList.remove("is-expanded");
        document.body.classList.remove("Analysis-panel-open");
        const button = panel.querySelector("[data-expand-panel]");
        if (button) button.textContent = "Agrandir";
        window.requestAnimationFrame(() => charts.forEach(chart => chart.resize()));
    });
}

function exportCycleCsv(cycle = getDisplayedCycle()) {
    if (!cycle?.samples?.length) return;
    const csv = motor.cycleRecorder.exportCsv(cycle);
    downloadText(
        `cycle-cylindre-${cycle.cylinderNumber ?? 1}-${Math.round(cycle.summary?.meanRpm ?? 0)}rpm.csv`,
        csv,
        "text/csv"
    );
}

function bindControls() {
    ui.analysisEngineButton?.addEventListener("click", () => {
        liveData.mode = "live";
        liveData.snapshot = null;
        ui.analysisSessionSelect && (ui.analysisSessionSelect.value = "live");
        updateSessionControls();
        motor.toggle();
    });

    ui.analysisSweepButton?.addEventListener("click", startAutomaticSweep);
    ui.analysisClearButton?.addEventListener("click", clearLiveData);

    ui.analysisExportReportButton?.addEventListener("click", () => {
        const report = currentSessionReport();
        downloadText(
            `rapport-validation-3sgte-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.json`,
            JSON.stringify(report, null, 2),
            "application/json"
        );
    });

    ui.analysisSessionSelect?.addEventListener("change", event => {
        selectSession(event.target.value);
    });
    ui.analysisDeleteSessionButton?.addEventListener("click", deleteSelectedSession);
    ui.analysisBackButton?.addEventListener("click", () => {
        if (window.history.length > 1) {
            window.history.back();
        }
    });

    ui.cycleCylinderSelect?.addEventListener("change", event => {
        const index = clamp(Number(event.target.value) || 0, 0, CYLINDER_COUNT - 1);
        motor.cycleRecorder.setCylinder?.(index);
        liveData.cycle = null;
        liveData.displayedCycle = null;
        renderCycle(null);
    });

    ui.cycleFreezeButton?.addEventListener("click", () => {
        liveData.frozenCycle = !liveData.frozenCycle;
        if (liveData.frozenCycle) {
            liveData.displayedCycle = liveData.cycle;
        } else {
            liveData.displayedCycle = null;
        }
        setText(ui.cycleFreezeButton, liveData.frozenCycle ? "Reprendre le direct" : "Figer le cycle");
        renderCycle();
    });

    ui.cycleExportButton?.addEventListener("click", () => exportCycleCsv());
    ui.pvExportButton?.addEventListener("click", () => exportCycleCsv());
    ui.cycleValidationRunButton?.addEventListener("click", () => {
        runCycleValidation();
    });
    ui.cycleValidationExportButton?.addEventListener("click", () => {
        const report = liveData.cycleValidationReport ?? runCycleValidation();
        if (!report) return;
        downloadText(
            `validation-cycle-3sgte-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`,
            cycleValidationReportToCsv(report),
            "text/csv;charset=utf-8"
        );
    });
    ui.multiPointValidationExportButton?.addEventListener("click", () => {
        const report = liveData.multiPointValidation;
        if (!report?.points?.length) return;
        downloadText(
            `validation-multipoint-3sgte-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`,
            multiPointValidationToCsv(report),
            "text/csv;charset=utf-8"
        );
    });

    ui.transientValidationExportButton?.addEventListener("click", () => {
        const report = liveData.transientValidation;
        if (!report?.checks?.length) return;
        downloadText(
            `validation-transitoire-3sgte-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`,
            transientValidationToCsv(report),
            "text/csv;charset=utf-8"
        );
    });

    ui.nonRegressionSetReferenceButton?.addEventListener(
        "click",
        setCurrentSessionAsModelReference
    );
    ui.nonRegressionExportReferenceButton?.addEventListener(
        "click",
        exportModelReference
    );
    ui.nonRegressionImportReferenceButton?.addEventListener("click", () => {
        ui.nonRegressionImportFileInput?.click();
    });
    ui.nonRegressionImportFileInput?.addEventListener("change", event => {
        void importModelReferenceFile(event.target.files?.[0]);
    });
    ui.nonRegressionDeleteReferenceButton?.addEventListener(
        "click",
        deleteModelReference
    );
    ui.nonRegressionExportComparisonButton?.addEventListener("click", () => {
        const report = liveData.nonRegressionReport;
        if (!report?.rows?.length) return;
        downloadText(
            `non-regression-3sgte-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`,
            nonRegressionReportToCsv(report),
            "text/csv;charset=utf-8"
        );
    });

    ui.submoduleUnitTestRunButton?.addEventListener(
        "click",
        runSubmoduleUnitTests
    );
    ui.submoduleUnitTestExportButton?.addEventListener("click", () => {
        const report = liveData.submoduleUnitTestReport;
        if (!report?.rows?.length) return;
        downloadText(
            `tests-unitaires-3sgte-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`,
            submoduleUnitTestReportToCsv(report),
            "text/csv;charset=utf-8"
        );
    });

    ui.pvZoomButton?.addEventListener("click", () => {
        liveData.pvPumpingZoom = !liveData.pvPumpingZoom;
        setText(
            ui.pvZoomButton,
            liveData.pvPumpingZoom ? "Vue cycle complet" : "Zoom boucle de pompage"
        );
        renderPv();
    });
}

motor.telemetry.subscribe(sample => {
    liveData.latestSample = sample;
    liveData.telemetry.push(sample);

    const minimumTime = sample.time - TELEMETRY_DISPLAY_SECONDS;
    while (liveData.telemetry.length > MAX_TELEMETRY_POINTS
    || liveData.telemetry[0]?.time < minimumTime) {
        liveData.telemetry.shift();
    }

    dynoSweep.ingest(sample);
    if (dynoSweep.dirty) {
        liveData.dynoPoints = dynoSweep.getPoints();
    }
});

motor.cycleRecorder.subscribe(cycle => {
    liveData.cycle = cycle;
    if (!liveData.frozenCycle) {
        liveData.displayedCycle = cycle;
    }
    if (liveData.mode === "live") {
        renderCycle(cycle);
    }
});

function loadInitialSnapshot() {
    populateSessionSelector();
    const snapshot = loadViewerSnapshot();
    if (snapshot && ui.analysisSessionSelect) {
        ui.analysisSessionSelect.value = "viewer-snapshot";
        selectSession("viewer-snapshot");
    }
}

let simulationAccumulator = 0;
let lastFrameTime = performance.now();

function advancePhysics(deltaTime) {
    simulationAccumulator = Math.min(
        simulationAccumulator + deltaTime,
        MAX_ACCUMULATED_TIME
    );

    const start = performance.now();
    let chunks = 0;

    while (simulationAccumulator >= PHYSICS_CHUNK_SECONDS
    && chunks < MAX_PHYSICS_CHUNKS_PER_FRAME
    && performance.now() - start < MAX_PHYSICS_BUDGET_MS) {
        motor.update(PHYSICS_CHUNK_SECONDS);
        simulationAccumulator -= PHYSICS_CHUNK_SECONDS;
        chunks++;
    }
}

function animate(currentTime) {
    let deltaTime = (currentTime - lastFrameTime) / 1000;
    lastFrameTime = currentTime;
    deltaTime = clamp(deltaTime, 0, 0.05);

    if (!document.hidden) {
        updateAutomaticSweep(deltaTime);
        if (!referenceRun.active) {
            advancePhysics(deltaTime);
        }
    }

    if (liveData.mode === "live"
        && currentTime - liveData.lastChartRefresh >= CHART_REFRESH_INTERVAL_MS) {
        liveData.lastChartRefresh = currentTime;
        if (dynoSweep.dirty) {
            liveData.dynoPoints = dynoSweep.getPoints();
            renderDyno();
            dynoSweep.dirty = false;
        }
        renderTurbo();
        renderResiduals();
    }

    if (currentTime - liveData.lastHeaderRefresh >= HEADER_REFRESH_INTERVAL_MS) {
        liveData.lastHeaderRefresh = currentTime;
        renderHeader();
    }

    requestAnimationFrame(animate);
}

configureTabs();
configureDensity();
configureExpandedPanels();
bindControls();
clearMultiPointValidationReport();
clearTransientValidationReport();
renderNonRegressionReport(compareReportWithReference(null, loadModelReference()));
runSubmoduleUnitTests();
loadInitialSnapshot();
renderHeader();
refreshAllCharts();
requestAnimationFrame(animate);

window.engineAnalysis = {
    motor,
    dynoSweep,
    charts: {
        dyno: dynoChart,
        cycle: cycleChart,
        pv: pvChart,
        turbo: turboChart,
        residual: residualChart
    },
    cycleValidator,
    runCycleValidation,
    runReferenceTest: executeReferenceRun,
    cancelReferenceTest: () => {
        referenceRun.cancelRequested = true;
    },
    getReferenceRunStatus: () => ({ ...referenceRun }),
    getCycleValidationReport: () => liveData.cycleValidationReport,
    getMultiPointValidationReport: () =>
        liveData.multiPointValidation,
    getTransientValidationReport: () =>
        liveData.transientValidation,
    getModelReference: loadModelReference,
    setCurrentSessionAsModelReference,
    compareCurrentSessionToReference: refreshNonRegressionComparison,
    getNonRegressionReport: () => liveData.nonRegressionReport,
    runSubmoduleUnitTests,
    getSubmoduleUnitTestReport: () =>
        liveData.submoduleUnitTestReport,
    saveCurrentSession,
    exportReport: currentSessionReport
};

window.addEventListener("beforeunload", () => {
    charts.forEach(chart => chart.destroy());
}, { once: true });
