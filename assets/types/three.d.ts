declare module "three" {
    export type ColorRepresentation = number | string | Color;

    export class Vector2 {
        x: number;
        y: number;
        set(x: number, y: number): this;
    }

    export class Vector3 {
        x: number;
        y: number;
        z: number;
        constructor(x?: number, y?: number, z?: number);
        set(x: number, y: number, z: number): this;
        copy(vector: Vector3): this;
    }

    export class Euler {
        x: number;
        y: number;
        z: number;
    }

    export class Color {
        constructor(color?: ColorRepresentation);
        copy(color: Color): this;
        lerp(color: Color, alpha: number): this;
    }

    export class Material {
        transparent: boolean;
        opacity: number;
        dispose(): void;
    }

    export class MeshStandardMaterial extends Material {
        color: Color;
        emissive: Color;
        emissiveIntensity: number;
        constructor(parameters?: Record<string, unknown>);
    }

    export class MeshPhysicalMaterial extends MeshStandardMaterial {
        constructor(parameters?: Record<string, unknown>);
    }

    export class LineBasicMaterial extends Material {
        constructor(parameters?: Record<string, unknown>);
    }

    export class BufferGeometry {
        dispose(): void;
    }

    export class BoxGeometry extends BufferGeometry {
        constructor(width?: number, height?: number, depth?: number);
    }

    export class CylinderGeometry extends BufferGeometry {
        constructor(
            radiusTop?: number,
            radiusBottom?: number,
            height?: number,
            radialSegments?: number,
            heightSegments?: number,
            openEnded?: boolean
        );
    }

    export class PlaneGeometry extends BufferGeometry {
        constructor(width?: number, height?: number);
    }

    export class EdgesGeometry extends BufferGeometry {
        constructor(geometry?: BufferGeometry, thresholdAngle?: number);
    }

    export class Object3D {
        name: string;
        position: Vector3;
        rotation: Euler;
        scale: Vector3;
        castShadow: boolean;
        receiveShadow: boolean;
        renderOrder: number;
        geometry?: BufferGeometry;
        material?: Material | Material[];
        add(...objects: Object3D[]): this;
        traverse(callback: (object: Object3D) => void): void;
    }

    export class Group extends Object3D {}

    export class Mesh<
        TGeometry extends BufferGeometry = BufferGeometry,
        TMaterial extends Material | Material[] = Material | Material[]
    > extends Object3D {
        geometry: TGeometry;
        material: TMaterial;
        constructor(geometry?: TGeometry, material?: TMaterial);
    }

    export class LineSegments<
        TGeometry extends BufferGeometry = BufferGeometry,
        TMaterial extends Material = Material
    > extends Object3D {
        geometry: TGeometry;
        material: TMaterial;
        constructor(geometry?: TGeometry, material?: TMaterial);
    }

    export class Light extends Object3D {
        color: Color;
        intensity: number;
    }

    export class PointLight extends Light {
        constructor(
            color?: ColorRepresentation,
            intensity?: number,
            distance?: number,
            decay?: number
        );
    }

    export class HemisphereLight extends Light {
        constructor(
            skyColor?: ColorRepresentation,
            groundColor?: ColorRepresentation,
            intensity?: number
        );
    }

    export interface DirectionalLightShadow {
        mapSize: Vector2;
        camera: {
            near: number;
            far: number;
            left: number;
            right: number;
            top: number;
            bottom: number;
        };
    }

    export class DirectionalLight extends Light {
        shadow: DirectionalLightShadow;
        constructor(color?: ColorRepresentation, intensity?: number);
    }

    export class Fog {
        constructor(color: ColorRepresentation, near?: number, far?: number);
    }

    export class Scene extends Group {
        background: Color | null;
        fog: Fog | null;
    }

    export class PerspectiveCamera extends Object3D {
        aspect: number;
        constructor(fov?: number, aspect?: number, near?: number, far?: number);
        lookAt(target: Vector3): void;
        updateProjectionMatrix(): void;
    }

    export class GridHelper extends Object3D {
        material: LineBasicMaterial;
        constructor(
            size?: number,
            divisions?: number,
            colorCenterLine?: ColorRepresentation,
            colorGrid?: ColorRepresentation
        );
    }

    export interface WebGLRendererParameters {
        canvas?: HTMLCanvasElement;
        antialias?: boolean;
        alpha?: boolean;
        powerPreference?: WebGLPowerPreference;
    }

    export class WebGLRenderer {
        outputColorSpace: unknown;
        toneMapping: unknown;
        toneMappingExposure: number;
        shadowMap: {
            enabled: boolean;
            type: unknown;
        };
        constructor(parameters?: WebGLRendererParameters);
        setPixelRatio(value: number): void;
        setSize(width: number, height: number, updateStyle?: boolean): void;
        render(scene: Scene, camera: PerspectiveCamera): void;
        dispose(): void;
    }

    export const MathUtils: {
        clamp(value: number, min: number, max: number): number;
    };

    export const DoubleSide: unknown;
    export const AdditiveBlending: unknown;
    export const SRGBColorSpace: unknown;
    export const ACESFilmicToneMapping: unknown;
    export const PCFSoftShadowMap: unknown;
}
