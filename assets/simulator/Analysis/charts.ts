import {
    HORSEPOWER_WATTS, PASCAL_TO_BAR, M3_TO_CM3, FULL_CYCLE_DEG,
    MAX_DYNO_RPM, PV_MIN_VOLUME_CM3, PV_MAX_VOLUME_CM3, DEG_TO_RAD
} from "./config.js";
import {
    finite, setText, setHidden, formatNumber, dynoModeLabel, engineStatusLabel,
    validationStatusLabel, validationStatusRank, summarizeValidationStatuses,
    classifyUpperStatus
} from "./utils.js";
import { CYCLE_VALIDATION_STATUS } from "./cycle-validation.js";
import { DYNO_MODES } from "../Dyno/Dyno.js";
import { ENGINE_OPERATING_STATES } from "../EngineControl/EngineControl.js";
import { getCylinderVolume } from "../Geometry/Geometry.js";

export function createChartsModule({ cycleValidator, liveData, ui }: any) {
    const Chart = globalThis.Chart;
    if (typeof Chart !== "function") {
        throw new Error("Chart.js doit être chargé avant Analysis.js.");
    }

    function getLatestTelemetry() {
        if (liveData.mode === "snapshot") {
            return liveData.snapshot?.telemetry?.at(-1) ?? null;
        }

        return liveData.latestSample;
    }

    function getTelemetrySeries() {
        return liveData.mode === "snapshot"
            ? liveData.snapshot?.telemetry ?? []
            : liveData.telemetry;
    }

    function getDynoPoints() {
        return liveData.mode === "snapshot"
            ? liveData.snapshot?.dynoPoints ?? []
            : liveData.dynoPoints;
    }

    function getDisplayedCycle() {
        if (liveData.mode === "snapshot") {
            return liveData.snapshot?.cycle ?? null;
        }

        return liveData.displayedCycle ?? liveData.cycle;
    }

    function chartFont() {
        return {
            family: 'Inter, "Segoe UI", Arial, sans-serif',
            size: 11
        };
    }

    Chart.defaults.color = "#8b9498";
    Chart.defaults.font = chartFont();
    Chart.defaults.animation = false;
    Chart.defaults.devicePixelRatio = 1;
    Chart.defaults.borderColor = "rgba(110, 122, 126, 0.18)";

    const engineeringGuidesPlugin = {
        id: "engineeringGuides",
        afterDraw(chart: any, _args: any, options: any) {
            const lines = options?.lines;
            if (!Array.isArray(lines) || lines.length === 0) {
                return;
            }

            const { ctx, chartArea } = chart;
            if (!chartArea) return;

            ctx.save();
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.textBaseline = "bottom";

            for (const line of lines) {
                const scale = chart.scales[line.scaleId ?? "y"];
                if (!scale || !Number.isFinite(line.value)) continue;

                const pixel = scale.getPixelForValue(line.value);
                if (pixel < chartArea.top || pixel > chartArea.bottom) continue;

                ctx.strokeStyle = line.color ?? "rgba(127,157,137,0.45)";
                ctx.lineWidth = line.width ?? 1;
                ctx.setLineDash(line.dash ?? [4, 4]);
                ctx.beginPath();
                ctx.moveTo(chartArea.left, pixel);
                ctx.lineTo(chartArea.right, pixel);
                ctx.stroke();

                if (line.label) {
                    ctx.fillStyle = line.color ?? "#7f9d89";
                    ctx.fillText(line.label, chartArea.left + 5, pixel - 3);
                }
            }

            ctx.restore();
        }
    };

    const engineeringMarkersPlugin = {
        id: "engineeringMarkers",
        afterDraw(chart: any, _args: any, options: any) {
            const items = options?.items;
            if (!Array.isArray(items) || items.length === 0) {
                return;
            }

            const xScale = chart.scales.x;
            const { ctx, chartArea } = chart;
            if (!xScale || !chartArea) return;

            ctx.save();
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.textAlign = "center";
            ctx.textBaseline = "top";

            for (const item of items) {
                if (!Number.isFinite(item.value)) continue;
                const x = xScale.getPixelForValue(item.value);
                if (x < chartArea.left || x > chartArea.right) continue;

                ctx.strokeStyle = item.color ?? "rgba(127,157,137,0.5)";
                ctx.lineWidth = 1;
                ctx.setLineDash(item.dash ?? [3, 4]);
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();

                if (item.label) {
                    ctx.save();
                    ctx.translate(x + 3, chartArea.top + 4);
                    ctx.rotate(-Math.PI / 2);
                    ctx.fillStyle = item.color ?? "#8b9498";
                    ctx.fillText(item.label, 0, 0);
                    ctx.restore();
                }
            }

            ctx.restore();
        }
    };

    Chart.register(engineeringGuidesPlugin, engineeringMarkersPlugin);

    function basePlugins(title = null) {
        return {
            legend: {
                position: "bottom",
                align: "start",
                labels: {
                    color: "#a5adaf",
                    boxWidth: 18,
                    boxHeight: 2,
                    padding: 13,
                    font: chartFont(),
                    usePointStyle: false
                }
            },
            tooltip: {
                enabled: true,
                backgroundColor: "#111618",
                borderColor: "#3a4549",
                borderWidth: 1,
                titleColor: "#e6e8e7",
                bodyColor: "#c6cbca",
                displayColors: true,
                padding: 9,
                titleFont: { family: '"JetBrains Mono", monospace', size: 11 },
                bodyFont: { family: '"JetBrains Mono", monospace', size: 10 }
            },
            title: title ? {
                display: false,
                text: title
            } : { display: false },
            decimation: {
                enabled: true,
                algorithm: "min-max"
            }
        };
    }

    function linearScale(title: any, position = "left", options = {}) {
        return {
            type: "linear",
            position,
            grid: {
                color: position === "left"
                    ? "rgba(110,122,126,0.15)"
                    : "rgba(0,0,0,0)",
                drawBorder: true
            },
            border: { color: "#293035" },
            ticks: {
                color: "#818b8f",
                font: { family: '"JetBrains Mono", monospace', size: 10 }
            },
            title: {
                display: true,
                text: title,
                color: "#8b9498",
                font: { size: 10, weight: "500" }
            },
            ...options
        };
    }

    function lineDataset(label: any, color: any, yAxisID: any, extra = {}) {
        return {
            label,
            data: [],
            yAxisID,
            parsing: false,
            normalized: true,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 1.7,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.08,
            spanGaps: true,
            ...extra
        };
    }

    const dynoChart = new Chart(document.getElementById("analysisDynoChart"), {
        type: "line",
        data: {
            datasets: [
                lineDataset("Couple vilebrequin", "#9bb8a4", "yTorque", {
                    borderWidth: 2.4
                }),
                lineDataset("Puissance moteur", "#e1e5e3", "yPower", {
                    borderWidth: 2.1
                }),
                lineDataset("Couple indiqué brut", "#6e9eaa", "yTorque", {
                    borderWidth: 1.8
                }),
                lineDataset("Pertes de pompage", "#c49a5c", "yTorque", {
                    borderDash: [7, 4],
                    borderWidth: 1.5
                }),
                lineDataset("Pertes mécaniques", "#727c80", "yTorque", {
                    borderDash: [4, 4],
                    borderWidth: 1.5
                }),
                lineDataset("Accessoires", "#8f819f", "yTorque", {
                    borderDash: [2, 4],
                    borderWidth: 1.4
                })
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                ...basePlugins(),
                engineeringMarkers: { items: [] },
                tooltip: {
                    ...basePlugins().tooltip,
                    callbacks: {
                        title(items: any) {
                            const rpm = items[0]?.parsed?.x;
                            return Number.isFinite(rpm)
                                ? `${formatNumber(rpm)} tr/min`
                                : "";
                        },
                        label(context: any) {
                            const unit = context.dataset.yAxisID === "yPower"
                                ? "ch"
                                : "N·m";
                            return `${context.dataset.label} : ${formatNumber(context.parsed.y, 1)} ${unit}`;
                        }
                    }
                }
            },
            scales: {
                x: linearScale("Régime moteur (tr/min)", "bottom", {
                    type: "linear",
                    min: 1000,
                    max: MAX_DYNO_RPM
                }),
                yTorque: linearScale("Couple (N·m)", "left", {
                    suggestedMin: -80,
                    suggestedMax: 360
                }),
                yPower: linearScale("Puissance (ch)", "right", {
                    beginAtZero: true,
                    suggestedMax: 280
                })
            }
        }
    });

    const cycleChart = new Chart(document.getElementById("analysisCycleChart"), {
        type: "line",
        data: {
            datasets: [
                lineDataset("Pression cylindre", "#9bb8a4", "yCylinder", { borderWidth: 2.1 }),
                lineDataset("Pression admission", "#6e9eaa", "yBoundary"),
                lineDataset("Pression échappement", "#c49a5c", "yBoundary"),
                lineDataset("Levée admission", "#6e9eaa", "yLift", { borderDash: [5, 4] }),
                lineDataset("Levée échappement", "#c49a5c", "yLift", { borderDash: [5, 4] })
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            interaction: { mode: "nearest", intersect: false, axis: "x" },
            plugins: {
                ...basePlugins(),
                engineeringMarkers: { items: [] },
                tooltip: {
                    ...basePlugins().tooltip,
                    callbacks: {
                        title(items: any) {
                            const point = items[0]?.raw;
                            if (!point) return "";
                            return `${formatNumber(point.x, 1)}° CA · ${point.phase ?? "cycle"}`;
                        },
                        label(context: any) {
                            const axis = context.dataset.yAxisID;
                            const unit = axis === "yLift" ? "mm" : "bar abs";
                            return `${context.dataset.label} : ${formatNumber(context.parsed.y, axis === "yLift" ? 2 : 2)} ${unit}`;
                        }
                    }
                }
            },
            scales: {
                x: linearScale("Angle vilebrequin (° CA)", "bottom", {
                    type: "linear",
                    min: 0,
                    max: FULL_CYCLE_DEG,
                    ticks: { stepSize: 90, color: "#818b8f", font: { family: '"JetBrains Mono", monospace', size: 10 } }
                }),
                yCylinder: linearScale("Pression cylindre (bar abs)", "left", {
                    beginAtZero: true,
                    suggestedMax: 110
                }),
                yBoundary: linearScale("Admission / échappement (bar abs)", "right", {
                    beginAtZero: true,
                    suggestedMax: 4
                }),
                yLift: linearScale("Levée soupape (mm)", "right", {
                    offset: true,
                    beginAtZero: true,
                    suggestedMax: 12,
                    grid: { drawOnChartArea: false }
                })
            }
        }
    });

    const pvChart = new Chart(document.getElementById("analysisPvChart"), {
        // Un diagramme P-V est une courbe paramétrique : le volume augmente puis
        // diminue. Le type scatter conserve strictement l'ordre angulaire des
        // points, contrairement à une série temporelle supposée monotone en x.
        type: "scatter",
        data: {
            datasets: [
                lineDataset("Cycle fermé", "#9bb8a4", "y", {
                    fill: false,
                    borderWidth: 2.2,
                    showLine: true,
                    tension: 0,
                    normalized: false,
                    spanGaps: false,
                    pointHitRadius: 7
                }),
                lineDataset("Boucle de pompage", "#c49a5c", "y", {
                    fill: false,
                    borderWidth: 1.8,
                    showLine: true,
                    tension: 0,
                    normalized: false,
                    spanGaps: false,
                    pointHitRadius: 7
                })
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            interaction: { mode: "nearest", intersect: false },
            plugins: {
                ...basePlugins(),
                tooltip: {
                    ...basePlugins().tooltip,
                    callbacks: {
                        title(items: any) {
                            const point = items[0]?.raw;
                            return point
                                ? `${formatNumber(point.angleDeg, 1)}° CA · ${point.phase ?? "cycle"}`
                                : "";
                        },
                        label(context: any) {
                            return `P = ${formatNumber(context.parsed.y, 2)} bar abs · V = ${formatNumber(context.parsed.x, 1)} cm³`;
                        }
                    }
                }
            },
            scales: {
                x: linearScale("Volume cylindre (cm³)", "bottom", {
                    type: "linear",
                    min: Math.floor(PV_MIN_VOLUME_CM3 / 10) * 10,
                    max: Math.ceil(PV_MAX_VOLUME_CM3 / 10) * 10,
                    ticks: {
                        stepSize: 50,
                        color: "#818b8f",
                        font: { family: '"JetBrains Mono", monospace', size: 10 }
                    }
                }),
                y: linearScale("Pression absolue (bar)", "left", {
                    type: "logarithmic",
                    min: 0.2,
                    suggestedMax: 120,
                    ticks: {
                        color: "#818b8f",
                        font: { family: '"JetBrains Mono", monospace', size: 10 },
                        callback(value: any) {
                            return [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].includes(Number(value))
                                ? value
                                : "";
                        }
                    }
                })
            }
        }
    });

    const turboChart = new Chart(document.getElementById("analysisTurboChart"), {
        type: "line",
        data: {
            datasets: [
                lineDataset("Puissance disponible turbine", "#c49a5c", "yPower"),
                lineDataset("Puissance mécanique turbine", "#9bb8a4", "yPower", { borderWidth: 2 }),
                lineDataset("Puissance compresseur", "#6e9eaa", "yPower"),
                lineDataset("Pertes d’arbre", "#727c80", "yPower", { borderDash: [4, 4], expertOnly: true }),
                lineDataset("Puissance nette rotor", "#8f819f", "yPower", { borderWidth: 1.8 }),
                lineDataset("Régime turbo", "#e1e5e3", "yTurbo", { borderWidth: 2 }),
                lineDataset("Wastegate", "#b0a58e", "yWastegate", { borderDash: [3, 4], expertOnly: true })
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                ...basePlugins(),
                tooltip: {
                    ...basePlugins().tooltip,
                    callbacks: {
                        title(items: any) {
                            return `${formatNumber(items[0]?.parsed?.x, 2)} s`;
                        },
                        label(context: any) {
                            const axis = context.dataset.yAxisID;
                            const unit = axis === "yTurbo"
                                ? "krpm"
                                : axis === "yWastegate"
                                    ? "%"
                                    : "kW";
                            return `${context.dataset.label} : ${formatNumber(context.parsed.y, 2)} ${unit}`;
                        }
                    }
                }
            },
            scales: {
                x: linearScale("Temps simulé (s)", "bottom", { type: "linear" }),
                yPower: linearScale("Puissance (kW)", "left", { suggestedMin: -5, suggestedMax: 35 }),
                yTurbo: linearScale("Régime turbo (krpm)", "right", { beginAtZero: true, suggestedMax: 170 }),
                yWastegate: linearScale("Wastegate (%)", "right", {
                    offset: true,
                    min: 0,
                    max: 100,
                    grid: { drawOnChartArea: false }
                })
            }
        }
    });

    const residualChart = new Chart(document.getElementById("analysisResidualChart"), {
        type: "line",
        data: {
            datasets: [
                lineDataset("Résidu massique maximal", "#6e9eaa", "yResidual", { borderWidth: 1.9 }),
                lineDataset("Résidu énergétique maximal", "#c49a5c", "yResidual", { borderWidth: 1.9 }),
                lineDataset("Erreur massique cumulée", "#7f9d89", "yCumulative", { borderDash: [4, 4], expertOnly: true }),
                lineDataset("Erreur énergétique cumulée", "#8f819f", "yCumulative", { borderDash: [4, 4], expertOnly: true })
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                ...basePlugins(),
                engineeringGuides: {
                    lines: [
                        { value: 1e-5, label: "excellent", color: "rgba(127,157,137,0.55)" },
                        { value: 1e-2, label: "acceptable", color: "rgba(196,154,92,0.55)" },
                        { value: 1, label: "à vérifier", color: "rgba(185,96,100,0.55)" }
                    ]
                },
                tooltip: {
                    ...basePlugins().tooltip,
                    callbacks: {
                        title(items: any) {
                            return `${formatNumber(items[0]?.parsed?.x, 2)} s`;
                        },
                        label(context: any) {
                            return `${context.dataset.label} : ${Number(context.parsed.y).toExponential(3)}`;
                        }
                    }
                }
            },
            scales: {
                x: linearScale("Temps simulé (s)", "bottom", { type: "linear" }),
                yResidual: linearScale("Résidu normalisé (%)", "left", {
                    type: "logarithmic",
                    min: 1e-12,
                    max: 10,
                    ticks: {
                        color: "#818b8f",
                        font: { family: '"JetBrains Mono", monospace', size: 10 },
                        callback(value: any) {
                            return Number(value).toExponential(0);
                        }
                    }
                }),
                yCumulative: linearScale("Erreur cumulée (SI)", "right", {
                    type: "logarithmic",
                    min: 1e-12,
                    grid: { drawOnChartArea: false },
                    ticks: {
                        color: "#818b8f",
                        font: { family: '"JetBrains Mono", monospace', size: 10 },
                        callback(value: any) {
                            return Number(value).toExponential(0);
                        }
                    }
                })
            }
        }
    });

    const charts = [dynoChart, cycleChart, pvChart, turboChart, residualChart];

    let synchronizingCycleCursor = false;

    function nearestDatasetIndexByAngle(chart: any, angleDeg: any) {
        let best: any = null;

        chart.data.datasets.forEach((dataset: any, datasetIndex: any) => {
            dataset.data.forEach((point: any, index: any) => {
                const angle = Number.isFinite(point?.angleDeg)
                    ? point.angleDeg
                    : point?.x;
                if (!Number.isFinite(angle)) return;
                const distance = Math.abs(angle - angleDeg);
                if (!best || distance < best.distance) {
                    best = { datasetIndex, index, distance };
                }
            });
        });

        return best;
    }

    function synchronizeCycleCursor(sourceChart: any, angleDeg: any) {
        if (synchronizingCycleCursor || !Number.isFinite(angleDeg)) return;
        synchronizingCycleCursor = true;

        const targets = sourceChart === cycleChart
            ? [pvChart]
            : [cycleChart];

        for (const target of targets) {
            const nearest = nearestDatasetIndexByAngle(target, angleDeg);
            if (!nearest) continue;
            target.setActiveElements?.([nearest]);
            const point = target.data.datasets[nearest.datasetIndex]?.data?.[nearest.index];
            target.tooltip?.setActiveElements?.(
                [nearest],
                {
                    x: target.scales.x?.getPixelForValue(point?.x ?? 0) ?? 0,
                    y: target.scales[(target.data.datasets[nearest.datasetIndex] as any)?.yAxisID ?? "y"]
        ?.getPixelForValue(point?.y ?? 0) ?? 0
        }
        );
            target.draw?.();
        }

        synchronizingCycleCursor = false;
    }

    cycleChart.options.onHover = (_event: any, elements: any, chart: any) => {
        const element = elements?.[0];
        if (!element) return;
        const point = chart.data.datasets[element.datasetIndex]?.data?.[element.index];
        synchronizeCycleCursor(chart, point?.x);
    };

    pvChart.options.onHover = (_event: any, elements: any, chart: any) => {
        const element = elements?.[0];
        if (!element) return;
        const point = chart.data.datasets[element.datasetIndex]?.data?.[element.index];
        synchronizeCycleCursor(chart, point?.angleDeg);
    };

    function applyDensityMode() {
        document.querySelector(".Analysis-page")?.setAttribute(
            "data-Analysis-mode",
            liveData.density
        );

        for (const chart of charts) {
            chart.data.datasets.forEach(dataset => {
                // Les courbes fondamentales du banc ne sont jamais masquées : le
                // mode Présentation ne retire que les diagnostics secondaires.
                if (dataset.expertOnly) {
                    dataset.hidden = liveData.density !== "expert";
                }
            });
            chart.update("none");
        }
    }

    function findExtreme(points: any, key: any, mode = "max") {
        if (!Array.isArray(points) || points.length === 0) return null;

        return points.reduce((best, point) => {
            if (!best) return point;
            const value = finite(point[key], mode === "max" ? -Infinity : Infinity);
            const bestValue = finite(best[key], mode === "max" ? -Infinity : Infinity);
            return mode === "max"
                ? (value > bestValue ? point : best)
                : (value < bestValue ? point : best);
        }, null);
    }

    function deriveDynoMarkers(points: any) {
        if (!Array.isArray(points) || points.length < 2) return [];

        const peakTorque = findExtreme(points, "torque");
        const peakPower = findExtreme(points, "power");
        const spool = points.find(point => finite(point.boost) >= 0.2);
        const targetBoost = points.find(point => finite(point.boost) >= 0.8);
        const highRpm = points.find(point => point.rpm >= 6500);

        return [
            spool && { value: spool.rpm, label: "début spool", color: "rgba(110,158,170,0.65)" },
            peakTorque && { value: peakTorque.rpm, label: "couple max", color: "rgba(127,157,137,0.75)" },
            targetBoost && { value: targetBoost.rpm, label: "boost cible", color: "rgba(110,158,170,0.65)" },
            peakPower && { value: peakPower.rpm, label: "puissance max", color: "rgba(230,232,231,0.65)" },
            highRpm && { value: highRpm.rpm, label: "haut régime", color: "rgba(196,154,92,0.65)" }
        ].filter(Boolean);
    }

    function renderDyno(points = getDynoPoints()) {
        const hasPoints = Array.isArray(points) && points.length > 0;
        setHidden(ui.dynoEmptyState, hasPoints);

        const datasets = dynoChart.data.datasets;
        datasets[0].data = points.map((point: any) => ({ x: point.rpm, y: point.torque }));
        datasets[1].data = points.map((point: any) => ({ x: point.rpm, y: point.power / HORSEPOWER_WATTS }));
        datasets[2].data = points.map((point: any) => ({ x: point.rpm, y: point.closedCycleIndicatedTorque }));
        datasets[3].data = points.map((point: any) => ({ x: point.rpm, y: point.pumpingTorque }));
        datasets[4].data = points.map((point: any) => ({ x: point.rpm, y: -Math.abs(point.mechanicalFrictionTorque) }));
        datasets[5].data = points.map((point: any) => ({ x: point.rpm, y: -Math.abs(point.accessoryTorque) }));
        dynoChart.options.plugins.engineeringMarkers.items = deriveDynoMarkers(points);
        dynoChart.update("none");

        if (!hasPoints) {
            [
                ui.balanceClosedTorque,
                ui.balancePumpingTorque,
                ui.balanceFrictionTorque,
                ui.balanceAccessoryTorque,
                ui.balanceBrakeTorque
            ].forEach(element => setText(element, "—"));
            return;
        }

        const peakTorque = findExtreme(points, "torque");
        const peakPower = findExtreme(points, "power");
        const selected = peakTorque ?? points.at(-1);

        setText(ui.balanceClosedTorque, `${formatNumber(selected.closedCycleIndicatedTorque, 1)} N·m`);
        setText(ui.balancePumpingTorque, `${formatNumber(selected.pumpingTorque, 1)} N·m`);
        setText(ui.balanceFrictionTorque, `−${formatNumber(Math.abs(selected.mechanicalFrictionTorque), 1)} N·m`);
        setText(ui.balanceAccessoryTorque, `−${formatNumber(Math.abs(selected.accessoryTorque), 1)} N·m`);
        setText(ui.balanceBrakeTorque, `${formatNumber(selected.torque, 1)} N·m`);

        setText(ui.summaryPeakTorque, `${formatNumber(peakTorque?.torque, 1)} N·m`);
        setText(ui.summaryPeakPower, `${formatNumber(peakPower?.power / HORSEPOWER_WATTS, 1)} ch`);
        setText(ui.validationPeakTorque, `${formatNumber(peakTorque?.torque, 1)} N·m`);
        setText(ui.validationPeakTorqueRpm, `${formatNumber(peakTorque?.rpm)} tr/min`);
        setText(ui.validationPeakPower, `${formatNumber(peakPower?.power / HORSEPOWER_WATTS, 1)} ch à ${formatNumber(peakPower?.rpm)} tr/min`);

        const peakBoost = findExtreme(points, "boost");
        setText(ui.validationPeakBoost, `${formatNumber(peakBoost?.boost, 2)} bar relatif`);
    }

    function cycleEventMarkers(cycle: any) {
        const events = cycle?.events;
        if (!events) return [];

        return [
            { value: 0, label: "PMH", color: "rgba(139,148,152,0.45)" },
            { value: events.intakeValveCloseDeg, label: "IVC", color: "rgba(110,158,170,0.60)" },
            { value: events.ignitionStartDeg, label: "allumage", color: "rgba(196,154,92,0.72)" },
            { value: 360, label: "PMH", color: "rgba(139,148,152,0.55)" },
            { value: events.ca10Deg, label: "CA10 mes.", color: "rgba(196,154,92,0.58)" },
            { value: events.ca50Deg, label: "CA50 mes.", color: "rgba(196,154,92,0.82)" },
            { value: events.ca90Deg, label: "CA90 mes.", color: "rgba(196,154,92,0.58)" },
            { value: events.exhaustValveOpenDeg, label: "EVO", color: "rgba(196,154,92,0.60)" },
            { value: 720, label: "PMH", color: "rgba(139,148,152,0.45)" }
        ];
    }

    function meanSampleValue(samples: any, key: any) {
        if (!Array.isArray(samples) || samples.length === 0) return 0;
        let sum = 0;
        let count = 0;
        for (const sample of samples) {
            const value = sample?.[key];
            if (Number.isFinite(value)) {
                sum += value;
                count++;
            }
        }
        return count > 0 ? sum / count : 0;
    }

    function normalizedCycleAngleDeg(value: any) {
        const angle = finite(value);
        if (Math.abs(angle - FULL_CYCLE_DEG) <= 1e-6) {
            return FULL_CYCLE_DEG;
        }
        return ((angle % FULL_CYCLE_DEG) + FULL_CYCLE_DEG) % FULL_CYCLE_DEG;
    }

    function pvVolumeM3(sample: any) {
        const angleDeg = normalizedCycleAngleDeg(sample?.angleDeg);
        // Le volume est imposé par la géométrie bielle-manivelle. Le recalculer
        // depuis l'angle supprime tout déphasage entre un point décimé et l'état
        // instantané enregistré au même sous-pas.
        return getCylinderVolume((angleDeg % 360) * DEG_TO_RAD);
    }

    function pvPointFromSample(sample: any) {
        return {
            x: pvVolumeM3(sample) * M3_TO_CM3,
            y: Math.max(finite(sample?.cylinderPressurePa) * PASCAL_TO_BAR, 0.05),
            angleDeg: normalizedCycleAngleDeg(sample?.angleDeg),
            phase: sample?.phase ?? "cycle"
        };
    }

    function formatCrankEvent(angleDeg: any, referenceDeg = 360) {
        if (!Number.isFinite(angleDeg)) return "—";
        const delta = angleDeg - referenceDeg;
        if (Math.abs(delta) < 0.05) return "PMH";
        return `${formatNumber(Math.abs(delta), 1)}° ${delta < 0 ? "avant" : "après"} PMH`;
    }

    function formatCycleAngle(angleDeg: any) {
        return Number.isFinite(angleDeg)
            ? `${formatNumber(angleDeg, 1)}° CA`
            : "—";
    }


    function clearCycleValidationReport() {
        liveData.cycleValidationReport = null;
        cycleValidator.clear();
        setText(ui.cycleValidationGlobalStatus, "En attente");
        setText(ui.cycleValidationSummary, "Aucun cycle complet analysé.");
        setText(ui.cycleValidationTimestamp, "—");
        setText(ui.cycleValidationOperatingPoint, "—");
        setText(ui.cycleValidationAcquisition, "—");
        setText(ui.cycleValidationConclusion, "Le rapport sera produit automatiquement après l’acquisition d’un cycle 720° complet.");
        if (ui.cycleValidationTableBody) {
            ui.cycleValidationTableBody.innerHTML = `
                <tr class="cycle-validation-empty-row">
                    <td colspan="5">En attente d’un cycle complet.</td>
                </tr>
            `;
        }
        const panel = ui.cycleValidationGlobalStatus?.closest(".cycle-validation-report");
        if (panel) panel.dataset.validationStatus = "unavailable";
    }

    function renderCycleValidationReport(report: any) {
        if (!report) {
            clearCycleValidationReport();
            return;
        }

        liveData.cycleValidationReport = report;
        setText(ui.cycleValidationGlobalStatus, validationStatusLabel(report.status));
        setText(
            ui.cycleValidationSummary,
            `${report.counts.pass} validé(s) · ${report.counts.warning} avertissement(s) · ${report.counts.fail} échec(s) · ${report.counts.unavailable} non exécuté(s)`
        );
        setText(
            ui.cycleValidationTimestamp,
            new Date(report.generatedAt).toLocaleString("fr-FR")
        );
        setText(
            ui.cycleValidationOperatingPoint,
            Number.isFinite(report.operatingPoint?.meanRpm)
                ? `${formatNumber(report.operatingPoint.meanRpm)} tr/min · variation ${formatNumber(report.operatingPoint.rpmSpanPercent, 3)} % · boost ${formatNumber(report.operatingPoint.meanBoostBarGauge, 2)} bar rel.`
                : "—"
        );
        setText(
            ui.cycleValidationAcquisition,
            Number.isFinite(report.acquisition?.nominalStepDeg)
                ? `${formatNumber(report.acquisition.sampleCount)} points · pas ${formatNumber(report.acquisition.nominalStepDeg, 3)}° · trou max ${formatNumber(report.acquisition.maximumGapDeg, 3)}°`
                : "—"
        );
        setText(ui.cycleValidationConclusion, report.conclusion);

        const panel = ui.cycleValidationGlobalStatus?.closest(".cycle-validation-report");
        if (panel) panel.dataset.validationStatus = report.status;

        if (!ui.cycleValidationTableBody) return;

        const tests = [...report.tests].sort((a, b) => {
            const groupOrder = a.group.localeCompare(b.group, "fr");
            if (groupOrder !== 0) return groupOrder;
            return validationStatusRank(a.status) - validationStatusRank(b.status);
        });

        ui.cycleValidationTableBody.innerHTML = tests.map(test => `
            <tr data-test-status="${test.status}">
                <td>${test.group}</td>
                <td>
                    <strong>${test.label}</strong>
                    ${test.detail ? `<span>${test.detail}</span>` : ""}
                </td>
                <td><span class="cycle-validation-status">${test.statusLabel ?? validationStatusLabel(test.status)}</span></td>
                <td>${test.measured ?? "—"}</td>
                <td>${test.expected ?? "—"}</td>
            </tr>
        `).join("");
    }


    function clearMultiPointValidationReport() {
        liveData.multiPointValidation = null;
        setText(ui.multiPointValidationGlobalStatus, "En attente");
        setText(
            ui.multiPointValidationSummary,
            "La carte sera calculée automatiquement pendant le prochain tir de référence."
        );
        setText(ui.multiPointValidationTimestamp, "—");
        setText(ui.validationMultiPoint, "—");
        setText(
            ui.multiPointValidationConclusion,
            "Aucun point de régime et de charge n’a encore été évalué."
        );

        if (ui.multiPointValidationTableBody) {
            ui.multiPointValidationTableBody.innerHTML = `
                <tr class="cycle-validation-empty-row">
                    <td colspan="12">Lancez un tir de référence pour exécuter la campagne multipoint.</td>
                </tr>
            `;
        }

        if (ui.multiPointValidationExportButton) {
            ui.multiPointValidationExportButton.disabled = true;
        }

        const panel = ui.multiPointValidationGlobalStatus?.closest(
            ".multi-point-validation"
        );
        if (panel) panel.dataset.validationStatus = "unavailable";
    }

    function multiPointResidualLabel(point: any) {
        const mass = Number.isFinite(point?.maximumMassResidualPercent)
            ? point.maximumMassResidualPercent.toExponential(1)
            : "—";
        const energy = Number.isFinite(point?.maximumEnergyResidualPercent)
            ? point.maximumEnergyResidualPercent.toExponential(1)
            : "—";
        return `${mass} / ${energy} %`;
    }

    function renderMultiPointValidationReport(report: any) {
        if (!report?.points?.length) {
            clearMultiPointValidationReport();
            return;
        }

        liveData.multiPointValidation = report;
        setText(
            ui.multiPointValidationGlobalStatus,
            validationStatusLabel(report.status)
        );
        setText(
            ui.multiPointValidationSummary,
            `${report.counts.pass} validé(s) · ${report.counts.warning} avertissement(s) · ${report.counts.fail} échec(s) sur ${report.points.length} point(s)`
        );
        setText(
            ui.multiPointValidationTimestamp,
            new Date(report.generatedAt).toLocaleString("fr-FR")
        );
        setText(
            ui.validationMultiPoint,
            `${report.counts.pass}/${report.points.length} point(s) validé(s) · ${validationStatusLabel(report.status)}`
        );
        setText(ui.multiPointValidationConclusion, report.conclusion);

        if (ui.multiPointValidationExportButton) {
            ui.multiPointValidationExportButton.disabled = false;
        }

        const panel = ui.multiPointValidationGlobalStatus?.closest(
            ".multi-point-validation"
        );
        if (panel) panel.dataset.validationStatus = report.status;

        if (!ui.multiPointValidationTableBody) return;

        ui.multiPointValidationTableBody.innerHTML = report.points.map((point: any) => {
            const rpmMeasured = Number.isFinite(point.meanRpm)
                ? `${formatNumber(point.meanRpm)} tr/min`
                : "—";
            const boost = Number.isFinite(point.meanBoostBarGauge)
                ? `${formatNumber(point.meanBoostBarGauge, 2)} bar`
                : "—";
            const torque = Number.isFinite(point.torqueFromPvNm)
                ? `${formatNumber(point.torqueFromPvNm, 1)} N·m`
                : "—";
            const imep = Number.isFinite(point.netImepBar)
                ? `${formatNumber(point.netImepBar, 2)} bar`
                : "—";
            const closure = Number.isFinite(point.pvClosureErrorPercent)
                ? `<strong class="pv-closure-grade" data-pv-closure-status="${point.pvClosureAssessment?.status ?? "unavailable"}">${point.pvClosureAssessment?.label ?? "—"}</strong><span>${formatNumber(point.pvClosureErrorPercent, 3)} % · Δ ${Number.isFinite(point.pvClosureErrorNm) ? formatNumber(point.pvClosureErrorNm, 3) : "—"} N·m${point.pvClosureAssessment?.isLowTorque ? " · critère faible couple" : ""}</span>`
                : "—";
            const repeatability = Number.isFinite(point.repeatabilityCvPercent)
                ? `${formatNumber(point.repeatabilityCvPercent, 3)} % · Δboost ${Number.isFinite(point.boostSpanBar) ? formatNumber(point.boostSpanBar, 3) : "—"} bar · dBoost/dt ${Number.isFinite(point.boostSlopeBarPerSecond) ? formatNumber(point.boostSlopeBarPerSecond, 3) : "—"} bar/s · Δturbo ${Number.isFinite(point.turboRpmSpanPercent) ? formatNumber(point.turboRpmSpanPercent, 2) : "—"} %`
                : "—";
            const description = point.error
                ? point.error
                : point.description ?? "";

            return `
                <tr data-point-status="${point.status}">
                    <td>
                        <strong>${point.label}</strong>
                        ${description ? `<span>${description}</span>` : ""}
                    </td>
                    <td>${formatNumber(point.targetRpm)} tr/min</td>
                    <td>${formatNumber(point.throttle * 100, 0)} %</td>
                    <td>${rpmMeasured}</td>
                    <td>${boost}</td>
                    <td>${torque}</td>
                    <td>${imep}</td>
                    <td>${Number.isFinite(point.peakPressureBar) ? `${formatNumber(point.peakPressureBar, 1)} bar` : "—"} / ${Number.isFinite(point.ca50Deg) ? `${formatNumber(point.ca50Deg, 1)}°` : "—"}</td>
                    <td>${closure}</td>
                    <td>${repeatability}</td>
                    <td>${multiPointResidualLabel(point)}</td>
                    <td><span class="cycle-validation-status">${validationStatusLabel(point.status)}</span></td>
                </tr>
            `;
        }).join("");
    }

    function multiPointValidationToCsv(report: any) {
        const columns = [
            "point",
            "description",
            "statut",
            "regime_cible_tr_min",
            "charge_papillon_percent",
            "regime_moyen_tr_min",
            "erreur_regime_percent",
            "boost_moyen_bar_relatif",
            "couple_pv_nm",
            "imep_net_bar",
            "pic_pression_bar",
            "ca50_mesure_deg",
            "ca50_modele_deg",
            "ca50_cible_deg",
            "fermeture_pv_percent",
            "fermeture_pv_ecart_absolu_nm",
            "fermeture_pv_classement",
            "fermeture_pv_critere",
            "repetabilite_cv_percent",
            "variation_boost_bar",
            "pente_boost_bar_par_s",
            "variation_regime_turbo_percent",
            "residu_masse_max_percent",
            "residu_energie_max_percent",
            "cycles_captures",
            "erreur"
        ];

        const csvCell = (value: any) => {
            const text = value === null || value === undefined ? "" : String(value);
            return `"${text.replaceAll('"', '""')}"`;
        };

        const rows = (report?.points ?? []).map((point: any) => [
            point.label,
            point.description,
            validationStatusLabel(point.status),
            point.targetRpm,
            point.throttle * 100,
            point.meanRpm,
            point.rpmTrackingErrorPercent,
            point.meanBoostBarGauge,
            point.torqueFromPvNm,
            point.netImepBar,
            point.peakPressureBar,
            point.ca50MeasuredDeg ?? point.ca50Deg,
            point.ca50ModelDeg,
            point.ca50TargetDeg,
            point.pvClosureErrorPercent,
            point.pvClosureErrorNm,
            point.pvClosureAssessment?.label,
            point.pvClosureAssessment?.basis,
            point.repeatabilityCvPercent,
            point.boostSpanBar,
            point.boostSlopeBarPerSecond,
            point.turboRpmSpanPercent,
            point.maximumMassResidualPercent,
            point.maximumEnergyResidualPercent,
            point.capturedCycleCount,
            point.error
        ].map(csvCell).join(";"));

        return [
            columns.map(csvCell).join(";"),
            ...rows
        ].join("\n");
    }


    return {
        getLatestTelemetry,
        getTelemetrySeries,
        getDynoPoints,
        getDisplayedCycle,
        chartFont,
        engineeringGuidesPlugin,
        engineeringMarkersPlugin,
        basePlugins,
        linearScale,
        lineDataset,
        dynoChart,
        cycleChart,
        pvChart,
        turboChart,
        residualChart,
        charts,
        synchronizingCycleCursor,
        nearestDatasetIndexByAngle,
        synchronizeCycleCursor,
        applyDensityMode,
        findExtreme,
        deriveDynoMarkers,
        renderDyno,
        cycleEventMarkers,
        meanSampleValue,
        normalizedCycleAngleDeg,
        pvVolumeM3,
        pvPointFromSample,
        formatCrankEvent,
        formatCycleAngle,
        clearCycleValidationReport,
        renderCycleValidationReport,
        clearMultiPointValidationReport,
        multiPointResidualLabel,
        renderMultiPointValidationReport,
        multiPointValidationToCsv
    };
}