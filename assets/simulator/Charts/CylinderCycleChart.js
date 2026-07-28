// Inspecteur Chart.js d'un cycle thermodynamique complet de 720°.
// Le graphique consomme uniquement les cycles complets publiés par
// CycleRecorder.js. Il ne lit jamais directement les sous-pas du moteur et ne
// peut donc ni ralentir ni modifier la simulation physique.

const PA_PER_BAR = 100000;
const METERS_TO_MILLIMETERS = 1000;
const PA_PER_BAR_IMEP = 100000;
const CYCLE_CHART_REFRESH_INTERVAL_MS = 300; // ~3 Hz maximum

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function getCanvas(id) {
    const canvas = document.getElementById(id);
    return canvas instanceof HTMLCanvasElement ? canvas : null;
}

function setText(element, text) {
    if (element) {
        element.textContent = text;
    }
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
        tension: 0,
        normalized: true,
        parsing: false,
        ...extra
    };
}

/**
 * Retourne les événements à dessiner. Les couleurs distinguent :
 * - distribution admission ;
 * - combustion ;
 * - distribution échappement ;
 * - repères géométriques PMH / PMB.
 */
function buildEventMarkers(cycle) {
    const events = cycle?.events ?? {};

    return [
        { angle: 0, label: "PMH A", color: "#9aa0a6", dash: [3, 5] },
        { angle: finite(events.intakeValveOpenDeg, 0), label: "IVO", color: "#36c5f0" },
        { angle: 180, label: "PMB A", color: "#9aa0a6", dash: [3, 5] },
        { angle: finite(events.intakeValveCloseDeg, 245), label: "IVC", color: "#36c5f0" },
        { angle: finite(events.ignitionStartDeg, 345), label: "Allumage", color: "#f5a623" },
        { angle: 360, label: "PMH C", color: "#f5f5f5", dash: [3, 5] },
        { angle: finite(events.ca10Deg, 365), label: "CA10", color: "#ffcf56" },
        { angle: finite(events.ca50Deg, 370), label: "CA50", color: "#ff8c42", width: 2 },
        { angle: finite(events.ca90Deg, 385), label: "CA90", color: "#ff5c5c" },
        { angle: finite(events.ignitionEndDeg, 395), label: "Fin comb.", color: "#b95cff" },
        { angle: finite(events.exhaustValveOpenDeg, 500), label: "EVO", color: "#ff5c5c" },
        { angle: 540, label: "PMB D", color: "#9aa0a6", dash: [3, 5] },
        { angle: finite(events.exhaustValveCloseDeg, 720), label: "EVC", color: "#ff5c5c" },
        { angle: 720, label: "PMH E", color: "#9aa0a6", dash: [3, 5] }
    ].filter(marker => Number.isFinite(marker.angle));
}

function buildPhaseRanges(cycle) {
    const events = cycle?.events ?? {};
    const ivc = clamp(finite(events.intakeValveCloseDeg, 245), 0, 360);
    const evo = clamp(finite(events.exhaustValveOpenDeg, 500), 360, 720);

    return [
        {
            start: 0,
            end: ivc,
            label: "Admission",
            color: "rgba(54, 197, 240, 0.055)"
        },
        {
            start: ivc,
            end: 360,
            label: "Compression",
            color: "rgba(210, 215, 220, 0.035)"
        },
        {
            start: 360,
            end: evo,
            label: "Combustion / détente",
            color: "rgba(245, 166, 35, 0.055)"
        },
        {
            start: evo,
            end: 720,
            label: "Échappement",
            color: "rgba(255, 92, 92, 0.045)"
        }
    ];
}

/**
 * Plugin local : fonds de phases + traits verticaux d'événements.
 * Aucune dépendance Chart.js additionnelle n'est nécessaire.
 */
const cycleEventPlugin = {
    id: "cycle720Events",

    beforeDraw(chart, _args, options) {
        const cycle = options?.cycle;
        const xScale = chart.scales.x;
        const chartArea = chart.chartArea;

        if (!cycle || !xScale || !chartArea) {
            return;
        }

        const context = chart.ctx;
        context.save();

        for (const phase of buildPhaseRanges(cycle)) {
            const left = xScale.getPixelForValue(phase.start);
            const right = xScale.getPixelForValue(phase.end);

            context.fillStyle = phase.color;
            context.fillRect(
                left,
                chartArea.top,
                Math.max(right - left, 0),
                chartArea.bottom - chartArea.top
            );
        }

        context.restore();
    },

    afterDatasetsDraw(chart, _args, options) {
        const cycle = options?.cycle;
        const xScale = chart.scales.x;
        const chartArea = chart.chartArea;

        if (!cycle || !xScale || !chartArea) {
            return;
        }

        const context = chart.ctx;
        const markers = buildEventMarkers(cycle);

        context.save();
        context.font = "10px 'Courier New', monospace";
        context.textAlign = "left";
        context.textBaseline = "middle";

        markers.forEach((marker, index) => {
            const x = xScale.getPixelForValue(marker.angle);
            if (x < chartArea.left - 1 || x > chartArea.right + 1) {
                return;
            }

            context.beginPath();
            context.strokeStyle = marker.color;
            context.lineWidth = marker.width ?? 1;
            context.setLineDash(marker.dash ?? [5, 4]);
            context.moveTo(x, chartArea.top);
            context.lineTo(x, chartArea.bottom);
            context.stroke();

            // Les libellés sont tournés à -90° et répartis sur trois hauteurs
            // pour éviter les collisions autour de l'allumage et des CAx.
            const rowOffset = (index % 3) * 12;
            context.save();
            context.translate(x + 3, chartArea.top + 60 + rowOffset);
            context.rotate(-Math.PI / 2);
            context.fillStyle = marker.color;
            context.fillText(`${marker.label} ${marker.angle.toFixed(1)}°`, 0, 0);
            context.restore();
        });

        context.restore();
    }
};

function createChart(Chart, canvas) {
    return new Chart(canvas, {
        type: "line",
        plugins: [cycleEventPlugin],
        data: {
            datasets: [
                lineDataset("Pression cylindre", "yCylinderPressure", "#f5f5f5", {
                    borderWidth: 3,
                    order: 1
                }),
                lineDataset("Pression admission", "yBoundaryPressure", "#36c5f0", {
                    borderDash: [8, 5],
                    borderWidth: 1.7,
                    order: 3
                }),
                lineDataset("Pression échappement", "yBoundaryPressure", "#ff5c5c", {
                    borderDash: [8, 5],
                    borderWidth: 1.7,
                    order: 3
                }),
                lineDataset("Levée admission", "yValveLift", "#00d4ff", {
                    borderWidth: 2,
                    order: 2
                }),
                lineDataset("Levée échappement", "yValveLift", "#ff6b6b", {
                    borderWidth: 2,
                    order: 2
                })
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            normalized: true,
            devicePixelRatio: 1,
            events: [],
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                cycle720Events: {
                    cycle: null
                },
                title: {
                    display: true,
                    text: "Cycle cylindre — pression, conditions aux limites et soupapes",
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
                    mode: "index",
                    intersect: false,
                    callbacks: {
                        title(items) {
                            const angle = items?.[0]?.parsed?.x;
                            return Number.isFinite(angle)
                                ? `${angle.toFixed(1)}° vilebrequin`
                                : "";
                        },
                        label(context) {
                            const value = context.parsed.y;
                            const axis = context.dataset.yAxisID;

                            if (!Number.isFinite(value)) {
                                return `${context.dataset.label}: —`;
                            }

                            if (axis === "yValveLift") {
                                return `${context.dataset.label}: ${value.toFixed(2)} mm`;
                            }

                            return `${context.dataset.label}: ${value.toFixed(2)} bar abs`;
                        }
                    }
                },
                decimation: {
                    enabled: true,
                    algorithm: "min-max"
                }
            },
            scales: {
                x: {
                    type: "linear",
                    min: 0,
                    max: 720,
                    grid: {
                        color: "rgba(255,255,255,0.08)"
                    },
                    ticks: {
                        color: "#cfcfcf",
                        stepSize: 90,
                        callback(value) {
                            return `${value}°`;
                        }
                    },
                    title: {
                        display: true,
                        text: "Angle vilebrequin local du cylindre (°CA)",
                        color: "#cfcfcf"
                    }
                },
                yCylinderPressure: {
                    type: "linear",
                    position: "left",
                    beginAtZero: true,
                    suggestedMax: 70,
                    grid: {
                        color: "rgba(255,255,255,0.08)"
                    },
                    ticks: {
                        color: "#f5f5f5"
                    },
                    title: {
                        display: true,
                        text: "Pression cylindre (bar abs)",
                        color: "#f5f5f5"
                    }
                },
                yBoundaryPressure: {
                    type: "linear",
                    position: "right",
                    beginAtZero: true,
                    suggestedMax: 4,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: "#a9dff0"
                    },
                    title: {
                        display: true,
                        text: "Admission / échappement (bar abs)",
                        color: "#a9dff0"
                    }
                },
                yValveLift: {
                    type: "linear",
                    position: "right",
                    offset: true,
                    beginAtZero: true,
                    suggestedMax: 10,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: "#d7a6ff",
                        callback(value) {
                            return `${value} mm`;
                        }
                    },
                    title: {
                        display: true,
                        text: "Levée soupape (mm)",
                        color: "#d7a6ff"
                    }
                }
            }
        }
    });
}

export default class CylinderCycleChart {
    constructor({ Chart, cycleRecorder }) {
        if (typeof Chart !== "function") {
            throw new TypeError("Chart.js n'est pas disponible.");
        }
        if (!cycleRecorder || typeof cycleRecorder.subscribe !== "function") {
            throw new TypeError("Un CycleRecorder valide est requis.");
        }

        this.cycleRecorder = cycleRecorder;
        this.live = true;
        this.latestDisplayedCycle = null;
        this.pendingCycle = null;
        this.lastRefreshTime = 0;
        this.visible = true;

        this.canvas = getCanvas("cylinderCycleChart");
        this.chart = this.canvas ? createChart(Chart, this.canvas) : null;

        this.cylinderSelect = document.getElementById("cycleCylinderSelect");
        this.liveButton = document.getElementById("cycleLiveButton");
        this.exportButton = document.getElementById("cycleExportButton");
        this.status = document.getElementById("cycleCaptureStatus");

        this.meanRpm = document.getElementById("cycleMeanRpm");
        this.meanBoost = document.getElementById("cycleMeanBoost");
        this.peakPressure = document.getElementById("cyclePeakPressure");
        this.ca50 = document.getElementById("cycleCA50");
        this.netImep = document.getElementById("cycleNetIMEP");
        this.sampleCount = document.getElementById("cycleSampleCount");

        if (this.cylinderSelect) {
            this.cylinderSelect.value = String(cycleRecorder.cylinderIndex);
        }

        this.bindControls();
        this.unsubscribe = cycleRecorder.subscribe(cycle => {
            if (this.cylinderSelect) {
                this.cylinderSelect.value = String(cycle.cylinderIndex);
            }
            if (this.live) {
                // À haut régime, un nouveau cycle peut arriver 50 fois/s.
                // Seul le plus récent est conservé puis dessiné à 10 Hz max.
                this.pendingCycle = cycle;
            } else {
                this.updateStatus();
            }
        });

        const latestCycle = this.findLatestCycleForSelectedCylinder();
        if (latestCycle) {
            this.displayCycle(latestCycle);
        } else {
            this.updateStatus();
        }
    }

    bindControls() {
        this.cylinderSelect?.addEventListener("change", event => {
            const index = clamp(Number(event.target.value), 0, 3);
            this.cycleRecorder.setCylinder(index);
            this.latestDisplayedCycle = null;
            this.pendingCycle = null;
            this.clearChartData();
            this.updateSummary(null);
            this.updateStatus("Acquisition du prochain cycle complet...");
        });

        this.liveButton?.addEventListener("click", () => {
            this.live = !this.live;
            this.updateStatus();

            if (this.live) {
                const latestCycle = this.findLatestCycleForSelectedCylinder();
                if (latestCycle) {
                    this.pendingCycle = latestCycle;
                    this.update(performance.now(), true);
                }
            }
        });

        this.exportButton?.addEventListener("click", () => {
            this.exportDisplayedCycle();
        });
    }

    findLatestCycleForSelectedCylinder() {
        const selectedIndex = this.cycleRecorder.cylinderIndex;
        const history = this.cycleRecorder.getHistory();

        for (let index = history.length - 1; index >= 0; index--) {
            if (history[index]?.cylinderIndex === selectedIndex) {
                return history[index];
            }
        }

        return null;
    }

    clearChartData() {
        if (!this.chart) {
            return;
        }

        for (const dataset of this.chart.data.datasets) {
            dataset.data = [];
        }
        this.chart.options.plugins.cycle720Events.cycle = null;
        this.chart.update("none");
    }

    displayCycle(cycle) {
        if (!cycle || !Array.isArray(cycle.samples)) {
            return;
        }

        this.latestDisplayedCycle = cycle;

        if (this.chart) {
            const samples = cycle.samples;
            const datasets = this.chart.data.datasets;

            datasets[0].data = samples.map(sample => ({
                x: finite(sample.angleDeg),
                y: finite(sample.cylinderPressurePa) / PA_PER_BAR
            }));
            datasets[1].data = samples.map(sample => ({
                x: finite(sample.angleDeg),
                y: finite(sample.intakePressurePa) / PA_PER_BAR
            }));
            datasets[2].data = samples.map(sample => ({
                x: finite(sample.angleDeg),
                y: finite(sample.exhaustPressurePa) / PA_PER_BAR
            }));
            datasets[3].data = samples.map(sample => ({
                x: finite(sample.angleDeg),
                y: finite(sample.intakeValveLiftM)
                    * METERS_TO_MILLIMETERS
            }));
            datasets[4].data = samples.map(sample => ({
                x: finite(sample.angleDeg),
                y: finite(sample.exhaustValveLiftM)
                    * METERS_TO_MILLIMETERS
            }));

            this.chart.options.plugins.cycle720Events.cycle = cycle;
            this.chart.options.plugins.title.text = [
                `Cycle cylindre ${cycle.cylinderNumber}`,
                `${finite(cycle.summary?.meanRpm).toFixed(0)} tr/min — `
                + `${finite(cycle.summary?.meanBoostBarGauge).toFixed(2)} bar de boost`
            ];
            this.chart.update("none");
        }

        this.updateSummary(cycle);
        this.updateStatus();
    }

    updateSummary(cycle) {
        const summary = cycle?.summary;

        if (!summary) {
            setText(this.meanRpm, "—");
            setText(this.meanBoost, "—");
            setText(this.peakPressure, "—");
            setText(this.ca50, "—");
            setText(this.netImep, "—");
            setText(this.sampleCount, "—");
            return;
        }

        setText(this.meanRpm, `${finite(summary.meanRpm).toFixed(0)} tr/min`);
        setText(
            this.meanBoost,
            `${finite(summary.meanBoostBarGauge).toFixed(2)} bar`
        );
        setText(
            this.peakPressure,
            `${(finite(summary.peakPressurePa) / PA_PER_BAR).toFixed(1)} bar `
            + `à ${finite(summary.peakPressureAngleDeg).toFixed(1)}°`
        );
        setText(
            this.ca50,
            `${finite(cycle.events?.ca50Deg).toFixed(1)}° CA `
            + `(${finite(summary.meanCA50DegAfterTdc).toFixed(1)}° après PMH)`
        );
        setText(
            this.netImep,
            `${(finite(summary.netIndicatedMeanEffectivePressurePa)
                / PA_PER_BAR_IMEP).toFixed(2)} bar`
        );
        setText(
            this.sampleCount,
            `${Math.trunc(finite(summary.sampleCount))} points`
        );
    }

    updateStatus(message = null) {
        if (this.liveButton) {
            this.liveButton.textContent = this.live
                ? "Figer ce cycle"
                : "Reprendre le suivi en direct";
        }

        if (message) {
            setText(this.status, message);
            return;
        }

        if (!this.latestDisplayedCycle) {
            setText(
                this.status,
                `Cylindre ${this.cycleRecorder.cylinderIndex + 1} — attente d'un cycle complet`
            );
            return;
        }

        setText(
            this.status,
            this.live
                ? `Suivi direct — cycle #${this.latestDisplayedCycle.sequence}`
                : `Cycle figé #${this.latestDisplayedCycle.sequence}`
        );
    }

    exportDisplayedCycle() {
        const cycle = this.latestDisplayedCycle;
        if (!cycle) {
            this.updateStatus("Aucun cycle complet à exporter.");
            return;
        }

        const csv = this.cycleRecorder.exportCsv(cycle);
        if (!csv) {
            this.updateStatus("Export CSV impossible.");
            return;
        }

        const blob = new Blob([csv], {
            type: "text/csv;charset=utf-8"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = `cycle-cylindre-${cycle.cylinderNumber}`
            + `-${Math.round(finite(cycle.summary?.meanRpm))}rpm.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        this.updateStatus("Cycle exporté au format CSV.");
    }


    setVisible(visible) {
        this.visible = Boolean(visible);
        if (this.visible && this.pendingCycle) {
            this.update(performance.now(), true);
        }
    }

    update(currentTime = performance.now(), force = false) {
        if (!this.visible || !this.live || !this.pendingCycle) {
            return false;
        }

        if (!force
            && currentTime - this.lastRefreshTime
            < CYCLE_CHART_REFRESH_INTERVAL_MS) {
            return false;
        }

        const cycle = this.pendingCycle;
        this.pendingCycle = null;
        this.lastRefreshTime = currentTime;
        this.displayCycle(cycle);
        return true;
    }

    clear() {
        this.latestDisplayedCycle = null;
        this.pendingCycle = null;
        this.clearChartData();
        this.updateSummary(null);
        this.updateStatus();
    }

    destroy() {
        this.unsubscribe?.();
        this.chart?.destroy();
    }
}
