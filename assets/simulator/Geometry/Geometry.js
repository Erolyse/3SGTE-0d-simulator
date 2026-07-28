// Géométrie nominale du 3S-GTE en unités SI.
export const BORE = 0.086;           // Alésage (86 mm)
export const STROKE = 0.086;         // Course (86 mm)
export const ROD_LENGTH = 0.138;     // Longueur de bielle (138 mm)
export const CRANK_RADIUS = STROKE / 2; // Rayon de manivelle (43 mm)
export const COMP_RATIO = 8.5;       // Ratio de compression (8.5:1)

// Volumes statiques.
export const SWEPT_VOLUME = (Math.PI * Math.pow(BORE, 2) * STROKE) / 4;

export const CLEARANCE_VOLUME = SWEPT_VOLUME / (COMP_RATIO - 1);

export const PISTON_AREA = Math.PI*BORE*BORE/4

// Déphasages des quatre cylindres correspondant à l'ordre d'allumage 1-3-4-2.
export const CYLINDER_OFFSETS = [
    0,                  // Cylindre 1 (référence)
    Math.PI,            // Cylindre 2 : combustion 540° après le cylindre 1
    3 * Math.PI,        // Cylindre 3 : combustion 180° après le cylindre 1
    2 * Math.PI         // Cylindre 4 : combustion 360° après le cylindre 1
];

// Fonctions cinématiques

/**
 * Calcule la position du piston par rapport au Point Mort Haut (PMH)
 * @param {number} theta Angle du vilebrequin en radians (0 = PMH)
 * @returns {number} Descente du piston en mètres
 */
export function getPistonDisplacementFromTDC(theta) {
    const r = CRANK_RADIUS;
    const l = ROD_LENGTH;

    const term1 = 1 - Math.cos(theta);
    const term2 = (l / r) * (1 - Math.sqrt(1 - Math.pow((r / l) * Math.sin(theta), 2)));

    return r * (term1 + term2);
}

/**
 * Calcule le volume instantané dans la chambre de combustion
 * @param {number} theta Angle du vilebrequin en radians
 * @returns {number} Volume total en mètres cubes
 */
export function getCylinderVolume(theta) {
    const x = getPistonDisplacementFromTDC(theta);
    return CLEARANCE_VOLUME + PISTON_AREA * x;
}

/**
 * Bras de levier de couple : dx/dtheta (dérivée analytique de getPistonDisplacementFromTDC).
 * Par le principe des travaux virtuels (F * v_piston = Couple * omega, avec v_piston = dx/dtheta * omega),
 * le couple transmis au vilebrequin par une force de piston F est simplement : Couple = F * getTorqueArm(theta).
 * @param {number} theta Angle du vilebrequin en radians
 * @returns {number} dx/dtheta en mètres/radian (signé : négatif quand le piston remonte)
 */
export function getTorqueArm(theta) {
    const r = CRANK_RADIUS;
    const l = ROD_LENGTH;
    const ratio = r / l;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const denom = Math.sqrt(1 - Math.pow(ratio * sinT, 2));

    return r * sinT * (1 + (ratio * cosT) / denom);
}
