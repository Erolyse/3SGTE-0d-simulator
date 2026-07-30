// Frontière typée minimale avec Chart.js.
// Le runtime Chart.js reste injecté par l'application ; ces contrats décrivent
// uniquement les membres réellement utilisés par le simulateur.

export interface XYPoint {
    x: number;
    y: number;
}

export interface ChartDatasetLike<TPoint = XYPoint> {
    label?: string;
    data: TPoint[];
    [key: string]: unknown;
}

export interface ChartScaleLike {
    getPixelForValue(value: number): number;
}

export interface ChartAreaLike {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface ChartInstanceLike<TPoint = XYPoint> {
    data: {
        datasets: Array<ChartDatasetLike<TPoint>>;
    };
    // Les options Chart.js sont volontairement dynamiques et versionnées côté UI.
    // On localise l'interop non typé ici plutôt que de le propager au moteur.
    options: any;
    scales: Record<string, ChartScaleLike | undefined>;
    tooltip?: any;
    setActiveElements?(elements: Array<{ datasetIndex: number; index: number }>): void;
    draw?(): void;
    update(mode?: string): void;
    destroy(): void;
    resize?(): void;
}

export interface ChartPluginContextLike<TPoint = XYPoint>
    extends ChartInstanceLike<TPoint> {
    ctx: CanvasRenderingContext2D;
    scales: Record<string, ChartScaleLike | undefined>;
    chartArea?: ChartAreaLike;
}

export interface ChartConstructorLike<TPoint = XYPoint> {
    defaults: any;
    register(...plugins: any[]): void;
    new (
        canvas: HTMLCanvasElement | CanvasRenderingContext2D | HTMLElement | null,
        configuration: any
    ): ChartInstanceLike<TPoint>;
}

export interface ChartPluginLike {
    id: string;
    beforeDatasetsDraw?(
        chart: ChartPluginContextLike,
        args: unknown,
        options: any
    ): void;
    afterDatasetsDraw?(
        chart: ChartPluginContextLike,
        args: unknown,
        options: any
    ): void;
}

declare global {
    var Chart: ChartConstructorLike | undefined;
}