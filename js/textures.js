// DV65 · procedural textures (made at load, nothing downloaded):
//   saffiano  cross-hatched leather relief → tangent-space normal map (strap)
//   sunray    1-D groove relief for the dial (2048 × 1, mipmapped)
//   dialPrint the printed dial: minute track, wordmark, small lines (transparent canvas, 2048²)
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Height field → normal map (RGBA8, tangent space, OpenGL convention). */
function heightToNormal(h, n, strength) {
  const out = new Uint8Array(n * n * 4);
  const at = (x, y) => h[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * n + x) * 4;
    out[i] = (-dx / l * 0.5 + 0.5) * 255; out[i + 1] = (-dy / l * 0.5 + 0.5) * 255; out[i + 2] = (1 / l * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}

export function makeSaffiano(n = 512) {
  // Saffiano: a fine diagonal cross-hatch pressed into the grain, irregular in depth, plus small pores.
  const r = rng(65);
  const h = new Float32Array(n * n);
  const lines = 46;                                     // hatch lines per tile, each direction
  const phaseA = Array.from({ length: lines }, () => r() * 0.25), phaseB = Array.from({ length: lines }, () => r() * 0.25);
  const depthA = Array.from({ length: lines }, () => 0.55 + r() * 0.45), depthB = Array.from({ length: lines }, () => 0.55 + r() * 0.45);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n;
    const a = (u + v) * lines, b = (u - v + 1) * lines;
    const ia = Math.floor(a) % lines, ib = Math.floor(b) % lines;
    const fa = a - Math.floor(a) - phaseA[ia], fb = b - Math.floor(b) - phaseB[ib];
    const ga = Math.exp(-((fa - 0.5) ** 2) / 0.012) * depthA[ia];
    const gb = Math.exp(-((fb - 0.5) ** 2) / 0.012) * depthB[ib];
    h[y * n + x] = -Math.max(ga, gb) * 0.9;
  }
  for (let k = 0; k < 2600; k++) {                     // pores
    const cx = r() * n, cy = r() * n, rad = 1 + r() * 1.8, d = 0.3 + r() * 0.5;
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const q = Math.hypot(x - cx, y - cy) / rad; if (q > 1) continue;
      const i = ((y + n) % n) * n + ((x + n) % n); h[i] -= d * (1 - q * q);
    }
  }
  // soften once (3×3 box)
  const s = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let acc = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) acc += h[((y + j + n) % n) * n + ((x + i + n) % n)];
    s[y * n + x] = acc / 9;
  }
  const t = new THREE.DataTexture(heightToNormal(s, n, 3.2), n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

export function makeSunrayNoise(n = 2048) {
  const r = rng(7), d = new Uint8Array(n * 4);
  let v = 0.5;
  for (let i = 0; i < n; i++) { v = v * 0.35 + r() * 0.65; const b = Math.round(v * 255); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(d, n, 1, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

/** The dial print. R = dial radius in mm (the canvas spans the dial's diameter). */
export function makeDialPrint(R, { size = 2048, family = 'Lato' } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const k = size / 2 / R;                               // px per mm
  g.translate(size / 2, size / 2);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  // minute track: fine ticks between r 15.55 and 16.05, longer and bolder at the fives (where no applied index sits)
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * Math.PI * 2, five = i % 5 === 0;
    if (five) continue;
    const r0 = 15.62 * k, r1 = 16.02 * k;
    g.save(); g.rotate(a); g.fillRect(-0.055 * k, -r1, 0.11 * k, r1 - r0); g.restore();
  }
  // two hairline circles framing the track
  g.lineWidth = 0.05 * k;
  g.beginPath(); g.arc(0, 0, 16.08 * k, 0, Math.PI * 2); g.stroke();
  // wordmark
  const text = (str, y, mm, weight, track) => {
    g.font = `${weight} ${mm * k}px ${family}, 'Helvetica Neue', Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if ('letterSpacing' in g) { g.letterSpacing = `${track * mm * k}px`; g.fillText(str, track * mm * k / 2, -y * k); g.letterSpacing = '0px'; }
    else g.fillText(str, 0, -y * k);
  };
  text('ATELIER H', 6.1, 1.55, 400, 0.16);
  text('HAUTE HORLOGERIE', 4.35, 0.52, 700, 0.22);
  text('AUTOMATIQUE', -6.4, 0.6, 700, 0.24);
  text('CALIBRE AH-01', -7.45, 0.42, 400, 0.22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
