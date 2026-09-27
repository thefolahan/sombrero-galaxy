import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Proc } from "../types";
import { rand } from "../lib/groups";
import { formatBytes, formatCpu } from "../lib/format";
import { RINGS, orbit, useRegistry } from "./shared";

const MB = 1024 * 1024;

interface Props {
  processes: Proc[];
  selectedPid: number | null;
  isDimmed: (p: Proc) => boolean;
  onSelect: (pid: number) => void;
}

interface Orbit {
  radius: number;
  phase: number;
  speed: number;
  tilt: number;
  size: number;
}

/**
 * Every background process as a grain of dust in the outer disk, drawn as one instanced
 * mesh. Size follows memory; hot processes glow orange, ones serving ports glow cyan.
 */
export function ProcessField({ processes, selectedPid, isDimmed, onSelect }: Props) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const tooltip = useRef<THREE.Group>(null);
  const selectedAnchor = useRef<THREE.Group>(null);
  const registry = useRegistry();
  // Capacity grows in steps so the mesh isn't rebuilt every time a process starts.
  const capacity = Math.ceil(Math.max(processes.length, 1) / 256) * 256;

  const orbits = useMemo<Orbit[]>(
    () =>
      processes.map((p) => {
        const key = `${p.pid}:${p.name}`;
        const [rMin, rMax] = RINGS.processes;
        const radius = rMin + rand(key) * (rMax - rMin);
        return {
          radius,
          phase: rand(key, 1) * Math.PI * 2,
          speed: (0.6 + rand(key, 2) * 0.4) / radius,
          tilt: (rand(key, 3) - 0.5) * 2.4,
          size: THREE.MathUtils.clamp(0.05 + Math.log10(Math.max(p.memory / MB, 1)) * 0.06, 0.05, 0.26),
        };
      }),
    [processes],
  );

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    processes.forEach((p, i) => {
      if (p.pid === selectedPid) c.setRGB(2.5, 2.5, 2.5);
      else if (p.ports.length) c.setRGB(0.4, 1.5, 2.6);
      else if (p.cpu > 1) {
        const heat = Math.min(p.cpu / 40, 1);
        c.setRGB(1.2 + heat * 1.8, 0.55 + heat * 0.9, 0.25 + heat * 0.3);
      } else c.setRGB(0.3, 0.36, 0.58);
      if (isDimmed(p)) c.multiplyScalar(0.12);
      m.setColorAt(i, c);
    });
    m.count = processes.length;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [processes, selectedPid, isDimmed, capacity]);

  // Let the camera rig follow a selected dust grain.
  useEffect(() => {
    if (selectedPid == null || !selectedAnchor.current) return;
    const key = `process:${selectedPid}`;
    registry.set(key, selectedAnchor.current);
    return () => void registry.delete(key);
  }, [selectedPid, registry]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    orbits.forEach((o, i) => {
      orbit(o.radius, o.phase, o.speed, o.tilt, t, dummy.position);
      const p = processes[i];
      const pulse = p.cpu > 5 ? 1 + Math.sin(t * 6 + o.phase) * 0.15 : 1;
      dummy.scale.setScalar(o.size * pulse * (i === hovered ? 1.8 : 1));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      if (i === hovered) tooltip.current?.position.copy(dummy.position);
      if (p.pid === selectedPid) selectedAnchor.current?.position.copy(dummy.position);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  });

  const hoveredProc = hovered != null ? processes[hovered] : null;
  return (
    <>
      <instancedMesh
        key={capacity}
        ref={mesh}
        args={[undefined, undefined, capacity]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (e.instanceId !== undefined && e.instanceId !== hovered) setHovered(e.instanceId);
        }}
        onPointerOut={() => setHovered(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.instanceId !== undefined && processes[e.instanceId]) onSelect(processes[e.instanceId].pid);
        }}
      >
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <group ref={selectedAnchor} />
      <group ref={tooltip}>
        {hoveredProc && (
          <Html center position={[0, 0.6, 0]} style={{ pointerEvents: "none", transform: "translateY(-50%)" }}>
            <div className="label">
              <b>{hoveredProc.name}</b>
              <span>
                pid {hoveredProc.pid} · {formatCpu(hoveredProc.cpu)} · {formatBytes(hoveredProc.memory)}
                {hoveredProc.ports.length > 0 && ` · :${hoveredProc.ports.join(", :")}`}
              </span>
            </div>
          </Html>
        )}
      </group>
    </>
  );
}
