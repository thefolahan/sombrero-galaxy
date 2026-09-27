import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RINGS, dotTexture } from "./shared";

function randn() {
  // Box–Muller
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

/** The decorative Sombrero: a bright bulge, a thin starry disk, and a dark dust lane at the rim. */
export function SombreroDisk() {
  const group = useRef<THREE.Group>(null);

  const { positions, colors } = useMemo(() => {
    const bulge = 6000;
    const disk = 16000;
    const lane = 4000;
    const n = bulge + disk + lane;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const c = new THREE.Color();
    let i = 0;
    const put = (x: number, y: number, z: number, col: THREE.Color) => {
      positions.set([x, y, z], i * 3);
      colors.set([col.r, col.g, col.b], i * 3);
      i++;
    };
    for (let k = 0; k < bulge; k++) {
      const b = 0.25 + Math.random() * 0.45;
      c.setRGB(1.0 * b, 0.82 * b, 0.58 * b);
      put(randn() * 7, randn() * 4, randn() * 7, c);
    }
    for (let k = 0; k < disk; k++) {
      const r = 3 + Math.pow(Math.random(), 0.8) * 55;
      const a = Math.random() * Math.PI * 2;
      const thickness = 0.5 * (1 - r / 70);
      const t = r / 58;
      const b = 0.18 + Math.random() * 0.3;
      c.setRGB((1 - t * 0.5) * b, (0.85 - t * 0.1) * b, (0.6 + t * 0.4) * b);
      put(Math.cos(a) * r, randn() * thickness, Math.sin(a) * r, c);
    }
    for (let k = 0; k < lane; k++) {
      // Reddish dust that lights the edge of the dark lane.
      const r = RINGS.dustLane[0] + Math.random() * (RINGS.dustLane[1] - RINGS.dustLane[0] + 4);
      const a = Math.random() * Math.PI * 2;
      const b = 0.12 + Math.random() * 0.2;
      c.setRGB(0.9 * b, 0.45 * b, 0.3 * b);
      put(Math.cos(a) * r, randn() * 0.35, Math.sin(a) * r, c);
    }
    return { positions, colors };
  }, []);

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.012;
  });

  return (
    <group ref={group}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.13}
          sizeAttenuation
          vertexColors
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          map={dotTexture()}
        />
      </points>
      {/* The Sombrero's dark dust lane. */}
      <mesh rotation-x={-Math.PI / 2} renderOrder={-1}>
        <ringGeometry args={[RINGS.dustLane[0], RINGS.dustLane[1], 160]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.72} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Faint guide rings between the zones. */}
      {[RINGS.agents[1] + 1.5, RINGS.apps[1] + 1.5].map((r) => (
        <mesh key={r} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[r - 0.03, r + 0.03, 200]} />
          <meshBasicMaterial color="#8fa8ff" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
