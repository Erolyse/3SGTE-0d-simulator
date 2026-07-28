// Capture, calcul et affichage d'un diagramme P-V

import {
    SWEPT_VOLUME,
    CYLINDER_OFFSETS
} from "../Geometry/Geometry.js";

import {
    INTAKE_VALVE_CLOSE_DEG
} from "../Valvetrain/IntakeValves.js";

import {
    EXHAUST_VALVE_OPEN_DEG
} from "../Valvetrain/ExhaustValves.js";

// Constantes

const FULL_CYCLE_DEG = 720;
const RAD_TO_DEG = 180 / Math.PI;

const DEFAULT_ANGULAR_STEP_DEG = 0.5;
const DEFAULT_CHART_REFRESH_INTERVAL_MS = 100;

const CYLINDER_COUNT = CYLINDER_OFFSETS.length;

const PASCAL_TO_BAR = 1e-5;
const M3_TO_CM3 = 1e6;
const METRIC_HP_WATTS = 735.49875;

const EPSILON_ANGLE_DEG = 1e-9;

// Outils généraux

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function normalizeCycleAngleDeg(angleDeg) {
    return (
        (angleDeg % FULL_CYCLE_DEG)
        + FULL_CYCLE_DEG
    ) % FULL_CYCLE_DEG;
}

function mean(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }

    let sum = 0;

    for (const value of values) {
        sum += finiteOr(value, 0);
    }

    return sum / values.length;
}

function interpolateLinear(a, b, ratio) {
    return a + (b - a) * ratio;
}

function formatNumber(value, decimals = 2) {
    if (!Number.isFinite(value)) {
        return "—";
    }

    return value.toFixed(decimals);
}

function downloadTextFile(filename, content, mimeType = "text/plain") {
    const blob = new Blob(
        [content],
        { type: `${mimeType};charset=utf-8` }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(url);
}

// Rééchantillonnage angulaire

/**
 * Interpole les échantillons bruts sur une grille fixe :
 *
 * 0°, 0.5°, 1.0°, ..., 720°
 *
 * Le tableau brut doit couvrir au minimum l'intervalle 0 → 720°.
 */
function resampleCycleAtFixedAngle(
    rawSamples,
    angularStepDeg
) {
    if (!Array.isArray(rawSamples) || rawSamples.length < 2) {
        return null;
    }

    // Suppression des angles dupliqués ou non strictement croissants.
    const cleanedSamples = [];

    for (const sample of rawSamples) {
        if (!Number.isFinite(sample.angleDeg)) {
            continue;
        }

        const previous = cleanedSamples.at(-1);

        if (!previous) {
            cleanedSamples.push({ ...sample });
            continue;
        }

        const angleDifference =
            sample.angleDeg - previous.angleDeg;

        if (angleDifference > EPSILON_ANGLE_DEG) {
            cleanedSamples.push({ ...sample });
        } else if (
            Math.abs(angleDifference)
            <= EPSILON_ANGLE_DEG
        ) {
            // À angle identique, l'état le plus récent est conservé.
            cleanedSamples[cleanedSamples.length - 1] = {
                ...sample
            };
        }
    }

    if (cleanedSamples.length < 2) {
        return null;
    }

    const firstAngle = cleanedSamples[0].angleDeg;
    const lastAngle = cleanedSamples.at(-1).angleDeg;

    // Le premier cycle capturé après le lancement peut être incomplet.
    if (firstAngle > 0 || lastAngle < FULL_CYCLE_DEG) {
        return null;
    }

    const intervalCount = Math.round(
        FULL_CYCLE_DEG / angularStepDeg
    );

    const resampled = [];
    let sourceIndex = 0;

    for (
        let gridIndex = 0;
        gridIndex <= intervalCount;
        gridIndex++
    ) {
        const targetAngle = Math.min(
            gridIndex * angularStepDeg,
            FULL_CYCLE_DEG
        );

        while (
            sourceIndex < cleanedSamples.length - 2
            && cleanedSamples[sourceIndex + 1].angleDeg
            < targetAngle
            ) {
            sourceIndex++;
        }

        const previous = cleanedSamples[sourceIndex];
        const next = cleanedSamples[sourceIndex + 1];

        if (!previous || !next) {
            return null;
        }

        const sourceAngleSpan =
            next.angleDeg - previous.angleDeg;

        const ratio = sourceAngleSpan > EPSILON_ANGLE_DEG
            ? clamp(
                (
                    targetAngle
                    - previous.angleDeg
                ) / sourceAngleSpan,
                0,
                1
            )
            : 0;

        resampled.push({
            angleDeg: targetAngle,

            volumeM3: interpolateLinear(
                previous.volumeM3,
                next.volumeM3,
                ratio
            ),

            pressurePa: interpolateLinear(
                previous.pressurePa,
                next.pressurePa,
                ratio
            ),

            rpm: interpolateLinear(
                previous.rpm,
                next.rpm,
                ratio
            ),

            boostBar: interpolateLinear(
                previous.boostBar,
                next.boostBar,
                ratio
            ),

            throttle: interpolateLinear(
                previous.throttle,
                next.throttle,
                ratio
            ),

            indicatedTorqueNm: interpolateLinear(
                previous.indicatedTorqueNm,
                next.indicatedTorqueNm,
                ratio
            ),

            closedCycleTorqueNm: interpolateLinear(
                previous.closedCycleTorqueNm,
                next.closedCycleTorqueNm,
                ratio
            ),

            pumpingTorqueNm: interpolateLinear(
                previous.pumpingTorqueNm,
                next.pumpingTorqueNm,
                ratio
            )
        });
    }

    return resampled;
}

// Intégration P dv

function isClosedCycleAngle(angleDeg) {
    return angleDeg >= INTAKE_VALVE_CLOSE_DEG
        && angleDeg < EXHAUST_VALVE_OPEN_DEG;
}

/**
 * Calcule :
 *
 * W_net = intégrale sur les 720°
 * W_fermé = intégrale de IVC à EVO
 * W_pompage = intégrale sur les phases ouvertes
 */
function integratePVWork(samples) {
    let closedCycleWorkJ = 0;
    let pumpingWorkJ = 0;

    for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1];
        const current = samples[index];

        const meanPressurePa = 0.5 * (
            previous.pressurePa
            + current.pressurePa
        );

        const volumeChangeM3 =
            current.volumeM3
            - previous.volumeM3;

        const segmentWorkJ =
            meanPressurePa * volumeChangeM3;

        const midpointAngleDeg = 0.5 * (
            previous.angleDeg
            + current.angleDeg
        );

        if (isClosedCycleAngle(midpointAngleDeg)) {
            closedCycleWorkJ += segmentWorkJ;
        } else {
            pumpingWorkJ += segmentWorkJ;
        }
    }

    return {
        closedCycleWorkJ,
        pumpingWorkJ,
        netWorkJ:
            closedCycleWorkJ
            + pumpingWorkJ
    };
}

// Calcul des métriques

function calculateCycleMetrics(samples) {
    if (!Array.isArray(samples) || samples.length < 2) {
        return null;
    }

    const work = integratePVWork(samples);

    // Le point 720° ferme le cycle et duplique 0° ; il est exclu des moyennes.
    const averagingSamples = samples.slice(0, -1);

    const pressures = averagingSamples.map(
        sample => sample.pressurePa
    );

    const rpms = averagingSamples.map(
        sample => sample.rpm
    );

    const boosts = averagingSamples.map(
        sample => sample.boostBar
    );

    const throttles = averagingSamples.map(
        sample => sample.throttle
    );

    const indicatedTorques = averagingSamples.map(
        sample => sample.indicatedTorqueNm
    );

    const closedCycleTorques = averagingSamples.map(
        sample => sample.closedCycleTorqueNm
    );

    const pumpingTorques = averagingSamples.map(
        sample => sample.pumpingTorqueNm
    );

    let peakPressureSample = averagingSamples[0];

    for (const sample of averagingSamples) {
        if (
            sample.pressurePa
            > peakPressureSample.pressurePa
        ) {
            peakPressureSample = sample;
        }
    }

    const netImepPa =
        work.netWorkJ / SWEPT_VOLUME;

    const grossImepPa =
        work.closedCycleWorkJ / SWEPT_VOLUME;

    const signedPmepPa =
        work.pumpingWorkJ / SWEPT_VOLUME;

    /**
     * Un cylindre produit work.netWorkJ tous les 720°.
     *
     * Pour N cylindres :
     *
     * T = N * W_cylindre / (4π)
     */
    const torqueFromPVNm =
        CYLINDER_COUNT
        * work.netWorkJ
        / (4 * Math.PI);

    const meanRpm = mean(rpms);

    const powerFromPVWatts =
        torqueFromPVNm
        * meanRpm
        * 2
        * Math.PI
        / 60;

    const meanIndicatedTorqueNm =
        mean(indicatedTorques);

    const torqueConsistencyErrorPercent =
        100
        * Math.abs(
            torqueFromPVNm
            - meanIndicatedTorqueNm
        )
        / Math.max(
            Math.abs(meanIndicatedTorqueNm),
            1e-9
        );

    return {
        closedCycleWorkJ: work.closedCycleWorkJ,
        pumpingWorkJ: work.pumpingWorkJ,
        netWorkJ: work.netWorkJ,

        grossImepBar: grossImepPa * PASCAL_TO_BAR,
        signedPmepBar: signedPmepPa * PASCAL_TO_BAR,
        netImepBar: netImepPa * PASCAL_TO_BAR,

        torqueFromPVNm,
        powerFromPVWatts,
        powerFromPVHp:
            powerFromPVWatts / METRIC_HP_WATTS,

        meanRpm,
        meanBoostBar: mean(boosts),
        meanThrottle: mean(throttles),

        meanIndicatedTorqueNm,
        meanClosedCycleTorqueNm:
            mean(closedCycleTorques),

        meanPumpingTorqueNm:
            mean(pumpingTorques),

        torqueConsistencyErrorPercent,

        peakPressureBar:
            peakPressureSample.pressurePa
            * PASCAL_TO_BAR,

        peakPressureAngleDeg:
        peakPressureSample.angleDeg,

        minimumVolumeCm3:
            Math.min(
                ...averagingSamples.map(
                    sample => sample.volumeM3 * M3_TO_CM3
                )
            ),

        maximumVolumeCm3:
            Math.max(
                ...averagingSamples.map(
                    sample => sample.volumeM3 * M3_TO_CM3
                )
            )
    };
}

function getConsistencyLabel(errorPercent) {
    if (!Number.isFinite(errorPercent)) {
        return "Indisponible";
    }

    if (errorPercent < 0.5) {
        return "Excellent";
    }

    if (errorPercent < 1.0) {
        return "Bon";
    }

    if (errorPercent < 2.0) {
        return "Acceptable";
    }

    return "À vérifier";
}

// Contrôleur du diagramme P-V

export default class PVDiagram {
    constructor({
                    chartCanvas,
                    cylinderSelect,
                    freezeButton,
                    resumeButton,
                    exportButton,
                    zoomButton,

                    statusElement,
                    rpmElement,
                    boostElement,
                    peakPressureElement,
                    workElement,
                    netImepElement,
                    grossImepElement,
                    pmepElement,
                    torqueElement,
                    consistencyElement,
                    resolutionElement,
                    cycleRecorder = null,

                    angularStepDeg = DEFAULT_ANGULAR_STEP_DEG,
                    chartRefreshIntervalMs =
                    DEFAULT_CHART_REFRESH_INTERVAL_MS,

                    ChartClass = globalThis.Chart
                }) {
        if (!ChartClass) {
            throw new Error(
                "Chart.js est introuvable. Charge Chart.js avant PVDiagram.js."
            );
        }

        if (!(chartCanvas instanceof HTMLCanvasElement)) {
            throw new Error(
                "Le canvas du diagramme P-V est introuvable."
            );
        }

        this.ChartClass = ChartClass;
        this.cycleRecorder = cycleRecorder;
        this.visible = true;
        this.pendingRecordedCycle = null;

        this.elements = {
            chartCanvas,
            cylinderSelect,
            freezeButton,
            resumeButton,
            exportButton,
            zoomButton,

            statusElement,
            rpmElement,
            boostElement,
            peakPressureElement,
            workElement,
            netImepElement,
            grossImepElement,
            pmepElement,
            torqueElement,
            consistencyElement,
            resolutionElement
        };

        this.angularStepDeg = angularStepDeg;
        this.chartRefreshIntervalMs =
            chartRefreshIntervalMs;

        this.selectedCylinderIndex =
            this.getSelectedCylinderIndex();

        this.rawCycleSamples = [];
        this.previousSample = null;

        this.latestCycle = null;
        this.displayedCycle = null;

        this.completedCycleCount = 0;
        this.isFrozen = false;
        this.isPumpingZoomEnabled = false;

        this.lastChartRenderTime = 0;
        this.pendingRenderTimeout = null;

        this.chart = this.createChart();

        this.bindInterface();
        this.unsubscribeCycleRecorder = this.cycleRecorder?.subscribe?.(
            cycle => this.ingestRecordedCycle(cycle)
        ) ?? null;

        const latestCycle = this.cycleRecorder?.getLatestCycle?.();
        if (latestCycle) {
            this.ingestRecordedCycle(latestCycle);
        } else {
            this.updateStatus(
                "En attente du premier cycle complet…"
            );
        }
    }

    // Lecture de l'interface

    getSelectedCylinderIndex() {
        const rawValue = Number(
            this.elements.cylinderSelect?.value ?? 0
        );

        return clamp(
            Math.round(rawValue),
            0,
            CYLINDER_COUNT - 1
        );
    }

    setText(element, value) {
        if (element) {
            element.textContent = value;
        }
    }

    updateStatus(message) {
        this.setText(
            this.elements.statusElement,
            message
        );
    }

    // Gestion des boutons

    bindInterface() {
        this.elements.cylinderSelect?.addEventListener(
            "change",
            () => {
                this.selectedCylinderIndex =
                    this.getSelectedCylinderIndex();

                this.cycleRecorder?.setCylinder?.(
                    this.selectedCylinderIndex
                );
                this.resetCapture();

                this.updateStatus(
                    `Capture du cylindre ${
                        this.selectedCylinderIndex + 1
                    } en cours…`
                );
            }
        );

        this.elements.freezeButton?.addEventListener(
            "click",
            () => {
                this.freeze();
            }
        );

        this.elements.resumeButton?.addEventListener(
            "click",
            () => {
                this.resumeLive();
            }
        );

        this.elements.exportButton?.addEventListener(
            "click",
            () => {
                this.exportDisplayedCycleCsv();
            }
        );

        this.elements.zoomButton?.addEventListener(
            "click",
            () => {
                this.togglePumpingZoom();
            }
        );
    }

    // Création du graphique

    createChart() {
        const context =
            this.elements.chartCanvas.getContext("2d");

        return new this.ChartClass(context, {
            type: "scatter",

            data: {
                datasets: [
                    {
                        label: "Cycle P–V",
                        data: [],

                        showLine: true,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHitRadius: 8,

                        borderWidth: 2,
                        tension: 0,

                        parsing: false,

                        borderColor: "#f5f5f5",
                        backgroundColor: "#f5f5f5",

                        segment: {
                            borderColor: context => {
                                const angle =
                                    context.p0.raw?.angleDeg
                                    ?? 0;

                                if (
                                    angle
                                    >= INTAKE_VALVE_CLOSE_DEG
                                    && angle < 360
                                ) {
                                    return "#e5a323";
                                }

                                if (
                                    angle >= 360
                                    && angle
                                    < EXHAUST_VALVE_OPEN_DEG
                                ) {
                                    return "#f5f5f5";
                                }

                                if (
                                    angle
                                    >= EXHAUST_VALVE_OPEN_DEG
                                ) {
                                    return "#ff5b5b";
                                }

                                return "#16c7e8";
                            }
                        }
                    }
                ]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                animation: false,
                normalized: false,
                devicePixelRatio: 1,
                events: [],

                interaction: {
                    mode: "nearest",
                    intersect: false
                },

                scales: {
                    x: {
                        type: "linear",

                        title: {
                            display: true,
                            text: "Volume cylindre (cm³)",
                            color: "#d0d0d0"
                        },

                        ticks: {
                            color: "#b0b0b0"
                        },

                        grid: {
                            color: "rgba(255,255,255,0.08)"
                        }
                    },

                    y: {
                        type: "linear",
                        beginAtZero: true,

                        title: {
                            display: true,
                            text: "Pression cylindre absolue (bar)",
                            color: "#d0d0d0"
                        },

                        ticks: {
                            color: "#b0b0b0"
                        },

                        grid: {
                            color: "rgba(255,255,255,0.08)"
                        }
                    }
                },

                plugins: {
                    legend: {
                        labels: {
                            color: "#d0d0d0"
                        }
                    },

                    title: {
                        display: true,
                        text: "Diagramme pression-volume",
                        color: "#f0f0f0"
                    },

                    tooltip: {
                        enabled: false
                    }
                }
            }
        });
    }

    // Réutilisation du cyclerecorder partagé

    ingestRecordedCycle(cycle) {
        if (!cycle || !Array.isArray(cycle.samples)
            || cycle.samples.length < 2) {
            return;
        }

        if (!this.visible) {
            this.pendingRecordedCycle = cycle;
            return;
        }
        this.pendingRecordedCycle = null;

        this.selectedCylinderIndex = clamp(
            finiteOr(cycle.cylinderIndex, 0),
            0,
            CYLINDER_COUNT - 1
        );
        if (this.elements.cylinderSelect) {
            this.elements.cylinderSelect.value = String(
                this.selectedCylinderIndex
            );
        }

        const rawSamples = new Array(cycle.samples.length);
        for (let index = 0; index < cycle.samples.length; index++) {
            const sample = cycle.samples[index];
            rawSamples[index] = {
                angleDeg: finiteOr(sample.angleDeg, 0),
                volumeM3: finiteOr(sample.cylinderVolumeM3, 0),
                pressurePa: finiteOr(sample.cylinderPressurePa, 101325),
                rpm: finiteOr(sample.rpm, 0),
                boostBar: finiteOr(sample.boostBarGauge, 0),
                throttle: finiteOr(sample.throttle, 0),
                indicatedTorqueNm: finiteOr(sample.indicatedTorqueNm, 0),
                closedCycleTorqueNm: finiteOr(sample.closedCycleTorqueNm, 0),
                pumpingTorqueNm: finiteOr(sample.pumpingTorqueNm, 0)
            };
        }

        this.finalizeRawCycle(rawSamples);
    }

    setVisible(visible) {
        this.visible = Boolean(visible);
        if (!this.visible) {
            return;
        }
        if (this.pendingRecordedCycle) {
            const cycle = this.pendingRecordedCycle;
            this.pendingRecordedCycle = null;
            this.ingestRecordedCycle(cycle);
        } else if (this.displayedCycle) {
            this.scheduleRender();
        }
    }

    // Capture à chaque pas physique

    /**
     * À appeler immédiatement après motor.update(DT).
     */
    sample(state) {
        const cylinderIndex =
            this.selectedCylinderIndex;

        if (
            !state
            || !Array.isArray(state.cylinderVolumes)
            || !Array.isArray(state.cylinderPressures)
            || !Number.isFinite(
                state.cylinderVolumes[cylinderIndex]
            )
            || !Number.isFinite(
                state.cylinderPressures[cylinderIndex]
            )
        ) {
            return;
        }

        const localAngleRad = (
            finiteOr(state.crankAngle, 0)
            + CYLINDER_OFFSETS[cylinderIndex]
        );

        const localAngleDeg =
            normalizeCycleAngleDeg(
                localAngleRad * RAD_TO_DEG
            );

        const intakePressurePa =
            finiteOr(state.intakePressure, 101325);

        const boostBar = Number.isFinite(state.boost)
            ? state.boost
            : Math.max(
                (
                    intakePressurePa
                    - 101325
                ) * PASCAL_TO_BAR,
                0
            );

        const currentSample = {
            angleDeg: localAngleDeg,

            volumeM3:
                state.cylinderVolumes[cylinderIndex],

            pressurePa:
                state.cylinderPressures[cylinderIndex],

            rpm:
                finiteOr(state.rpm, 0),

            boostBar,

            throttle:
                finiteOr(state.throttle, 0),

            indicatedTorqueNm:
                finiteOr(state.indicatedTorque, 0),

            closedCycleTorqueNm:
                finiteOr(
                    state.closedCycleIndicatedTorque,
                    0
                ),

            pumpingTorqueNm:
                finiteOr(state.pumpingTorque, 0)
        };

        if (!this.previousSample) {
            this.rawCycleSamples = [
                currentSample
            ];

            this.previousSample =
                currentSample;

            return;
        }

        const previousAngle =
            this.previousSample.angleDeg;

        const currentAngle =
            currentSample.angleDeg;

        // Le vilebrequin peut rester quasiment immobile
        // au démarrage ou moteur arrêté.
        if (
            Math.abs(currentAngle - previousAngle)
            <= EPSILON_ANGLE_DEG
        ) {
            this.previousSample =
                currentSample;

            return;
        }

        /**
         * Le passage 719.x° → 0.x° marque la fin du cycle.
         *
         * Le seuil de 360° évite de détecter comme un wrap
         * une petite irrégularité numérique d'angle.
         */
        const cycleWrapped =
            currentAngle
            < previousAngle - 360;

        if (cycleWrapped) {
            /**
             * Le premier échantillon du cycle suivant sert aussi
             * de point situé légèrement après 720° pour fermer
             * proprement le cycle précédent.
             */
            const closingSample = {
                ...currentSample,
                angleDeg:
                    currentAngle
                    + FULL_CYCLE_DEG
            };

            this.rawCycleSamples.push(
                closingSample
            );

            this.finalizeRawCycle(
                this.rawCycleSamples
            );

            /**
             * Démarrage du cycle suivant.
             *
             * Le dernier point avant le wrap est déplacé
             * légèrement avant 0° afin de permettre
             * l'interpolation exacte au point 0°.
             */
            this.rawCycleSamples = [
                {
                    ...this.previousSample,
                    angleDeg:
                        previousAngle
                        - FULL_CYCLE_DEG
                },
                currentSample
            ];
        } else {
            this.rawCycleSamples.push(
                currentSample
            );
        }

        this.previousSample =
            currentSample;

        // Protection contre une capture infinie si le moteur
        // tourne dans un état anormal sans jamais fermer le cycle.
        if (this.rawCycleSamples.length > 100000) {
            console.warn(
                "Capture P-V réinitialisée : trop d'échantillons sans cycle complet."
            );

            this.resetCapture();
        }
    }

    // Finalisation d'un cycle

    finalizeRawCycle(rawSamples) {
        const samples = resampleCycleAtFixedAngle(
            rawSamples,
            this.angularStepDeg
        );

        // Le premier cycle après une réinitialisation peut être incomplet.
        if (!samples) {
            return;
        }

        const metrics =
            calculateCycleMetrics(samples);

        if (!metrics) {
            return;
        }

        this.completedCycleCount++;

        const cycle = {
            id: this.completedCycleCount,

            cylinderIndex:
            this.selectedCylinderIndex,

            angularStepDeg:
            this.angularStepDeg,

            samples,
            metrics
        };

        this.latestCycle = cycle;

        if (!this.isFrozen) {
            this.displayedCycle = cycle;
            this.scheduleRender();
        }
    }

    // Affichage

    scheduleRender() {
        if (!this.visible) {
            return;
        }

        const now = performance.now();

        const elapsed =
            now - this.lastChartRenderTime;

        if (
            elapsed
            >= this.chartRefreshIntervalMs
        ) {
            this.renderDisplayedCycle();
            return;
        }

        if (this.pendingRenderTimeout !== null) {
            return;
        }

        const delay =
            this.chartRefreshIntervalMs - elapsed;

        this.pendingRenderTimeout =
            window.setTimeout(
                () => {
                    this.pendingRenderTimeout = null;
                    this.renderDisplayedCycle();
                },
                delay
            );
    }

    renderDisplayedCycle() {
        const cycle = this.displayedCycle;

        if (!this.visible || !cycle) {
            return;
        }

        this.lastChartRenderTime =
            performance.now();

        const chartPoints = cycle.samples.map(
            sample => ({
                x: sample.volumeM3 * M3_TO_CM3,
                y: sample.pressurePa * PASCAL_TO_BAR,

                angleDeg: sample.angleDeg
            })
        );

        this.chart.data.datasets[0].data =
            chartPoints;

        this.chart.options.plugins.title.text = [
            `Diagramme P–V — cylindre ${
                cycle.cylinderIndex + 1
            }`,

            `${
                Math.round(cycle.metrics.meanRpm)
            } tr/min — ${
                cycle.metrics.meanBoostBar.toFixed(2)
            } bar de boost`
        ];

        if (this.isPumpingZoomEnabled) {
            this.chart.options.scales.y.max = 5;
            this.chart.options.scales.y.title.text =
                "Pression absolue — zoom pompage (bar)";
        } else {
            delete this.chart.options.scales.y.max;

            this.chart.options.scales.y.title.text =
                "Pression cylindre absolue (bar)";
        }

        this.chart.update("none");

        this.renderMetrics(cycle);
    }

    renderMetrics(cycle) {
        const metrics = cycle.metrics;

        const modeText = this.isFrozen
            ? `Cycle figé #${cycle.id}`
            : `Suivi direct — cycle #${cycle.id}`;

        this.updateStatus(modeText);

        this.setText(
            this.elements.rpmElement,
            `${Math.round(metrics.meanRpm)} tr/min`
        );

        this.setText(
            this.elements.boostElement,
            `${formatNumber(
                metrics.meanBoostBar,
                2
            )} bar`
        );

        this.setText(
            this.elements.peakPressureElement,
            `${
                formatNumber(
                    metrics.peakPressureBar,
                    1
                )
            } bar à ${
                formatNumber(
                    metrics.peakPressureAngleDeg,
                    1
                )
            }°`
        );

        this.setText(
            this.elements.workElement,
            `${formatNumber(
                metrics.netWorkJ,
                1
            )} J/cyl./cycle`
        );

        this.setText(
            this.elements.netImepElement,
            `${formatNumber(
                metrics.netImepBar,
                2
            )} bar`
        );

        this.setText(
            this.elements.grossImepElement,
            `${formatNumber(
                metrics.grossImepBar,
                2
            )} bar`
        );

        this.setText(
            this.elements.pmepElement,
            `${formatNumber(
                metrics.signedPmepBar,
                2
            )} bar`
        );

        this.setText(
            this.elements.torqueElement,
            `${
                formatNumber(
                    metrics.torqueFromPVNm,
                    1
                )
            } N·m — ${
                formatNumber(
                    metrics.powerFromPVHp,
                    1
                )
            } ch indiqués`
        );

        const consistencyLabel =
            getConsistencyLabel(
                metrics.torqueConsistencyErrorPercent
            );

        this.setText(
            this.elements.consistencyElement,
            `${
                formatNumber(
                    metrics.torqueConsistencyErrorPercent,
                    2
                )
            } % — ${consistencyLabel}`
        );

        this.setText(
            this.elements.resolutionElement,
            `${
                cycle.samples.length
            } points à ${
                cycle.angularStepDeg
            }°`
        );
    }

    // Commandes publiques

    freeze() {
        if (!this.latestCycle) {
            this.updateStatus(
                "Aucun cycle complet disponible."
            );

            return;
        }

        this.isFrozen = true;
        this.displayedCycle =
            this.latestCycle;

        this.renderDisplayedCycle();
    }

    resumeLive() {
        this.isFrozen = false;

        if (this.latestCycle) {
            this.displayedCycle =
                this.latestCycle;

            this.renderDisplayedCycle();
        } else {
            this.updateStatus(
                "Suivi direct activé — attente d'un cycle complet…"
            );
        }
    }

    togglePumpingZoom() {
        this.isPumpingZoomEnabled =
            !this.isPumpingZoomEnabled;

        this.setText(
            this.elements.zoomButton,
            this.isPumpingZoomEnabled
                ? "Vue cycle complet"
                : "Zoom boucle de pompage"
        );

        this.renderDisplayedCycle();
    }

    resetCapture() {
        this.rawCycleSamples = [];
        this.previousSample = null;

        this.latestCycle = null;
        this.displayedCycle = null;

        this.completedCycleCount = 0;
        this.isFrozen = false;

        this.chart.data.datasets[0].data = [];
        this.chart.update("none");
    }

    exportDisplayedCycleCsv() {
        const cycle = this.displayedCycle;

        if (!cycle) {
            this.updateStatus(
                "Aucun cycle à exporter."
            );

            return;
        }

        const metrics = cycle.metrics;

        const lines = [
            `# Cylindre;${
                cycle.cylinderIndex + 1
            }`,

            `# Régime moyen;${
                metrics.meanRpm.toFixed(3)
            };tr/min`,

            `# Boost moyen;${
                metrics.meanBoostBar.toFixed(6)
            };bar relatif`,

            `# Travail net P-V;${
                metrics.netWorkJ.toFixed(6)
            };J/cylindre/cycle`,

            `# IMEP net;${
                metrics.netImepBar.toFixed(6)
            };bar`,

            `# IMEP cycle fermé;${
                metrics.grossImepBar.toFixed(6)
            };bar`,

            `# PMEP signé;${
                metrics.signedPmepBar.toFixed(6)
            };bar`,

            `# Couple indiqué depuis P-V;${
                metrics.torqueFromPVNm.toFixed(6)
            };N.m`,

            `# Couple indiqué moyen du moteur;${
                metrics.meanIndicatedTorqueNm.toFixed(6)
            };N.m`,

            `# Erreur de cohérence;${
                metrics.torqueConsistencyErrorPercent.toFixed(6)
            };%`,

            "",

            [
                "angle_deg",
                "volume_m3",
                "volume_cm3",
                "pression_pa",
                "pression_bar_abs",
                "rpm",
                "boost_bar_rel",
                "throttle",
                "indicated_torque_nm",
                "closed_cycle_torque_nm",
                "pumping_torque_nm"
            ].join(";")
        ];

        for (const sample of cycle.samples) {
            lines.push([
                sample.angleDeg.toFixed(3),

                sample.volumeM3.toExponential(12),

                (
                    sample.volumeM3
                    * M3_TO_CM3
                ).toFixed(6),

                sample.pressurePa.toFixed(6),

                (
                    sample.pressurePa
                    * PASCAL_TO_BAR
                ).toFixed(6),

                sample.rpm.toFixed(6),

                sample.boostBar.toFixed(6),

                sample.throttle.toFixed(6),

                sample.indicatedTorqueNm.toFixed(6),

                sample.closedCycleTorqueNm.toFixed(6),

                sample.pumpingTorqueNm.toFixed(6)
            ].join(";"));
        }

        const filename = [
            "cycle-pv",
            `cylindre-${cycle.cylinderIndex + 1}`,
            `${Math.round(metrics.meanRpm)}rpm`,
            `cycle-${cycle.id}.csv`
        ].join("-");

        downloadTextFile(
            filename,
            lines.join("\n"),
            "text/csv"
        );
    }

    destroy() {
        if (this.pendingRenderTimeout !== null) {
            clearTimeout(
                this.pendingRenderTimeout
            );

            this.pendingRenderTimeout = null;
        }

        this.unsubscribeCycleRecorder?.();
        this.chart?.destroy();
    }
}
