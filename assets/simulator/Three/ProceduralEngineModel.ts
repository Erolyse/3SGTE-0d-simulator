// Représentation procédurale des quatre chemises, pistons et volumes de
// combustion. Les positions proviennent directement de EngineState.

import * as THREE from "three";
import { CombustionVisual } from "./CombustionVisuals.js";
import type { EngineVisualOutputState } from "./ThreeTypes.js";

// Constantes visuelles

const CYLINDER_COUNT = 4;

// Conversion de la géométrie physique du moteur vers les unités Three.js.
// La course réelle de 86 mm devient environ 1,03 unité visuelle.
const METERS_TO_SCENE_UNITS = 12;

// Espacement entre les axes des quatre cylindres.
const CYLINDER_SPACING = 1.30;

// Dimensions graphiques des chemises.
const LINER_RADIUS = 0.47;
const LINER_HEIGHT = 1.72;
const LINER_CENTER_Y = 0.20;

// Dimensions graphiques des pistons.
const PISTON_RADIUS = 0.41;
const PISTON_HEIGHT = 0.48;

// Position du centre du piston lorsque le piston est au PMH.
const PISTON_TDC_CENTER_Y = 0.78;

// Plan inférieur de la culasse. Le volume gazeux est dessiné
// entre la tête du piston et ce plan.
const HEAD_PLANE_Y = 1.09;

// Évite qu'un volume de combustion devienne mathématiquement nul au PMH.
const MIN_GAS_HEIGHT = 0.055;

// Rayon du volume gazeux rendu à l'intérieur de la chemise.
const GAS_RADIUS = 0.385;

function createMetalMaterial() {
    return new THREE.MeshStandardMaterial({
        color: 0xaeb5bc,
        metalness: 0.82,
        roughness: 0.27
    });
}

function createLinerMaterial() {
    return new THREE.MeshPhysicalMaterial({
        color: 0x7d8994,
        metalness: 0.25,
        roughness: 0.22,
        transparent: true,
        opacity: 0.14,
        transmission: 0.08,
        thickness: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false
    });
}

function createGasMaterial() {
    return new THREE.MeshStandardMaterial({
        color: 0x361006,
        emissive: 0x361006,
        emissiveIntensity: 0.03,
        transparent: true,
        opacity: 0.035,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
}

/**
 * Modèle procédural minimal du quatre-cylindres.
 */
export class ProceduralEngineModel extends THREE.Group {
    readonly pistons: Array<THREE.Mesh<
        THREE.CylinderGeometry,
        THREE.MeshStandardMaterial
>> = [];
    readonly gasMeshes: Array<THREE.Mesh<
        THREE.CylinderGeometry,
        THREE.MeshStandardMaterial
>> = [];
    readonly combustionLights: THREE.PointLight[] = [];
    readonly combustionVisuals: CombustionVisual[] = [];
    readonly metalMaterial: THREE.MeshStandardMaterial;
    readonly linerMaterial: THREE.MeshPhysicalMaterial;

    constructor() {
        super();

        this.name = "ProceduralEngineModel";

        this.metalMaterial = createMetalMaterial();
        this.linerMaterial = createLinerMaterial();

        this.buildStaticFrame();
        this.buildCylinders();
    }

    // Construction du modèle

    buildStaticFrame(): void {
        // Plaque sombre servant uniquement de repère visuel sous les cylindres.
        const baseGeometry = new THREE.BoxGeometry(
            CYLINDER_SPACING * 4.15,
            0.16,
            1.30
        );
        const baseMaterial = new THREE.MeshStandardMaterial({
            color: 0x20262b,
            metalness: 0.55,
            roughness: 0.45
        });

        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.name = "EngineBase";
        base.position.y = -0.78;
        base.receiveShadow = true;
        this.add(base);

        // Traverse supérieure simplifiée représentant le plan de culasse.
        const headGeometry = new THREE.BoxGeometry(
            CYLINDER_SPACING * 4.15,
            0.12,
            1.10
        );
        const head = new THREE.Mesh(headGeometry, this.metalMaterial);
        head.name = "CylinderHeadReference";
        head.position.y = HEAD_PLANE_Y + 0.07;
        head.castShadow = true;
        head.receiveShadow = true;
        this.add(head);
    }

    buildCylinders(): void {
        for (let i = 0; i < CYLINDER_COUNT; i++) {
            const x = (i - (CYLINDER_COUNT - 1) / 2)
                * CYLINDER_SPACING;

            const cylinderGroup = new THREE.Group();
            cylinderGroup.name = `CylinderGroup_${i + 1}`;
            cylinderGroup.position.x = x;
            this.add(cylinderGroup);

            this.buildSingleCylinder(cylinderGroup, i);
        }
    }

    buildSingleCylinder(
        cylinderGroup: THREE.Group,
        cylinderIndex: number
    ): void {
        // Chemise translucide.
        const linerGeometry = new THREE.CylinderGeometry(
            LINER_RADIUS,
            LINER_RADIUS,
            LINER_HEIGHT,
            48,
            1,
            true
        );
        const liner = new THREE.Mesh(linerGeometry, this.linerMaterial);
        liner.name = `CylinderLiner_${cylinderIndex + 1}`;
        liner.position.y = LINER_CENTER_Y;
        liner.renderOrder = 1;
        cylinderGroup.add(liner);

        // Contours de la chemise pour conserver une bonne lecture
        // même avec une faible opacité.
        const linerEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(linerGeometry, 20),
            new THREE.LineBasicMaterial({
                color: 0x56636d,
                transparent: true,
                opacity: 0.55
            })
        );
        linerEdges.name = `CylinderLinerEdges_${cylinderIndex + 1}`;
        linerEdges.position.copy(liner.position);
        cylinderGroup.add(linerEdges);

        // Piston.
        const pistonGeometry = new THREE.CylinderGeometry(
            PISTON_RADIUS,
            PISTON_RADIUS,
            PISTON_HEIGHT,
            48
        );
        const piston = new THREE.Mesh(
            pistonGeometry,
            this.metalMaterial
        );
        piston.name = `Piston_${cylinderIndex + 1}`;
        piston.position.y = PISTON_TDC_CENTER_Y;
        piston.castShadow = true;
        piston.receiveShadow = true;
        cylinderGroup.add(piston);
        this.pistons.push(piston);

        // Volume gazeux. La géométrie fait 1 unité de haut,
        // puis scale.y est modifié à chaque image.
        const gasGeometry = new THREE.CylinderGeometry(
            GAS_RADIUS,
            GAS_RADIUS,
            1,
            48,
            1,
            false
        );
        const gasMesh = new THREE.Mesh(
            gasGeometry,
            createGasMaterial()
        );
        gasMesh.name = `CombustionGas_${cylinderIndex + 1}`;
        gasMesh.renderOrder = 2;
        cylinderGroup.add(gasMesh);
        this.gasMeshes.push(gasMesh);

        // Lumière ponctuelle sans ombre : elle éclaire brièvement
        // le piston et la chemise lors de la combustion.
        const combustionLight = new THREE.PointLight(
            0xffb12b,
            0,
            2.6,
            2
        );
        combustionLight.name = `CombustionLight_${cylinderIndex + 1}`;
        combustionLight.castShadow = false;
        cylinderGroup.add(combustionLight);
        this.combustionLights.push(combustionLight);

        const combustionVisual = new CombustionVisual({
            gasMesh,
            pointLight: combustionLight
        });
        this.combustionVisuals.push(combustionVisual);

        this.updateCylinderGeometry(cylinderIndex, 0);
    }

    // Mise à jour depuis la physique

    /**
     * Lit l'état moteur sans jamais le modifier.
     *
     * @param {object} state EngineState courant.
     * @param {number} renderDt Temps entre deux images en secondes.
     */
    updateFromEngineState(
        state: EngineVisualOutputState,
        renderDt: number
    ): void {
        const pistonPositions = state?.pistonPositions ?? [];
        const heatReleaseRates = state?.cylinderHeatReleaseRate ?? [];

        for (let i = 0; i < CYLINDER_COUNT; i++) {
            const pistonPosition = pistonPositions[i];
            const displacementM = Number.isFinite(pistonPosition)
                ? Math.max(0, pistonPosition as number)
        : 0;

            this.updateCylinderGeometry(i, displacementM);

            const heatReleaseRate = heatReleaseRates[i];
            const heatReleaseRateW = Number.isFinite(heatReleaseRate)
                ? heatReleaseRate as number
                : 0;

            this.combustionVisuals[i].update(
                heatReleaseRateW,
                renderDt
            );
        }
    }

    updateCylinderGeometry(
        cylinderIndex: number,
        displacementM: number
    ): void {
        const piston = this.pistons[cylinderIndex];
        const gasMesh = this.gasMeshes[cylinderIndex];
        const combustionLight = this.combustionLights[cylinderIndex];

        if (!piston || !gasMesh || !combustionLight) return;

        const pistonCenterY = PISTON_TDC_CENTER_Y
            - displacementM * METERS_TO_SCENE_UNITS;

        piston.position.y = pistonCenterY;

        const pistonCrownY = pistonCenterY + PISTON_HEIGHT / 2;
        const gasHeight = Math.max(
            MIN_GAS_HEIGHT,
            HEAD_PLANE_Y - pistonCrownY
        );

        gasMesh.scale.y = gasHeight;
        gasMesh.position.y = pistonCrownY + gasHeight / 2;

        combustionLight.position.y = Math.min(
            HEAD_PLANE_Y - 0.04,
            gasMesh.position.y + gasHeight * 0.20
        );
    }

    // Libération des ressources gpu

    dispose(): void {
        this.traverse(object => {
            if (object.geometry) {
                object.geometry.dispose();
            }

            if (object.material) {
                const materials = Array.isArray(object.material)
                    ? object.material
                    : [object.material];

                for (const material of materials) {
                    material.dispose();
                }
            }
        });
    }
}

export default ProceduralEngineModel;