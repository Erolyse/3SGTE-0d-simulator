/**
 * Calcule l'aire de rideau totale créée par la levée des soupapes.
 */
export function calculateValveCurtainArea(
    valveCount: number,
    valveDiameter: number,
    lift: number
): number {
    if (valveCount <= 0 || valveDiameter <= 0 || lift <= 0) {
        return 0;
    }

    return valveCount * Math.PI * valveDiameter * lift;
}

/**
 * Calcule l'aire totale des cols de ports assimilés à des sections circulaires.
 */
export function calculatePortThroatArea(
    portCount: number,
    portDiameter: number
): number {
    if (portCount <= 0 || portDiameter <= 0) {
        return 0;
    }

    return portCount * Math.PI * Math.pow(portDiameter, 2) / 4;
}

/**
 * L'aire de passage effective est limitée par la plus petite des deux sections :
 * rideau de soupape ou col des ports.
 */
export function calculateValveFlowArea(
    valveCount: number,
    valveDiameter: number,
    portDiameter: number,
    lift: number
): number {
    return Math.min(
        calculateValveCurtainArea(valveCount, valveDiameter, lift),
        calculatePortThroatArea(valveCount, portDiameter)
    );
}