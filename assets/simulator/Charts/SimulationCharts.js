// Crée les premiers graphiques de validation :
// 1. courbe de banc couple / puissance décomposés selon le RPM ;
// 2. bilan de puissance et régime du turbo pendant le tir ;
// 3. résidus de conservation de masse et d'énergie.
// Chart.js est reçu en dépendance afin que le moteur reste utilisable même si
// la bibliothèque graphique n'a pas été chargée.

import ChartJsTelemetryAdapter from "../Telemetry/ChartJsTelemetryAdapter.js";
import DynoSweepRecorder from "./DynoSweepRecorder.js";
import CylinderCycleChart from "./CylinderCycleChart.js";

const HORSEPOWER_WATTS = 735.49875;
const TELEMETRY_HISTORY_POINTS = 20 * 20; // 20 secondes à 20 points/s
const CHART_REFRESH_INTERVAL_MS = 250; // 4 rafraîchissements visuels/s
const CHART_POINT_INTERVAL_SECONDS = 1 / 20;
const MINIMUM_LOG_RESIDUAL = 1e-12;

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function lineDataset(label, yAxisID, color, extra = {}) {
    return {
        label,
        data: [],
        yAxisID,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.12,
        normalized: true,
        parsing: false,
        ...extra
    };
}

function getCanvas(id) {
    const canvas = document.getElementById(id);
    return canvas instanceof HTMLCanvasElement ? canvas : null;
}

function commonPlugins(title) {
    return {
        title: {
            display: true,
            text: title,
            color: "#f4f4f4",
            font: { size: 15 }
        },
        legend: {
            labels: {
                color: "#dddddd",
                usePointStyle: true,
                boxWidth: 10
            }
        },
        tooltip: {
            enabled: false
        },
        decimation: {
            enabled: true,
            algorithm: "min-max"
        }
    };
}

function commonLinearScale(title, position = "left") {
    return {
        type: "linear",
        position,
        beginAtZero: false,
        grid: {
            color: position === "left"
                ? "rgba(255,255,255,0.08)"
                : "rgba(255,255,255,0.025)"
        },
        ticks: { color: "#cfcfcf" },
        title: {
            display: true,
            text: title,
            color: "#cfcfcf"
        }
    };
}

function createDynoChart(Chart, canvas) {
    return new Chart(canvas, {
        type: "line",
        data: {
            datasets: [
                lineDataset("Couple cycle fermé", "yTorque", "#f5a623"),
                lineDataset("Pompage", "yTorque", "#36c5f0", { borderDash: [7, 4] }),
                lineDataset("Frottements", "yTorque", "#ff5c5c", { borderDash: [4, 4] }),
                lineDataset("Accessoires", "yTorque", "#d77cff", { borderDash: [2, 4] }),
                lineDataset("Couple moteur net", "yTorque", "#39e75f", { borderWidth: 3 }),
                lineDataset("Puissance moteur", "yPower", "#f5f5f5", { borderWidth: 3 })
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            devicePixelRatio: 1,
            events: [],
            interaction: { mode: "nearest", intersect: false },
            plugins: commonPlugins(
                "Tir au banc — décomposition du couple et de la puissance"
            ),
            scales: {
                x: {
                    type: "linear",
                    min: 1000,
                    max: 7500,
                    grid: { color: "rgba(255,255,255,0.08)" },
                    ticks: { color: "#cfcfcf" },
                    title: {
                        display: true,
                        text: "Régime moteur (tr/min)",
                        color: "#cfcfcf"
                    }
                },
                yTorque: commonLinearScale("Couple (N·m)", "left"),
                yPower: commonLinearScale("Puissance (ch)", "right")
            }
        }
    });
}

function createTurboChart(Chart, canvas) {
    return new Chart(canvas, {
        type: "line",
        data: {
            datasets: [
                lineDataset("Turbine", "yPower", "#f5a623"),
                lineDataset("Compresseur", "yPower", "#36c5f0"),
                lineDataset("Pertes arbre", "yPower", "#ff5c5c", { borderDash: [5, 4] }),
                lineDataset("Puissance nette rotor", "yPower", "#39e75f", { borderWidth: 3 }),
                lineDataset("Régime turbo", "yTurbo", "#f5f5f5", { borderWidth: 3 })
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            devicePixelRatio: 1,
            events: [],
            interaction: { mode: "nearest", intersect: false },
            plugins: commonPlugins(
                "Turbo — puissances d'arbre et régime pendant les 20 dernières secondes"
            ),
            scales: {
                x: {
                    type: "linear",
                    grid: { color: "rgba(255,255,255,0.08)" },
                    ticks: { color: "#cfcfcf" },
                    title: {
                        display: true,
                        text: "Temps simulé (s)",
                        color: "#cfcfcf"
                    }
                },
                yPower: commonLinearScale("Puissance (kW)", "left"),
                yTurbo: commonLinearScale("Régime turbo (krpm)", "right")
            }
        }
    });
}

function createResidualChart(Chart, canvas) {
    return new Chart(canvas, {
        type: "line",
        data: {
            datasets: [
                lineDataset("Résidu masse maximal", "yResidual", "#36c5f0"),
                lineDataset("Résidu énergie maximal", "yResidual", "#f5a623")
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            devicePixelRatio: 1,
            events: [],
            interaction: { mode: "nearest", intersect: false },
            plugins: commonPlugins(
                "Fermeture numérique — pires résidus des 20 dernières secondes"
            ),
            scales: {
                x: {
                    type: "linear",
                    grid: { color: "rgba(255,255,255,0.08)" },
                    ticks: { color: "#cfcfcf" },
                    title: {
                        display: true,
                        text: "Temps simulé (s)",
                        color: "#cfcfcf"
                    }
                },
                yResidual: {
                    type: "logarithmic",
                    min: 1e-10,
                    max: 100,
                    grid: { color: "rgba(255,255,255,0.08)" },
                    ticks: {
                        color: "#cfcfcf",
                        callback(value) {
                            return Number(value).toExponential(0);
                        }
                    },
                    title: {
                        display: true,
                        text: "Résidu normalisé (%) — échelle logarithmique",
                        color: "#cfcfcf"
                    }
                }
            }
        }
    });
}

function writeText(element, text) {
    if (element) {
        element.textContent = text;
    }
}

export default class SimulationCharts {
    constructor({ Chart, recorder, cycleRecorder = null }) {
        if (typeof Chart !== "function") {
            throw new TypeError("Chart.js n'est pas disponible.");
        }

        if (!recorder || typeof recorder.subscribe !== "function") {
            throw new TypeError("Un TelemetryRecorder valide est requis.");
        }

        this.Chart = Chart;
        this.recorder = recorder;
        this.lastRefreshTime = 0;
        this.visible = true;

        this.captureButton = document.getElementById("dynoCaptureButton");
        this.clearButton = document.getElementById("clearChartsButton");
        this.captureStatus = document.getElementById("dynoCaptureStatus");
        this.pointCount = document.getElementById("dynoPointCount");

        this.dynoSweep = new DynoSweepRecorder({ rpmBinSize: 100 });

        const dynoCanvas = getCanvas("dynoPerformanceChart");
        const turboCanvas = getCanvas("turboPowerChart");
        const residualCanvas = getCanvas("conservationResidualChart");

        this.dynoChart = dynoCanvas
            ? createDynoChart(Chart, dynoCanvas)
            : null;
        this.turboChart = turboCanvas
            ? createTurboChart(Chart, turboCanvas)
            : null;
        this.residualChart = residualCanvas
            ? createResidualChart(Chart, residualCanvas)
            : null;

        // Le graphe 720° possède son propre flux : un événement est reçu
        // uniquement quand CycleRecorder publie un cycle complet.
        this.cylinderCycleChart = cycleRecorder
            ? new CylinderCycleChart({ Chart, cycleRecorder })
            : null;

        this.turboAdapter = this.turboChart
            ? new ChartJsTelemetryAdapter({
                recorder,
                chart: this.turboChart,
                maximumPoints: TELEMETRY_HISTORY_POINTS,
                minimumPointIntervalSeconds: CHART_POINT_INTERVAL_SECONDS,
                series: [
                    {
                        datasetIndex: 0,
                        key: "turbinePower",
                        transform: value => finite(value) / 1000
                    },
                    {
                        datasetIndex: 1,
                        key: "compressorPower",
                        transform: value => finite(value) / 1000
                    },
                    {
                        datasetIndex: 2,
                        key: "turboBearingFrictionPower",
                        transform: value => finite(value) / 1000
                    },
                    {
                        datasetIndex: 3,
                        key: "turboNetPower",
                        transform: value => finite(value) / 1000
                    },
                    {
                        datasetIndex: 4,
                        key: "turboRPM",
                        transform: value => finite(value) / 1000
                    }
                ]
            })
            : null;

        this.residualAdapter = this.residualChart
            ? new ChartJsTelemetryAdapter({
                recorder,
                chart: this.residualChart,
                maximumPoints: TELEMETRY_HISTORY_POINTS,
                minimumPointIntervalSeconds: CHART_POINT_INTERVAL_SECONDS,
                series: [
                    {
                        datasetIndex: 0,
                        key: "maximumMassResidualPercent",
                        transform: value => Math.max(
                            Math.abs(finite(value)),
                            MINIMUM_LOG_RESIDUAL
                        )
                    },
                    {
                        datasetIndex: 1,
                        key: "maximumEnergyResidualPercent",
                        transform: value => Math.max(
                            Math.abs(finite(value)),
                            MINIMUM_LOG_RESIDUAL
                        )
                    }
                ]
            })
            : null;

        this.unsubscribe = recorder.subscribe(sample => {
            this.dynoSweep.ingest(sample);
        });

        this.bindControls();
        this.updateControlLabels();
    }

    bindControls() {
        this.captureButton?.addEventListener("click", () => {
            this.dynoSweep.toggle();
            this.updateControlLabels();
        });

        this.clearButton?.addEventListener("click", () => {
            this.dynoSweep.clear();

            // Le recorder est vidé pour empêcher la relecture des échantillons précédents.
            this.recorder.clear({ resetTime: false });
            this.turboAdapter?.reset();
            this.residualAdapter?.reset();
            this.cylinderCycleChart?.clear();

            this.refreshDynoChart();
            this.updateControlLabels();
        });
    }

    updateControlLabels() {
        if (this.captureButton) {
            this.captureButton.textContent = this.dynoSweep.capturing
                ? "Arrêter l'enregistrement du tir"
                : "Démarrer un nouveau tir";
        }

        writeText(
            this.captureStatus,
            this.dynoSweep.capturing ? "ENREGISTREMENT" : "En attente"
        );
        writeText(
            this.pointCount,
            `${this.dynoSweep.getPointCount()} tranches RPM`
        );
    }

    refreshDynoChart() {
        if (!this.dynoChart || !this.dynoSweep.dirty) {
            return false;
        }

        const points = this.dynoSweep.getPoints();
        const datasets = this.dynoChart.data.datasets;

        datasets[0].data = points.map(point => ({
            x: point.rpm,
            y: point.closedCycleIndicatedTorque
        }));
        datasets[1].data = points.map(point => ({
            x: point.rpm,
            y: point.pumpingTorque
        }));
        datasets[2].data = points.map(point => ({
            x: point.rpm,
            y: -Math.abs(point.mechanicalFrictionTorque)
        }));
        datasets[3].data = points.map(point => ({
            x: point.rpm,
            y: -Math.abs(point.accessoryTorque)
        }));
        datasets[4].data = points.map(point => ({
            x: point.rpm,
            y: point.torque
        }));
        datasets[5].data = points.map(point => ({
            x: point.rpm,
            y: point.power / HORSEPOWER_WATTS
        }));

        this.dynoChart.update("none");
        this.dynoSweep.dirty = false;
        this.updateControlLabels();

        return true;
    }

    setVisible(visible) {
        this.visible = Boolean(visible);
        this.cylinderCycleChart?.setVisible?.(this.visible);
    }

    update(currentTime = performance.now()) {
        if (!this.visible) {
            return;
        }

        if (currentTime - this.lastRefreshTime
            < CHART_REFRESH_INTERVAL_MS) {
            return;
        }

        this.lastRefreshTime = currentTime;

        this.turboAdapter?.update();
        this.residualAdapter?.update();
        this.cylinderCycleChart?.update(currentTime);
        this.refreshDynoChart();
    }

    destroy() {
        this.unsubscribe?.();
        this.dynoChart?.destroy();
        this.turboChart?.destroy();
        this.residualChart?.destroy();
        this.cylinderCycleChart?.destroy();
    }
}

export function initializeSimulationCharts({ recorder, cycleRecorder = null }) {
    const Chart = globalThis.Chart;

    if (typeof Chart !== "function") {
        console.warn(
            "Chart.js n'est pas chargé : la simulation continue sans graphiques."
        );
        return null;
    }

    try {
        return new SimulationCharts({ Chart, recorder, cycleRecorder });
    } catch (error) {
        console.error(
            "Impossible d'initialiser les graphiques de simulation.",
            error
        );
        return null;
    }
}
