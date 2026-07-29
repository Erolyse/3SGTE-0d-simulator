// Consommation de carburant injecté : débit instantané et moyenne en L/100 km.
// La distance routière équivalente provient du modèle de banc dans Dyno.js.

import { FUEL_DENSITY_KG_PER_L } from "./FuelConstants.js";
import type { EngineStateData } from "../engine/EngineStateTypes.js";

// La combustion est pulsée cylindre par cylindre. Un affichage direct serait à
// zéro pendant une grande partie du cycle puis présenterait des pics très élevés.
// Une moyenne exponentielle courte reproduit le comportement d'un instrument.
const SMOOTHING_TAU = 0.05; // s

export function updateFuel(state: EngineStateData, dt: number): void {
    if (dt <= 0) {
        return;
    }

    // Débit instantané lissé

    // fuelMassBurnedStep contient toute la masse injectée, enrichissement compris.
    // La fraction chimiquement brûlée est suivie séparément par la thermodynamique.
    const fuelMassFlow = state.fuelMassBurnedStep / dt; // kg/s injectés
    const rawInstantLh = fuelMassFlow
        / FUEL_DENSITY_KG_PER_L
        * 3600;

    const alpha = 1 - Math.exp(-dt / SMOOTHING_TAU);
    state.instantFuelConsumptionLh += (
        rawInstantLh - state.instantFuelConsumptionLh
    ) * alpha;

    // Cumul total

    state.fuelMass += state.fuelMassBurnedStep;

    // Consommation routière équivalente

    // La carrosserie reste immobile sur un banc à rouleaux. distanceTraveled
    // représente donc la distance qu'aurait parcourue la roue à cette vitesse.
    if (state.distanceTraveled > 1) {
        const totalFuelLiters = state.fuelMass
            / FUEL_DENSITY_KG_PER_L;
        const distanceKm = state.distanceTraveled / 1000;

        state.avgConsumptionL100km = totalFuelLiters
            / distanceKm
            * 100;
    }
}