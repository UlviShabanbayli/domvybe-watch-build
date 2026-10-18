// DV65 · the material library. Colours are linear (setRGB) unless noted. Every physical feature a material uses is set
// at construction so nothing recompiles later.
import * as THREE from 'three';
import { patch } from './patches.js';
import { makeSaffiano, makeSunrayNoise, makeDialPrint } from './textures.js';

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
const P = (o) => new THREE.MeshPhysicalMaterial(o);

export const COLORS = {
  rose: lin(0.93, 0.70, 0.55),      // 18k rose gold, pale (the board's champagne-rose)
  roseDeep: lin(0.90, 0.62, 0.46),
  steel: lin(0.66, 0.66, 0.65),
  rhodium: lin(0.66, 0.67, 0.68),
  plate: lin(0.24, 0.245, 0.26),
  blued: lin(0.05, 0.11, 0.38),
  ruby: lin(0.42, 0.006, 0.03),
  dial: lin(0.045, 0.16, 0.52),
  leather: lin(0.03, 0.027, 0.025),
};

export function createMaterials({ dialFont = 'Lato' } = {}) {
  const C = COLORS;
  const saffiano = makeSaffiano();
  const sunray = makeSunrayNoise();
  const print = makeDialPrint(16.4, { family: dialFont });

  const m = {
    rosePolished: patch(P({ color: C.rose, metalness: 1, roughness: 0.11 }), 'surface'),
    roseHand: patch(P({ color: C.rose, metalness: 1, roughness: 0.16 }), 'surface'),
    roseSatin: patch(P({ color: C.rose, metalness: 1, roughness: 0.2, anisotropy: 0.6 }), 'tangential'),
    roseWheel: patch(P({ color: C.roseDeep, metalness: 1, roughness: 0.2, anisotropy: 0.85 }), 'tangential'),
    roseCotes: patch(P({ color: C.rose, metalness: 1, roughness: 0.17, anisotropy: 0.35, envMapIntensity: 0.9 }), 'cotes'),
    steelPolished: patch(P({ color: C.steel, metalness: 1, roughness: 0.075 }), 'surface'),
    steelBrushed: patch(P({ color: C.steel, metalness: 1, roughness: 0.26, anisotropy: 0.7 }), 'tangential'),
    steelSoleil: patch(P({ color: C.steel, metalness: 1, roughness: 0.2, anisotropy: 0.9 }), 'radial'),
    rhodiumCotes: patch(P({ color: C.rhodium, metalness: 1, roughness: 0.28, anisotropy: 0.8 }), 'cotes'),
    rhodiumAnglage: patch(P({ color: C.rhodium, metalness: 1, roughness: 0.09 }), 'surface'),
    plate: patch(P({ color: C.plate, metalness: 1, roughness: 0.36, anisotropy: 0.4 }), 'perlage'),
    blued: patch(P({ color: C.blued, metalness: 1, roughness: 0.1, iridescence: 0.6, iridescenceIOR: 2.0, iridescenceThicknessRange: [240, 300] }), 'surface'),
    ruby: patch(P({ color: C.ruby, metalness: 0, roughness: 0.04, ior: 1.76, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0.5, sheenColor: lin(0.9, 0.05, 0.12), sheenRoughness: 0.3 }), 'surface'),
    dial: patch(P({ color: C.dial, metalness: 0.6, roughness: 0.3, anisotropy: 0.95, clearcoat: 0.4, clearcoatRoughness: 0.05 }), 'sunray'),
    dialEdge: patch(P({ color: lin(0.01, 0.03, 0.09), metalness: 0.5, roughness: 0.35 }), 'surface'),
    print: patch(P({ color: lin(0.86, 0.86, 0.87), map: print, transparent: true, metalness: 0.35, roughness: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'surface'),
    crystal: patch(P({
      color: lin(0, 0, 0), metalness: 0, roughness: 0.02, ior: 1.77, specularIntensity: 0.6, specularColor: lin(0.75, 0.78, 1.0),
      iridescence: 0.35, iridescenceIOR: 1.38, iridescenceThicknessRange: [260, 340],
      transparent: true, opacity: 0.05, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    }), 'glass'),
    leather: patch(P({
      color: C.leather, metalness: 0, roughness: 0.72, normalMap: saffiano, normalScale: new THREE.Vector2(2.2, 2.2),
      sheen: 0.35, sheenRoughness: 0.5, sheenColor: lin(0.2, 0.18, 0.16),
    }), 'surface'),
    leatherEdge: patch(P({ color: lin(0.035, 0.03, 0.027), metalness: 0, roughness: 0.34 }), 'surface'),
    black: patch(P({ color: lin(0.005, 0.005, 0.006), metalness: 0, roughness: 0.6 }), 'surface'),
  };
  m.dial.userData.u.uSunrayNoise.value = sunray;
  m.crystal.userData.u.uGrazing.value = 1.0;
  m.crystal.userData.u.uEnvGain.value = 1.15;
  // leather UVs are authored in mm; one saffiano tile ≈ 15 mm (hatch pitch ≈ 0.33 mm)
  saffiano.repeat.set(1 / 15, 1 / 15);
  for (const [k, v] of Object.entries(m)) v.name = k;
  return { m, textures: { saffiano, sunray, print } };
}
