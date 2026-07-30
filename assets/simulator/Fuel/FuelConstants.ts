// Constantes carburant communes au suivi de consommation et à la combustion.

/** Masse volumique de travail de l'essence, en kg/L. */
export const FUEL_DENSITY_KG_PER_L = 0.745;

/** Pouvoir calorifique inférieur de travail de l'essence, en J/kg. */
export const LHV_FUEL = 44_000_000;

/** Rapport air/carburant stœchiométrique de travail. */
export const STOICHIOMETRIC_AFR = 14.7;

/**
 * Fraction de l'énergie chimique effectivement libérée dans les gaz par le
 * modèle de combustion. Ce n'est pas un rendement mécanique.
 */
export const COMBUSTION_HEAT_RELEASE_EFFICIENCY = 0.96;