// Propriétés thermodynamiques des gaz utilisées par le modèle 0D.

export const R_AIR = 287.05;   // J/(kg.K) — constante spécifique de l'air sec
export const GAMMA_AIR = 1.40; // Cp/Cv — approximation à température modérée

// Pour un gaz parfait : R = Cp - Cv et gamma = Cp / Cv.
export const CV_AIR = R_AIR / (GAMMA_AIR - 1); // J/(kg.K)
export const CP_AIR = GAMMA_AIR * CV_AIR;      // J/(kg.K)

// Dans le cylindre, la charge devient un mélange d'air, de gaz résiduels et
// de produits de combustion. Un gamma légèrement plus faible représente
// l'augmentation des capacités thermiques avec la température et les gaz brûlés.
export const GAMMA_CYLINDER_GAS = 1.35;
export const CV_CYLINDER_GAS = R_AIR / (GAMMA_CYLINDER_GAS - 1);
export const CP_CYLINDER_GAS = CV_CYLINDER_GAS + R_AIR;