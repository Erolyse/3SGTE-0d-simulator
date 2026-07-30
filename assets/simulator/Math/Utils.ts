/**
 * Borne une valeur numérique entre un minimum et un maximum inclusifs.
 */
export function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Interpolation smoothstep sur l'intervalle [0, 1].
 */
export function smoothStep01(value: number): number {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
}

/** Convertit un angle exprimé en radians vers des degrés. */
export function radiansToDegrees(angleRad: number): number {
    return angleRad * 180 / Math.PI;
}

/** Un cycle moteur quatre temps complet, exprimé en radians. */
export const FOUR_STROKE_CYCLE_RADIANS = 4 * Math.PI;

/**
 * Ramène un angle vilebrequin dans l'intervalle [0, 4π[.
 */
export function normalizeFourStrokeAngle(theta: number): number {
    return ((theta % FOUR_STROKE_CYCLE_RADIANS)
            + FOUR_STROKE_CYCLE_RADIANS)
        % FOUR_STROKE_CYCLE_RADIANS;
}