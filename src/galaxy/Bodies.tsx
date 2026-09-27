import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Agent, AppGroup, NowPlaying, SystemStats } from "../types";
import { AI_APPS, hash, rand } from "../lib/groups";
import { formatClock, formatCpu } from "../lib/format";
import { RINGS, STATUS_COLOR, STATUS_LABEL, dotTexture, orbit, useRegister } from "./shared";

const MB = 1024 * 1024;

interface Pickable {
  selected: boolean;
  dim: boolean;
  onSelect: () => void;
}

function stop(fn: () => void) {
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    fn();
  };
}

function SelectionRing({ radius }: { radius: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => ref.current?.quaternion.copy(camera.quaternion));
  return (
    <mesh ref={ref}>
      <ringGeometry args={[radius, radius + 0.08, 64]} />
      <meshBasicMaterial color={[2, 2, 2]} toneMapped={false} transparent opacity={0.9} />
    </mesh>
  );
}

/** A screen-space label that stays readable at any zoom. Kept mounted and hidden via CSS to avoid churn. */
function Label({ children, offset, visible = true, small = false }: { children: React.ReactNode; offset: number; visible?: boolean; small?: boolean }) {
  return (
    <Html position={[0, offset, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none", transform: "translateY(-50%)" }}>
      <div className={`label ${small ? "small-label" : ""}`} hidden={!visible}>{children}</div>
    </Html>
  );
}

/** The Mac itself: a core whose glow tracks total CPU. */
export function Core({ system, ...pick }: { system: SystemStats } & Pickable) {
  const mesh = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Sprite>(null);
  const load = Math.min(system.cpuUsage / 100, 1);
  useFrame(({ clock }) => {
    const pulse = 1 + Math.sin(clock.elapsedTime * (1 + load * 5)) * (0.03 + load * 0.08);
    mesh.current?.scale.setScalar(pulse);
    halo.current?.scale.setScalar(9 + load * 8 + pulse * 2);
  });
  return (
    <group ref={useRegister("system")}>
      <mesh ref={mesh} onClick={stop(pick.onSelect)}>
        <sphereGeometry args={[1.5, 48, 48]} />
        <meshBasicMaterial color={[2.4, 1.9, 1.3]} toneMapped={false} />
      </mesh>
      <sprite ref={halo}>
        <spriteMaterial map={dotTexture()} color={new THREE.Color(1, 0.75, 0.45)} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <pointLight intensity={400} distance={120} decay={1.6} color="#ffe2b8" />
      {pick.selected && <SelectionRing radius={2.4} />}
      <Label offset={2.2}>
        <b>{system.hostName}</b>
        <span>CPU {formatCpu(system.cpuUsage)}</span>
      </Label>
    </group>
  );
}

/** An AI agent: a bright star orbiting close to the core, with sparks for its running tasks. */
export function AgentStar({ agent, index, ...pick }: { agent: Agent; index: number } & Pickable) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Sprite>(null);
  const sparks = useRef<THREE.Group>(null);
  const key = `agent:${agent.pid}`;
  const register = useRegister(key);
  const color = STATUS_COLOR[agent.status];
  const bright = useMemo(() => new THREE.Color(color).multiplyScalar(2.2), [color]);
  const [rMin, rMax] = RINGS.agents;
  const radius = rMin + ((index * 0.37 + rand(key)) % 1) * (rMax - rMin);
  const phase = rand(key, 1) * Math.PI * 2;
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (group.current) orbit(radius, phase, 0.1, 0.4, t, group.current.position);
    if (body.current) {
      // A waiting agent hops up and down to get your attention.
      body.current.position.y = agent.status === "waiting" ? Math.abs(Math.sin(t * 4)) * 0.8 : 0;
    }
    if (halo.current) {
      const speed = agent.status === "working" ? 5 : agent.status === "waiting" ? 3 : 1;
      halo.current.scale.setScalar(3.4 + Math.sin(t * speed) * 0.6);
    }
    sparks.current?.children.forEach((c, i, all) => {
      c.position.copy(orbit(1.3, (i / all.length) * Math.PI * 2, 2.2, 0.3, t, v));
    });
  });

  const taskCount = Math.min(agent.taskPids.length, 8);
  const activity = agent.session?.currentActivity;
  return (
    <group ref={(g) => { group.current = g; register(g); }}>
      <group ref={body}>
        <mesh onClick={stop(pick.onSelect)} scale={pick.dim ? 0.5 : 1}>
          <icosahedronGeometry args={[0.6, 3]} />
          <meshBasicMaterial color={bright} toneMapped={false} />
        </mesh>
        <sprite ref={halo}>
          <spriteMaterial map={dotTexture()} color={color} transparent opacity={pick.dim ? 0.15 : 0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
        <group ref={sparks}>
          {Array.from({ length: taskCount }, (_, i) => (
            <mesh key={i}>
              <sphereGeometry args={[0.1, 8, 8]} />
              <meshBasicMaterial color={[2.5, 2.5, 2.5]} toneMapped={false} />
            </mesh>
          ))}
        </group>
        {pick.selected && <SelectionRing radius={1.1} />}
        <Label offset={1.1} visible={!pick.dim}>
          <span className="label-status" style={{ color }}>● {STATUS_LABEL[agent.status]}</span>
          <b>{agent.kind}</b>
          {agent.project && <span>{agent.project}</span>}
          {activity && <em>{activity}</em>}
        </Label>
      </group>
    </group>
  );
}

/** A running app: a lit planet whose moons are its helper processes. */
export function AppPlanet({ app, showLabel, ...pick }: { app: AppGroup; showLabel: boolean } & Pickable) {
  const group = useRef<THREE.Group>(null);
  const planet = useRef<THREE.Mesh>(null);
  const moons = useRef<THREE.Group>(null);
  const key = `app:${app.name}`;
  const register = useRegister(key);
  const [rMin, rMax] = RINGS.apps;
  const radius = rMin + rand(key) * (rMax - rMin);
  const phase = rand(key, 1) * Math.PI * 2;
  const size = THREE.MathUtils.clamp(0.35 + Math.log10(Math.max(app.memory / MB, 1)) * 0.3, 0.4, 1.6);
  const load = Math.min(app.cpu / 60, 1);
  const hue = (hash(app.name) % 360) / 360;
  const color = useMemo(() => new THREE.Color().setHSL(hue, 0.55, 0.55), [hue]);
  const emissive = useMemo(() => new THREE.Color().setHSL(hue, 0.9, 0.55), [hue]);
  const isAI = AI_APPS.has(app.name);
  const moonCount = Math.min(app.processes.length - 1, 10);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (group.current) orbit(radius, phase, 0.9 / radius, 0.8, t, group.current.position);
    if (planet.current) planet.current.rotation.y += dt * (0.2 + load * 3);
    moons.current?.children.forEach((m, i) => {
      const r = size * 1.7 + (i % 3) * 0.35;
      m.position.copy(orbit(r, i * 2.4, (0.6 + load * 2.5) * (i % 2 ? 1 : -0.8), size * 0.5, t, v));
    });
  });

  return (
    <group ref={(g) => { group.current = g; register(g); }}>
      <mesh ref={planet} onClick={stop(pick.onSelect)}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={0.12 + load * 1.6}
          roughness={0.7}
          transparent={pick.dim}
          opacity={pick.dim ? 0.15 : 1}
        />
      </mesh>
      {isAI && (
        <mesh rotation-x={Math.PI / 2.4}>
          <torusGeometry args={[size * 1.45, 0.04, 8, 64]} />
          <meshBasicMaterial color={[0.6, 2, 1.6]} toneMapped={false} transparent opacity={pick.dim ? 0.1 : 0.8} />
        </mesh>
      )}
      {app.ports.length > 0 && (
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[size * 1.25, 0.025, 6, 48]} />
          <meshBasicMaterial color={[0.4, 1.4, 2.4]} toneMapped={false} />
        </mesh>
      )}
      <group ref={moons}>
        {Array.from({ length: moonCount }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.07 + (i % 3) * 0.03, 8, 8]} />
            <meshStandardMaterial color="#c9d2ff" emissive="#8093ff" emissiveIntensity={0.3} transparent={pick.dim} opacity={pick.dim ? 0.15 : 1} />
          </mesh>
        ))}
      </group>
      {pick.selected && <SelectionRing radius={size * 2.2} />}
      <Label offset={size + 0.4} visible={showLabel && !pick.dim} small>
        <b>{app.name}</b>
        <span>{formatCpu(app.cpu)}{app.ports.length > 0 && ` · :${app.ports[0]}`}</span>
      </Label>
    </group>
  );
}

/** Now playing: a swirling nebula that breathes with the music. */
export function MusicNebula({ music, ...pick }: { music: NowPlaying } & Pickable) {
  const group = useRef<THREE.Group>(null);
  const cloud = useRef<THREE.Points>(null);
  const register = useRegister("music");
  const { positions, colors } = useMemo(() => {
    const n = 2200;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const arm = i % 3;
      const r = Math.pow(Math.random(), 0.6) * 5;
      const a = r * 0.9 + (arm / 3) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      positions.set([Math.cos(a) * r, (Math.random() - 0.5) * 1.2 * (1 - r / 6), Math.sin(a) * r], i * 3);
      c.setHSL(0.78 + arm * 0.08 + r * 0.02, 0.9, 0.35 + Math.random() * 0.25);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    return { positions, colors };
  }, []);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (cloud.current) {
      cloud.current.rotation.y += dt * (music.playing ? 0.5 : 0.05);
      // ~120 bpm pulse while playing.
      const beat = music.playing ? Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 8) * 0.12 : 0;
      cloud.current.scale.setScalar(1 + beat);
    }
    if (group.current) group.current.position.y = 13 + Math.sin(t * 0.4) * 0.6;
  });

  const progress = music.durationSecs > 0 ? Math.min(music.positionSecs / music.durationSecs, 1) : 0;
  return (
    <group ref={(g) => { group.current = g; register(g); }} position={[-30, 13, -22]} rotation={[0.5, 0, 0.3]}>
      <points ref={cloud} onClick={stop(pick.onSelect)}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.35} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} map={dotTexture()} opacity={pick.dim ? 0.2 : 1} />
      </points>
      {pick.selected && <SelectionRing radius={6} />}
      <Html position={[0, -3.2, 0]} center zIndexRange={[20, 0]}>
        <div
          className="label music-label"
          onClick={(e) => {
            // Don't let the canvas see this click and treat it as a click on empty space.
            e.stopPropagation();
            pick.onSelect();
          }}
        >
          <span className="label-status" style={{ color: "#e08bff" }}>{music.playing ? "♪ Now playing" : "❚❚ Paused"} · {music.player}</span>
          <b>{music.title}</b>
          <span>{music.artist}</span>
          <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>
          <span className="mono">{formatClock(music.positionSecs)} / {formatClock(music.durationSecs)}</span>
        </div>
      </Html>
    </group>
  );
}
