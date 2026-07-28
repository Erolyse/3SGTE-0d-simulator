// Configure la scène Three.js et affiche le modèle procédural.
// Le viewer utilise la boucle requestanimationframe déjà présente
// dans main.js. Il ne crée volontairement aucune seconde boucle.

import * as THREE from "three";
import ProceduralEngineModel from "./ProceduralEngineModel.js";
import EngineVisualPlayback from "./EngineVisualPlayback.js";

const CAMERA_TARGET = new THREE.Vector3(0, 0.18, 0);

// Limites de la caméra orbitale simplifiée.
const MIN_CAMERA_RADIUS = 4.2;
const MAX_CAMERA_RADIUS = 13.0;
const MIN_CAMERA_PHI = 0.35;
const MAX_CAMERA_PHI = Math.PI - 0.35;

export default class EngineViewer {
    /**
     * @param {object} options
     * @param {HTMLCanvasElement} options.canvas Canvas utilisé par Three.js.
     * @param {object|null} options.cycleRecorder Recorder angulaire 720°.
     * @param {number} options.defaultCycleDurationSeconds Durée visuelle initiale.
     */
    constructor({
                    canvas,
                    cycleRecorder = null,
                    defaultCycleDurationSeconds = 2,
                    pixelRatioCap = 1.25,
                    shadows = false
                }) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError(
                "EngineViewer nécessite un HTMLCanvasElement valide."
            );
        }

        this.canvas = canvas;
        this.disposed = false;
        this.pixelRatioCap = Math.max(1, Number(pixelRatioCap) || 1);
        this.shadowsEnabled = Boolean(shadows);
        this.resizeDirty = true;

        // Paramètres de la caméra orbitale légère.
        this.cameraRadius = 7.2;
        this.cameraTheta = 0.78;
        this.cameraPhi = 1.08;

        this.pointerActive = false;
        this.lastPointerX = 0;
        this.lastPointerY = 0;

        this.createRenderer();
        this.createScene();
        this.createCamera();
        this.createLighting();
        this.createEnvironment();
        this.createEngineModel();
        this.installPointerControls();
        this.installResizeObserver();

        this.visualPlayback = new EngineVisualPlayback({
            canvas: this.canvas,
            cycleRecorder,
            defaultCycleDurationSeconds
        });

        this.resizeRendererToDisplaySize();
        this.updateCameraPosition();
    }

    createRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false,
            powerPreference: "high-performance"
        });

        this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, this.pixelRatioCap)
        );
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;

        this.renderer.shadowMap.enabled = this.shadowsEnabled;
        if (this.shadowsEnabled) {
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }
    }

    createScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05080a);
        this.scene.fog = new THREE.Fog(0x05080a, 10, 22);
    }

    createCamera() {
        this.camera = new THREE.PerspectiveCamera(
            42,
            1,
            0.05,
            100
        );
    }

    createLighting() {
        // Éclairage général doux : évite les faces totalement noires.
        const hemisphereLight = new THREE.HemisphereLight(
            0xbddcff,
            0x101315,
            1.45
        );
        hemisphereLight.name = "ViewerHemisphereLight";
        this.scene.add(hemisphereLight);

        // Source principale venant du dessus et de l'avant.
        const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
        keyLight.name = "ViewerKeyLight";
        keyLight.position.set(4.2, 6.5, 5.0);
        keyLight.castShadow = this.shadowsEnabled;
        keyLight.shadow.mapSize.set(1024, 1024);
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 20;
        keyLight.shadow.camera.left = -6;
        keyLight.shadow.camera.right = 6;
        keyLight.shadow.camera.top = 6;
        keyLight.shadow.camera.bottom = -6;
        this.scene.add(keyLight);

        // Contre-lumière froide pour détacher les contours du fond.
        const rimLight = new THREE.DirectionalLight(0x58a6ff, 1.5);
        rimLight.name = "ViewerRimLight";
        rimLight.position.set(-4, 3, -5);
        this.scene.add(rimLight);
    }

    createEnvironment() {
        // Sol sombre recevant les ombres.
        const floorGeometry = new THREE.PlaneGeometry(30, 30);
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0x090d10,
            metalness: 0.15,
            roughness: 0.82
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.name = "ViewerFloor";
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.88;
        floor.receiveShadow = true;
        this.scene.add(floor);

        const grid = new THREE.GridHelper(
            18,
            36,
            0x1a7034,
            0x17301f
        );
        grid.name = "ViewerGrid";
        grid.position.y = -0.875;
        grid.material.transparent = true;
        grid.material.opacity = 0.32;
        this.scene.add(grid);
    }

    createEngineModel() {
        this.engineModel = new ProceduralEngineModel();
        this.engineModel.rotation.y = -0.10;
        this.scene.add(this.engineModel);
    }

    installResizeObserver() {
        this.resizeObserver = typeof ResizeObserver === "function"
            ? new ResizeObserver(() => {
                this.resizeDirty = true;
            })
            : null;
        this.resizeObserver?.observe(this.canvas);
        this.onWindowResize = () => {
            this.resizeDirty = true;
        };
        window.addEventListener("resize", this.onWindowResize, {
            passive: true
        });
    }

    // Contrôle caméra sans dépendance supplémentaire

    installPointerControls() {
        this.onPointerDown = event => {
            this.pointerActive = true;
            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;
            this.canvas.setPointerCapture?.(event.pointerId);
        };

        this.onPointerMove = event => {
            if (!this.pointerActive) return;

            const deltaX = event.clientX - this.lastPointerX;
            const deltaY = event.clientY - this.lastPointerY;

            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;

            this.cameraTheta -= deltaX * 0.006;
            this.cameraPhi = THREE.MathUtils.clamp(
                this.cameraPhi + deltaY * 0.006,
                MIN_CAMERA_PHI,
                MAX_CAMERA_PHI
            );

            this.updateCameraPosition();
        };

        this.onPointerUp = event => {
            this.pointerActive = false;
            this.canvas.releasePointerCapture?.(event.pointerId);
        };

        this.onWheel = event => {
            event.preventDefault();

            const zoomFactor = Math.exp(event.deltaY * 0.001);
            this.cameraRadius = THREE.MathUtils.clamp(
                this.cameraRadius * zoomFactor,
                MIN_CAMERA_RADIUS,
                MAX_CAMERA_RADIUS
            );

            this.updateCameraPosition();
        };

        this.canvas.addEventListener("pointerdown", this.onPointerDown);
        this.canvas.addEventListener("pointermove", this.onPointerMove);
        this.canvas.addEventListener("pointerup", this.onPointerUp);
        this.canvas.addEventListener("pointercancel", this.onPointerUp);
        this.canvas.addEventListener("wheel", this.onWheel, {
            passive: false
        });
    }

    updateCameraPosition() {
        const sinPhi = Math.sin(this.cameraPhi);

        this.camera.position.set(
            CAMERA_TARGET.x
            + this.cameraRadius * sinPhi * Math.cos(this.cameraTheta),
            CAMERA_TARGET.y
            + this.cameraRadius * Math.cos(this.cameraPhi),
            CAMERA_TARGET.z
            + this.cameraRadius * sinPhi * Math.sin(this.cameraTheta)
        );

        this.camera.lookAt(CAMERA_TARGET);
    }

    // API publique

    updateFromEngineState(state, renderDt) {
        if (this.disposed) return;

        const visualState = this.visualPlayback.update(
            state,
            renderDt
        );

        this.engineModel.updateFromEngineState(
            visualState,
            renderDt
        );
    }

    getPlaybackStatus() {
        return this.visualPlayback.getStatus();
    }

    render() {
        if (this.disposed) return;

        if (this.resizeDirty) {
            this.resizeRendererToDisplaySize();
        }
        this.renderer.render(this.scene, this.camera);
    }

    resizeRendererToDisplaySize() {
        this.resizeDirty = false;
        const width = Math.max(1, this.canvas.clientWidth);
        const height = Math.max(1, this.canvas.clientHeight);
        const pixelRatio = Math.min(
            window.devicePixelRatio || 1,
            this.pixelRatioCap
        );

        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;

        this.canvas.removeEventListener("pointerdown", this.onPointerDown);
        this.canvas.removeEventListener("pointermove", this.onPointerMove);
        this.canvas.removeEventListener("pointerup", this.onPointerUp);
        this.canvas.removeEventListener("pointercancel", this.onPointerUp);
        this.canvas.removeEventListener("wheel", this.onWheel);
        window.removeEventListener("resize", this.onWindowResize);
        this.resizeObserver?.disconnect();

        this.visualPlayback.dispose();
        this.engineModel.dispose();
        this.renderer.dispose();
    }
}
