import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three/examples/jsm/controls/OrbitControls.js";
import type { AppGroup, Proc, Selection, Snapshot } from "../types";
import { matches } from "../lib/groups";
import { SombreroDisk } from "./Backdrop";
import { AgentStar, AppPlanet, Core, MusicNebula } from "./Bodies";
import { ProcessField } from "./ProcessField";
import { RegistryContext, type BodyRegistry, useRegistry } from "./shared";

export function selectionKey(s: Selection | null): string | null {
  if (!s) return null;
  switch (s.type) {
    case "agent":
      return `agent:${s.pid}`;
    case "app":
      return `app:${s.name}`;
    case "process":
      return `process:${s.pid}`;
    default:
      return s.type;
  }
}

const HOME_TARGET = new THREE.Vector3(0, 0, 0);

/** Glides the camera to follow whatever is selected, carrying the user's viewing angle along. */
function CameraRig({ focus }: { focus: string | null }) {
  const registry = useRegistry();
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const zoomTo = useRef<number | null>(null);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const delta = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    // Only dolly in when focusing something; zooming out is left to the user.
    zoomTo.current = focus && focus !== "system" ? 26 : null;
  }, [focus]);

  useFrame((_, dt) => {
    if (!controls) return;
    const obj = focus ? registry.get(focus) : null;
    if (obj) obj.getWorldPosition(goal);
    else goal.copy(HOME_TARGET);
    const k = 1 - Math.exp(-dt * 4);
    delta.copy(goal).sub(controls.target).multiplyScalar(k);
    controls.target.add(delta);
    camera.position.add(delta);
    if (zoomTo.current != null) {
      const dist = camera.position.distanceTo(controls.target);
      if (dist > zoomTo.current + 0.5) {
        const next = THREE.MathUtils.lerp(dist, zoomTo.current, k);
        camera.position.sub(controls.target).setLength(next).add(controls.target);
      } else {
        zoomTo.current = null;
      }
    }
    controls.update();
  });
  return null;
}

interface Props {
  snapshot: Snapshot;
  apps: AppGroup[];
  selection: Selection | null;
  /** What the camera follows; differs from `selection` for processes drawn inside an app or agent. */
  focus: Selection | null;
  query: string;
  onSelect: (s: Selection | null) => void;
}

export function Galaxy({ snapshot, apps, selection, focus, query, onSelect }: Props) {
  const registry = useMemo<BodyRegistry>(() => new Map(), []);
  const key = selectionKey(selection);
  const background = useMemo(
    () => snapshot.processes.filter((p) => p.kind === "background"),
    [snapshot.processes],
  );
  const isDimmed = useCallback(
    (p: Proc) => !!query && !matches(query, p.name, p.pid, p.command, ...p.ports),
    [query],
  );
  // Label the biggest apps; the rest show on hover via selection or search.
  const labelled = useMemo(() => new Set(apps.slice(0, 16).map((a) => a.name)), [apps]);

  return (
    <Canvas
      camera={{ position: [0, 16, 52], fov: 50, near: 0.1, far: 2000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      onPointerMissed={(e) => e.type === "click" && onSelect(null)}
    >
      <color attach="background" args={["#03040b"]} />
      <fog attach="fog" args={["#03040b", 110, 260]} />
      <ambientLight intensity={0.25} />
      <RegistryContext.Provider value={registry}>
        <Stars radius={320} depth={120} count={7000} factor={5} saturation={0.4} fade speed={0.4} />
        <SombreroDisk />
        <Core
          system={snapshot.system}
          selected={key === "system"}
          dim={!!query}
          onSelect={() => onSelect({ type: "system" })}
        />
        {snapshot.agents.map((a, i) => (
          <AgentStar
            key={a.pid}
            agent={a}
            index={i}
            selected={key === `agent:${a.pid}`}
            dim={!!query && !matches(query, a.kind, a.project, a.cwd, a.pid, a.session?.currentActivity)}
            onSelect={() => onSelect({ type: "agent", pid: a.pid })}
          />
        ))}
        {apps.map((app) => {
          const hit = !!query && matches(query, app.name, ...app.processes.map((p) => p.pid), ...app.ports);
          return (
            <AppPlanet
              key={app.name}
              app={app}
              showLabel={labelled.has(app.name) || hit || key === `app:${app.name}`}
              selected={key === `app:${app.name}`}
              dim={!!query && !hit}
              onSelect={() => onSelect({ type: "app", name: app.name })}
            />
          );
        })}
        <ProcessField
          processes={background}
          selectedPid={selection?.type === "process" ? selection.pid : null}
          isDimmed={isDimmed}
          onSelect={(pid) => onSelect({ type: "process", pid })}
        />
        {snapshot.music && (
          <MusicNebula
            music={snapshot.music}
            selected={key === "music"}
            dim={!!query && !matches(query, snapshot.music.title, snapshot.music.artist, "music", snapshot.music.player)}
            onSelect={() => onSelect({ type: "music" })}
          />
        )}
        <CameraRig focus={selectionKey(focus)} />
      </RegistryContext.Provider>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={4} maxDistance={180} maxPolarAngle={Math.PI * 0.92} />
      <EffectComposer>
        <Bloom mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={1.1} radius={0.75} />
      </EffectComposer>
    </Canvas>
  );
}
