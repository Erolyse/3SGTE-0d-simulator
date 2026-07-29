// Convertit le dégagement thermique d'un cylindre en effet visuel lisible.
// Ce module est passif et ne modifie jamais la physique du moteur.

import * as THREE from "three";

// Puissance thermique de référence utilisée uniquement pour normaliser
// l'effet graphique. Une combustion réelle peut atteindre plusieurs MW
// pendant un temps très court dans un cylindre.
const HEAT_RELEASE_REFERENCE_W = 2_500_000;

// Temps de montée très court : le flash apparaît presque immédiatement.
const FLASH_ATTACK_TIME = 0.006; // s

// Temps de décroissance volontairement plus long que le phénomène physique.
// Cette persistance rend l'explosion visible sur un écran à 60 FPS.
const FLASH_DECAY_TIME = 0.055; // s

// Réglages purement visuels.
const BASE_EMISSIVE_INTENSITY = 0.03;
const MAX_EMISSIVE_INTENSITY = 4.5;
const BASE_GAS_OPACITY = 0.035;
const MAX_GAS_OPACITY = 0.72;
const MAX_POINT_LIGHT_INTENSITY = 55;

// Couleurs du volume gazeux hors combustion et en combustion.
const COLD_GAS_COLOR = new THREE.Color(0x361006);
const HOT_GAS_COLOR = new THREE.Color(0xffd45a);
const LIGHT_COLOR = new THREE.Color(0xffb12b);

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

/**
 * Gère l'effet de combustion d'un seul cylindre.
 */
export interface CombustionVisualOptions {
    gasMesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
    pointLight: THREE.PointLight;
}

export class CombustionVisual {
    readonly gasMesh: THREE.Mesh<
        THREE.CylinderGeometry,
        THREE.MeshStandardMaterial
        >;
    readonly pointLight: THREE.PointLight;
    intensity = 0;
    readonly currentColor = new THREE.Color();

    /**
     * @param {object} options
     * @param {THREE.Mesh} options.gasMesh Volume gazeux visible dans la chambre.
     * @param {THREE.PointLight} options.pointLight Lumière placée dans le cylindre.
     */
    constructor({ gasMesh, pointLight }: CombustionVisualOptions) {
        this.gasMesh = gasMesh;
        this.pointLight = pointLight;

        // Intensité et couleur temporaires sont initialisées sur la classe.

        this.reset();
    }

    /**
     * Met à jour le flash à partir du dégagement thermique physique.
     *
     * @param {number} heatReleaseRateW Puissance thermique du cylindre en W.
     * @param {number} renderDt Durée écoulée entre deux images en secondes.
     */
    update(heatReleaseRateW: number, renderDt: number): void {
        const safeRate = Number.isFinite(heatReleaseRateW)
            ? Math.max(0, heatReleaseRateW)
            : 0;

        const safeDt = Number.isFinite(renderDt)
            ? Math.max(0, Math.min(renderDt, 0.1))
            : 0;

        // La racine carrée compresse la dynamique visuelle :
        // les combustions faibles restent visibles sans saturer les fortes charges.
        const normalizedHeat = clamp01(
            safeRate / HEAT_RELEASE_REFERENCE_W
        );
        const targetIntensity = Math.sqrt(normalizedHeat);

        // Filtre exponentiel avec montée rapide et descente plus lente.
        const timeConstant = targetIntensity > this.intensity
            ? FLASH_ATTACK_TIME
            : FLASH_DECAY_TIME;

        const response = safeDt > 0
            ? 1 - Math.exp(-safeDt / timeConstant)
            : 1;

        this.intensity += (targetIntensity - this.intensity) * response;
        this.intensity = clamp01(this.intensity);

        this.applyVisualState();
    }

    applyVisualState(): void {
        const material = this.gasMesh.material;

        // Mélange progressif orange sombre → jaune chaud.
        this.currentColor.copy(COLD_GAS_COLOR).lerp(
            HOT_GAS_COLOR,
            this.intensity
        );

        material.color.copy(this.currentColor);
        material.emissive.copy(this.currentColor);
        material.emissiveIntensity = BASE_EMISSIVE_INTENSITY
            + this.intensity * MAX_EMISSIVE_INTENSITY;
        material.opacity = BASE_GAS_OPACITY
            + this.intensity * MAX_GAS_OPACITY;

        this.pointLight.color.copy(LIGHT_COLOR);
        this.pointLight.intensity = this.intensity
            * MAX_POINT_LIGHT_INTENSITY;
    }

    reset(): void {
        this.intensity = 0;
        this.applyVisualState();
    }
}

export default CombustionVisual;