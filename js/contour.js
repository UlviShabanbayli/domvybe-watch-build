// DV65 · marching squares on a signed-distance function → THREE.Shape (outer loop + holes).
// Used for the bridges and the rotor, which are unions / differences of capsules and discs.
import * as THREE from 'three';

export function sdfShape(sdf, [x0, y0, x1, y1], step = 0.06, simplify = 0.035) {
  const nx = Math.ceil((x1 - x0) / step) + 1, ny = Math.ceil((y1 - y0) / step) + 1;
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = sdf(x0 + i * step, y0 + j * step);
  // edge key → interpolated point; segments link edge keys
  const pt = new Map();
  const edgePoint = (i, j, dir) => {               // dir 0: horizontal edge (i,j)-(i+1,j); 1: vertical (i,j)-(i,j+1)
    const key = (j * nx + i) * 2 + dir;
    if (!pt.has(key)) {
      const a = v[j * nx + i], b = dir ? v[(j + 1) * nx + i] : v[j * nx + i + 1];
      const t = a / (a - b);
      pt.set(key, dir ? [x0 + i * step, y0 + (j + t) * step] : [x0 + (i + t) * step, y0 + j * step]);
    }
    return key;
  };
  const next = new Map();                            // directed segments a → b with the inside on the left
  const seg = (a, b) => next.set(a, b);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = v[j * nx + i] < 0, b = v[j * nx + i + 1] < 0, c = v[(j + 1) * nx + i + 1] < 0, d = v[(j + 1) * nx + i] < 0;
    const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const B = () => edgePoint(i, j, 0), R = () => edgePoint(i + 1, j, 1), T = () => edgePoint(i, j + 1, 0), L = () => edgePoint(i, j, 1);
    // orientation: walk with the inside (negative) on the right → clockwise outer loops, counter-clockwise holes
    switch (code) {
      case 1: seg(L(), B()); break;
      case 2: seg(B(), R()); break;
      case 3: seg(L(), R()); break;
      case 4: seg(R(), T()); break;
      case 5: seg(L(), T()); seg(R(), B()); break;
      case 6: seg(B(), T()); break;
      case 7: seg(L(), T()); break;
      case 8: seg(T(), L()); break;
      case 9: seg(T(), B()); break;
      case 10: seg(T(), R()); seg(B(), L()); break;
      case 11: seg(T(), R()); break;
      case 12: seg(R(), L()); break;
      case 13: seg(R(), B()); break;
      case 14: seg(B(), L()); break;
    }
  }
  // link into loops
  const loops = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = []; let k = start;
    while (k !== undefined && !used.has(k)) { used.add(k); loop.push(pt.get(k)); k = next.get(k); }
    if (loop.length > 8) loops.push(decimate(loop, simplify));
  }
  const area = (l) => { let s = 0; // the table walks with the inside on the RIGHT → outer loops are clockwise; flip the sign
    for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; s += p[0] * q[1] - q[0] * p[1]; } return -s / 2; };
  const outers = loops.filter((l) => area(l) > 0).sort((a, b) => area(b) - area(a));
  const holes = loops.filter((l) => area(l) < 0);
  const toV = (l) => l.map(([x, y]) => new THREE.Vector2(x, y));
  return outers.map((o) => {
    const s = new THREE.Shape(toV(o));
    for (const h of holes) if (inside(h[0], o)) s.holes.push(new THREE.Path(toV(h)));
    return s;
  });
}

function decimate(loop, tol) {
  const out = [loop[0]];
  for (let i = 1; i < loop.length; i++) {
    const p = out[out.length - 1], q = loop[i];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) >= tol) out.push(q);
  }
  return out;
}

function inside([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// SDF primitives (2-D)
export const sd = {
  circle: (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r,
  capsule: (a, b, r) => (x, y) => {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t) - r;
  },
  path: (pts, r) => { const caps = []; for (let i = 0; i < pts.length - 1; i++) caps.push(sd.capsule(pts[i], pts[i + 1], r)); return (x, y) => Math.min(...caps.map((f) => f(x, y))); },
  union: (...fs) => (x, y) => Math.min(...fs.map((f) => f(x, y))),
  smoothUnion: (k, ...fs) => (x, y) => { let d = fs[0](x, y); for (let i = 1; i < fs.length; i++) { const e = fs[i](x, y); const h = Math.max(k - Math.abs(d - e), 0) / k; d = Math.min(d, e) - h * h * k / 4; } return d; },
  sub: (a, b) => (x, y) => Math.max(a(x, y), -b(x, y)),
  intersect: (a, b) => (x, y) => Math.max(a(x, y), b(x, y)),
  ring: (cx, cy, r0, r1) => (x, y) => { const d = Math.hypot(x - cx, y - cy); return Math.max(r0 - d, d - r1); },
};
