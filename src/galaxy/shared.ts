import * as THREE from "three";
import { createContext, useContext } from "react";
import type { AgentStatus } from "../types";

/** Soft round dot used by every point cloud. */
let spriteTexture: THREE.Texture | null = null;
export function dotTexture(): THREE.Texture {
  if (spriteTexture) return spriteTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.8)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  spriteTexture = new THREE.CanvasTexture(canvas);
  return spriteTexture;
}

export const STATUS_COLOR: Record<AgentStatus, string> = {
  working: "#4ef2c8",
  waiting: "#ffb547",
  idle: "#6f86ff",
  unknown: "#b48cff",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: "Working",
  waiting: "Needs you",
  idle: "Idle",
  unknown: "Running",
};

/** Orbit radii for each ring of the galaxy. */
export const RINGS = {
  agents: [5.5, 9.5],
  apps: [13, 29],
  processes: [32, 46],
  dustLane: [47, 53],
} as const;

export function orbit(radius: number, phase: number, speed: number, tilt: number, t: number, out: THREE.Vector3) {
  const a = phase + t * speed;
  return out.set(Math.cos(a) * radius, Math.sin(a * 2 + phase) * tilt, Math.sin(a) * radius);
}

/**
 * Lets the camera find the live position of whatever is selected: each body registers
 * its group under the same key the selection uses.
 */
export type BodyRegistry = Map<string, THREE.Object3D>;
export const RegistryContext = createContext<BodyRegistry>(new Map());
export const useRegistry = () => useContext(RegistryContext);

export function useRegister(key: string) {
  const registry = useRegistry();
  return (obj: THREE.Object3D | null) => {
    if (obj) registry.set(key, obj);
    else registry.delete(key);
  };
}
