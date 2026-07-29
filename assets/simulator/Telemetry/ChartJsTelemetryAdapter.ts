import type { TelemetrySample, TelemetryValue } from "./TelemetryRecorder.js";

export interface TelemetryRecorderForChartAdapter {
    getSamplesAfter(sequence?: number): TelemetrySample[];
}

export interface ChartPoint { x: number; y: number; }
export interface ChartDatasetLike { data: ChartPoint[]; }
export interface ChartLike {
    data: { datasets: ChartDatasetLike[] };
    update(mode?: string): void;
}
export interface ChartSeriesMapping {
    datasetIndex: number;
    key: string;
    transform?: (value: TelemetryValue, sample: TelemetrySample) => unknown;
}
export interface ChartJsTelemetryAdapterOptions {
    recorder: TelemetryRecorderForChartAdapter;
    chart: ChartLike;
    xKey?: string;
    series?: ChartSeriesMapping[];
    maximumPoints?: number;
    minimumPointIntervalSeconds?: number;
    maximumBatchSamples?: number;
}

// Adaptateur léger entre TelemetryRecorder et une instance Chart.js existante.
// L'instance Chart.js est fournie de l'extérieur ; l'adapter reste générique.

export default class ChartJsTelemetryAdapter {
    readonly recorder: TelemetryRecorderForChartAdapter;
    readonly chart: ChartLike;
    readonly xKey: string;
    readonly series: ChartSeriesMapping[];
    readonly maximumPoints: number;
    readonly minimumPointIntervalSeconds: number;
    readonly maximumBatchSamples: number;
    lastSequence: number;
    lastAcceptedX: number;

    constructor({
                    recorder,
                    chart,
                    xKey = "time",
                    series = [],
                    maximumPoints = 900,
                    minimumPointIntervalSeconds = 0,
                    maximumBatchSamples = 2000
                }: ChartJsTelemetryAdapterOptions) {
        if (!recorder || typeof recorder.getSamplesAfter !== "function") {
            throw new TypeError("Un TelemetryRecorder valide est requis.");
        }

        if (!chart || !chart.data || !Array.isArray(chart.data.datasets)) {
            throw new TypeError("Une instance Chart.js valide est requise.");
        }

        if (!Array.isArray(series) || series.length === 0) {
            throw new TypeError("Au moins une série Chart.js est requise.");
        }

        this.recorder = recorder;
        this.chart = chart;
        this.xKey = xKey;
        this.series = series;
        this.maximumPoints = Math.max(Math.floor(maximumPoints), 2);
        this.minimumPointIntervalSeconds = Math.max(
            Number(minimumPointIntervalSeconds) || 0,
            0
        );
        this.maximumBatchSamples = Math.max(
            Math.trunc(maximumBatchSamples),
            this.maximumPoints
        );
        this.lastSequence = -1;
        this.lastAcceptedX = Number.NEGATIVE_INFINITY;
    }

    reset(): void {
        this.lastSequence = -1;
        this.lastAcceptedX = Number.NEGATIVE_INFINITY;

        for (const dataset of this.chart.data.datasets) {
            dataset.data.length = 0;
        }

        this.chart.update("none");
    }

    /**
     * À appeler une seule fois par requestAnimationFrame.
     * Tous les échantillons 60 Hz produits depuis la dernière frame sont ajoutés,
     * puis Chart.js n'est rafraîchi qu'une seule fois.
     */
    update(): number {
        let samples = this.recorder.getSamplesAfter(this.lastSequence);

        if (samples.length === 0) {
            return 0;
        }

        if (samples.length > this.maximumBatchSamples) {
            samples = samples.slice(-this.maximumBatchSamples);
        }

        let accepted = 0;
        for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
            const sample = samples[sampleIndex];
            const xValue = sample[this.xKey];

            if (typeof xValue !== "number" || !Number.isFinite(xValue)) {
                continue;
            }

            if (xValue - this.lastAcceptedX
                < this.minimumPointIntervalSeconds) {
                continue;
            }

            this.lastAcceptedX = xValue;
            accepted++;

            for (let mappingIndex = 0;
                 mappingIndex < this.series.length;
                 mappingIndex++) {
                const mapping = this.series[mappingIndex];
                const dataset = this.chart.data.datasets[
                    mapping.datasetIndex
                    ];
                if (!dataset) continue;

                const rawValue = sample[mapping.key];
                const yValue = typeof mapping.transform === "function"
                    ? mapping.transform(rawValue, sample)
                    : rawValue;
                if (typeof yValue !== "number" || !Number.isFinite(yValue)) continue;

                dataset.data.push({ x: xValue, y: yValue });
            }
        }

        this.lastSequence = samples[samples.length - 1].sequence;

        if (accepted === 0) {
            return 0;
        }

        for (let index = 0; index < this.chart.data.datasets.length; index++) {
            const data = this.chart.data.datasets[index].data;
            if (data.length > this.maximumPoints) {
                data.splice(0, data.length - this.maximumPoints);
            }
        }

        this.chart.update("none");
        return accepted;
    }
}