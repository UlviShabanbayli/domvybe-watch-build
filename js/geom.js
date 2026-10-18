// DV65 · geometry helpers. Units are millimetres; the watch axis is +z (dial up), 12 o'clock is +y, 3 o'clock is +x.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;

/** Keep only position / normal / uv, non-indexed, so anything can be merged with anything. */
export function clean(g) {
  let out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  if (!out.attributes.normal) out.computeVertexNormals();
  out.clearGroups();
  return out;
}

/** Split a multi-group geometry (Extrude: 0 caps, 1 sides) into one clean geometry per group index. */
export function splitGroups(g) {
  const src = g.index ? g.toNonIndexed() : g;
  const res = [];
  const groups = g.groups.length ? g.groups : [{ start: 0, count: src.attributes.position.count, materialIndex: 0 }];
  // after toNonIndexed the group ranges index vertices directly
  for (const gr of groups) {
    const mi = gr.materialIndex;
    const part = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) {
      const a = src.attributes[k]; if (!a) continue;
      part.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
    }
    res[mi] = res[mi] ? mergeGeometries([res[mi], clean(part)]) : clean(part);
  }
  return res;
}

/** Revolve a [r, z] profile round +z. crease: angle in radians above which normals split. */
export function lathe(profile, segments = 128, crease = 0.6, phiStart = 0, phiLength = TAU) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 0), z));
  let g = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  g.rotateX(Math.PI / 2);                               // lathe height (y) → z
  g = toCreasedNormals(g, crease);
  return clean(g);
}

/** Sample a smooth arc of [r,z] points (for domed / rounded profiles). */
export function arcPts(cr, cz, rad, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cr + Math.cos(a) * rad, cz + Math.sin(a) * rad]); }
  return out;
}

export function extrude(shape, depth, { bevel = 0.03, bevelSeg = 1, curveSeg = 24 } = {}) {
  return new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: bevelSeg, curveSegments: curveSeg,
  });
}

/** Circle path (counter-clockwise) as points. */
export function circlePts(cx, cy, r, n = 48, a0 = 0) {
  const p = []; for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU; p.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); } return p;
}

/**
 * A watch wheel: ogival teeth, a rim, curved spokes, a hub.
 * r: pitch radius; teeth; add/ded: addendum/dedendum (mm); spokes: count (0 = solid); rim: rim width; hub: hub radius; twist: spoke sweep (rad)
 */
export function wheelShape({ r, teeth, add = 0.16, ded = 0.2, spokes = 5, rim = 0.55, hub = 0.9, twist = 0.35, toothFill = 0.46, club = false, hole = 0 }) {
  const pts = [];
  const pitch = TAU / teeth, rr = r - ded, rt = r + add;
  for (let k = 0; k < teeth; k++) {
    const c = k * pitch, tw = pitch * toothFill;
    if (club) {
      // escape wheel: a long, raked tooth with a club (impulse face) at its tip
      pts.push(polar(rr, c - pitch * 0.5));
      pts.push(polar(rr, c - tw * 0.2));
      pts.push(polar(rt - 0.05, c + pitch * 0.06));
      pts.push(polar(rt, c + pitch * 0.2));
      pts.push(polar(rt - 0.22, c + pitch * 0.26));
      pts.push(polar(rr + 0.25, c + pitch * 0.12));
      pts.push(polar(rr, c + pitch * 0.18));
      continue;
    }
    // root arc
    for (let i = 0; i <= 2; i++) pts.push(polar(rr, c - pitch / 2 + (pitch - tw) / 2 * i / 2));
    // flank + ogival tip (5 samples: sub-pixel beyond that at any framing we use)
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const phi = -Math.PI / 2 + Math.PI * i / n;
      const rad = r + add * Math.cos(phi);
      const ang = c + tw / 2 * Math.sin(phi) * (1 - 0.18 * Math.cos(phi));
      if (i === 0) pts.push(polar(r - ded * 0.4, c - tw / 2));
      pts.push(polar(rad, ang));
      if (i === n) pts.push(polar(r - ded * 0.4, c + tw / 2));
    }
  }
  const shape = new THREE.Shape(pts);
  if (spokes > 0) {
    const ri = rr - rim, rh = hub, w = Math.max(0.28, r * 0.08);
    for (let s = 0; s < spokes; s++) {
      const th0 = s / spokes * TAU, th1 = (s + 1) / spokes * TAU;
      const hp = [];
      const N = 6;
      const sweep = (rho) => twist * (rho - rh) / (ri - rh);
      // edge of spoke s (leading side), hub → rim
      for (let i = 0; i <= N; i++) { const rho = rh + (ri - rh) * i / N; hp.push(polar(rho, th0 + sweep(rho) + Math.asin(Math.min(0.95, w / 2 / rho)))); }
      // rim arc
      const a0 = th0 + sweep(ri) + Math.asin(w / 2 / ri), a1 = th1 + sweep(ri) - Math.asin(w / 2 / ri);
      for (let i = 1; i < 9; i++) hp.push(polar(ri, a0 + (a1 - a0) * i / 9));
      // trailing side of spoke s+1, rim → hub
      for (let i = N; i >= 0; i--) { const rho = rh + (ri - rh) * i / N; hp.push(polar(rho, th1 + sweep(rho) - Math.asin(Math.min(0.95, w / 2 / rho)))); }
      // hub arc back
      const b0 = th1 - Math.asin(Math.min(0.95, w / 2 / rh)), b1 = th0 + Math.asin(Math.min(0.95, w / 2 / rh));
      for (let i = 1; i < 6; i++) hp.push(polar(rh, b0 + (b1 - b0) * i / 6));
      shape.holes.push(new THREE.Path(roundPoly(hp, 0.5, 1)));
    }
  }
  if (hole > 0) shape.holes.push(new THREE.Path(circlePts(0, 0, hole, 24)));
  return shape;
}

/** Pinion leaves (a small gear with few, deep, rounded leaves). */
export function pinionShape(r, leaves) {
  const pts = [], pitch = TAU / leaves, rr = r * 0.62;
  for (let k = 0; k < leaves; k++) {
    const c = k * pitch;
    for (let i = 0; i <= 8; i++) {
      const phi = -Math.PI / 2 + Math.PI * i / 8;
      pts.push(polar(rr + (r - rr) * Math.cos(phi) ** 0.8, c + pitch * 0.24 * Math.sin(phi)));
    }
    pts.push(polar(rr * 0.98, c + pitch * 0.5));
  }
  return new THREE.Shape(pts);
}

export function polar(r, a) { return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r); }

/** Chaikin corner rounding on a closed polygon. */
export function roundPoly(p, amt = 0.25, iter = 2) {
  let pts = p;
  for (let it = 0; it < iter; it++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push(new THREE.Vector2().lerpVectors(a, b, amt * 0.5), new THREE.Vector2().lerpVectors(a, b, 1 - amt * 0.5));
    }
    pts = out;
  }
  return pts;
}

/** A bridge outline: a thick stroke along a polyline with round ends and round lobes at the given pivots. */
export function bridgeShape(path, width, lobes = []) {
  // sample the union of capsules + lobes on a fine angular raster around a centre: simple marching on an SDF
  const sdf = (x, y) => {
    let d = 1e9;
    for (let i = 0; i < path.length - 1; i++) d = Math.min(d, segDist(x, y, path[i], path[i + 1]) - width / 2);
    for (const [lx, ly, lr] of lobes) d = Math.min(d, Math.hypot(x - lx, y - ly) - lr);
    return d;
  };
  return sdfContour(sdf, path.concat(lobes.map((l) => [l[0], l[1]])), width);
}

function segDist(x, y, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t);
}

/** Trace the zero contour of a star-shaped SDF from its centroid (bridges are star-shaped enough at this scale). */
function sdfContour(sdf, ptsForCentroid, width) {
  let cx = 0, cy = 0; for (const p of ptsForCentroid) { cx += p[0]; cy += p[1]; } cx /= ptsForCentroid.length; cy /= ptsForCentroid.length;
  const out = [], N = 360;
  for (let i = 0; i < N; i++) {
    const a = i / N * TAU, dx = Math.cos(a), dy = Math.sin(a);
    // march outward to the last inside point (handles concavity along the ray poorly but bridges are convex-ish lobes)
    let t = 0, last = 0;
    for (let s = 0; s < 400; s++) { t += 0.06; if (sdf(cx + dx * t, cy + dy * t) <= 0) last = t; }
    // refine
    let lo = last, hi = last + 0.06;
    for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (sdf(cx + dx * m, cy + dy * m) <= 0) lo = m; else hi = m; }
    out.push(new THREE.Vector2(cx + dx * lo, cy + dy * lo));
  }
  return new THREE.Shape(out);
}

/**
 * A faceted hand (dauphine / leaf): outline from the centre (0,0) along +y; a raised ridge on the centre line.
 * half(t) gives the half width at fraction t of the length (t from -tail/len to 1).
 */
export function facetedHand({ len, tail, half, ridge = 0.18, thick = 0.12, n = 28 }) {
  const P = [], N = [], U = [];
  const ys = []; for (let i = 0; i <= n; i++) ys.push(-tail + (len + tail) * i / n);
  const L = ys.map((y) => [-half(y / len), y]), R = ys.map((y) => [half(y / len), y]);
  const tri = (a, b, c) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), vc = new THREE.Vector3(...c);
    // authored clockwise from above: emit a, c, b so faces point outward
    const nn = new THREE.Vector3().subVectors(vc, va).cross(new THREE.Vector3().subVectors(vb, va)).normalize();
    for (const v of [va, vc, vb]) { P.push(v.x, v.y, v.z); N.push(nn.x, nn.y, nn.z); U.push(v.x, v.y); }
  };
  for (let i = 0; i < n; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    const c0 = [0, y0, thick + ridge * ridgeFade(i / n)], c1 = [0, y1, thick + ridge * ridgeFade((i + 1) / n)];
    const l0 = [L[i][0], y0, thick], l1 = [L[i + 1][0], y1, thick], r0 = [R[i][0], y0, thick], r1 = [R[i + 1][0], y1, thick];
    // two sloped facets
    tri(l0, l1, c1); tri(l0, c1, c0);
    tri(c0, c1, r1); tri(c0, r1, r0);
    // sides
    const lb0 = [l0[0], y0, 0], lb1 = [l1[0], y1, 0], rb0 = [r0[0], y0, 0], rb1 = [r1[0], y1, 0];
    tri(lb0, lb1, l1); tri(lb0, l1, l0);
    tri(r0, r1, rb1); tri(r0, rb1, rb0);
    // underside
    tri(lb0, rb1, lb1); tri(lb0, rb0, rb1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
  function ridgeFade(t) { return Math.min(1, t * 6) * Math.min(1, (1 - t) * 10 + 0.0); }
}

/** An applied baton index: a faceted bar with a roof ridge along its length, base on z = 0, along +y. */
export function batonIndex(length, width, height) {
  const hw = width / 2, ridge = height, shoulder = height * 0.62;
  const sh = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(hw, shoulder), new THREE.Vector2(0, ridge), new THREE.Vector2(-hw, shoulder)]);
  let g = new THREE.ExtrudeGeometry(sh, { depth: length, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.04, bevelOffset: -0.04, bevelSegments: 1 });
  // shape is in x/y with extrusion along z: map (x, y, z) → (x, z - length/2, y)
  g.applyMatrix4(new THREE.Matrix4().set(-1, 0, 0, 0, 0, 0, 1, -length / 2, 0, 1, 0, 0, 0, 0, 0, 1));   // det +1: keeps the winding
  return splitGroups(g).reduce((a, b) => (a ? mergeGeometries([a, b]) : b), null);
}

/** Sweep a closed rounded-rectangle section along a 2-D path in the (y, z) plane; x is the section's width axis. */
export function sweepStrap({ path, width, thick, radius = 1.1, segs = 120, section = 24, uvScale = 1 }) {
  // path(s) → {y, z, ty, tz}; width(s), thick(s)
  const P = [], N = [], U = [], idx = [];
  const ring = [];
  // rounded-rect section in (x, n) where n is the outward normal of the path in the y-z plane
  const sec = (w, t) => {
    const pts = [], r = Math.min(radius, t / 2 - 0.01, w / 2 - 0.01);
    const corners = [[w / 2 - r, t / 2 - r, 0], [-w / 2 + r, t / 2 - r, Math.PI / 2], [-w / 2 + r, -t / 2 + r, Math.PI], [w / 2 - r, -t / 2 + r, Math.PI * 1.5]];
    const k = section / 4;
    for (const [cx, cy, a0] of corners) for (let i = 0; i <= k; i++) { const a = a0 + Math.PI / 2 * i / k; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]); }
    return pts;
  };
  let along = 0, prev = null;
  for (let i = 0; i <= segs; i++) {
    const s = i / segs, p = path(s);
    if (prev) along += Math.hypot(p.y - prev.y, p.z - prev.z);
    prev = p;
    const ny = -p.tz, nz = p.ty;                        // path normal (left of the tangent in y-z)
    const ps = sec(width(s), thick(s));
    let per = 0;
    ps.forEach(([x, n, nx, nn], j) => {
      if (j) per += Math.hypot(x - ps[j - 1][0], n - ps[j - 1][1]);
      P.push(x, p.y + ny * n, p.z + nz * n);
      const v = new THREE.Vector3(nx, ny * nn, nz * nn).normalize();
      N.push(v.x, v.y, v.z);
      U.push(per * uvScale, along * uvScale);
    });
    ring.push(ps.length);
  }
  const R = ring[0];
  for (let i = 0; i < segs; i++) for (let j = 0; j < R; j++) {
    const a = i * R + j, b = i * R + (j + 1) % R, c = (i + 1) * R + j, d = (i + 1) * R + (j + 1) % R;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(idx);
  return clean(g);
}

/** The "A" monogram of ATELIER H. as a shape (centred, ~1 unit tall). */
export function monogramA() {
  const s = new THREE.Shape([
    new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(-0.3, -0.5), new THREE.Vector2(-0.19, -0.18), new THREE.Vector2(0.19, -0.18),
    new THREE.Vector2(0.3, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0.08, 0.5), new THREE.Vector2(-0.08, 0.5),
  ]);
  s.holes.push(new THREE.Path([new THREE.Vector2(-0.13, -0.02), new THREE.Vector2(0.13, -0.02), new THREE.Vector2(0, 0.3)].reverse()));
  return s;
}

export function merge(list) { return mergeGeometries(list.map(clean)); }

/** A hairspring: a flat Archimedean spiral ribbon (top face + outer side), centre at the origin. */
export function hairspring({ r0 = 0.6, r1 = 3.2, turns = 12, w = 0.05, h = 0.12, n = 1400 }) {
  const P = [], N = [], U = [];
  const at = (t) => { const a = t * turns * TAU, r = r0 + (r1 - r0) * t; return [Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]; };
  const quad = (a, b, c, d, nn) => { for (const v of [a, b, c, a, c, d]) { P.push(...v); N.push(...nn); U.push(0, 0); } };
  for (let i = 0; i < n; i++) {
    const [x0, y0, c0, s0] = at(i / n), [x1, y1, c1, s1] = at((i + 1) / n);
    const i0 = [x0 - c0 * w / 2, y0 - s0 * w / 2, h], o0 = [x0 + c0 * w / 2, y0 + s0 * w / 2, h];
    const i1 = [x1 - c1 * w / 2, y1 - s1 * w / 2, h], o1 = [x1 + c1 * w / 2, y1 + s1 * w / 2, h];
    quad(i0, o0, o1, i1, [0, 0, 1]);
    const ob0 = [o0[0], o0[1], 0], ob1 = [o1[0], o1[1], 0];
    quad(o0, ob0, ob1, o1, [c0, s0, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}
