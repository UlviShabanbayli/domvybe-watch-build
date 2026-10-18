// DV65 · ATELIER H. Calibre AH-01, modelled in code. Millimetres; watch axis +z (dial up), 12 o'clock +y, 3 o'clock +x.
//
// Every part is a "unit": a group with a seated pose and an exploded pose. Scroll progress p ∈ [0, 1] moves each unit
// from exploded to seated over its own window [a, b]; at b it locks (a brief specular glint). The movement starts running
// once the balance cock is on; the seconds hand starts when the watch is complete.
import * as THREE from 'three';
import { lathe, arcPts, extrude, splitGroups, wheelShape, pinionShape, facetedHand, batonIndex, sweepStrap, monogramA, merge, hairspring, circlePts, clean } from './geom.js';
import { sdfShape, sd } from './contour.js';
import { clonePatched } from './patches.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (x, y, z, order = 'XYZ') => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));

// ---------- layout (seated) ----------
export const L = {
  caseR: 20.25, dialR: 16.4,
  barrel: [-3.9, 5.2], centre: [0, 0], third: [4.2, -3.7], fourth: [1.3, -7.2], escape: [-2.7, -8.8],
  balance: [-8.6, -5.6], pallet: [-5.53, -7.26], crownWheel: [2.9, 6.4],
  z: {
    plate: [-4.6, -3.6], barrelTeeth: [-3.5, -3.12], barrelDrum: [-3.12, -2.0],
    centre: [-3.2, -2.86], third: [-2.7, -2.36], fourth: [-2.2, -1.86], escape: [-1.75, -1.57],
    balance: [-2.6, -2.12], spring: -2.02, bridge: [-1.45, -0.65], cock: [-1.2, -0.5], ratchet: [-0.65, -0.4],
    rotor: [-5.1, -4.78], dial: [0, 0.4], hour: 0.82, minute: 1.08, second: 1.36, crystal: [2.0, 2.95],
  },
};

/** Ease used for every flight: a fast start that settles softly into the seat. */
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3.2) * (1 - t * 0.0));
const smooth = (t) => t * t * (3 - 2 * t);

export function buildWatch(M) {
  const root = new THREE.Group(); root.name = 'watch';
  const units = [];
  const byId = {};

  /** Build a unit from [geometry, material] pairs; geometries sharing a material are merged into one draw. */
  function unit(id, parts, o = {}) {
    const group = new THREE.Group(); group.name = id;
    const spin = new THREE.Group(); group.add(spin);       // running rotation (gears, balance) lives here
    const byMat = new Map();
    const pv = o.pivot;                                   // rotate about the part itself, not the movement centre
    if (pv) { o.pos = (o.pos || V(0, 0, 0)).clone().add(V(pv[0], pv[1], 0)); }
    for (const [g0, mat] of parts) { if (!g0) continue; const g = pv ? g0.clone().translate(-pv[0], -pv[1], 0) : g0; if (!byMat.has(mat)) byMat.set(mat, []); byMat.get(mat).push(g); }
    const mats = [];
    for (const [mat, gs] of byMat) {
      const own = o.glint === false || !mat.userData.u ? mat : clonePatched(mat);   // own uniforms → own glint
      const mesh = new THREE.Mesh(merge(gs), own);
      mesh.castShadow = ![M.crystal, M.print, M.blued, M.ruby, M.black, M.dialEdge].includes(mat); mesh.receiveShadow = mat !== M.crystal;
      if (mat === M.crystal) mesh.renderOrder = 10;
      if (mat === M.print) mesh.renderOrder = 2;
      spin.add(mesh); mats.push(own);
    }
    const u = {
      id, group, spin, mats,
      seatPos: o.pos ? o.pos.clone() : V(0, 0, 0), seatQuat: o.quat ? o.quat.clone() : new THREE.Quaternion(),
      off: o.off || V(0, 0, 0), offQuat: o.offQuat || new THREE.Quaternion(), arc: o.arc || V(0, 0, 0), spinFly: o.spinFly || 0,
      win: o.win || null, phase: Math.random() * TAU, breathe: o.breathe ?? 1, label: o.label || id,
    };
    group.position.copy(u.seatPos); group.quaternion.copy(u.seatQuat);
    root.add(group); units.push(u); byId[id] = u;
    return u;
  }
  const at = (g, x = 0, y = 0, z = 0) => { g.translate(x, y, z); return g; };
  const cyl = (r, z0, z1, seg = 48) => clean(at(new THREE.CylinderGeometry(r, r, z1 - z0, seg, 1).rotateX(Math.PI / 2), 0, 0, (z0 + z1) / 2));

  // ---------- case ----------
  const caseProfile = [[16.0, -5.2], [18.2, -5.2], ...arcPts(17.0, -2.05, 3.25, -1.2, 1.08, 26), [18.35, 1.0], [17.4, 1.0], [17.4, 0.0], [16.0, 0.0], [16.0, -5.2]];
  const caseG = lathe(caseProfile, 160, 0.5);
  // lugs: side profile in (y, z), extruded across x, rounded polished edges
  const lugShape = new THREE.Shape();
  lugShape.moveTo(14.8, 0.35);
  lugShape.quadraticCurveTo(21.0, 0.25, 25.1, -2.7);
  lugShape.quadraticCurveTo(25.7, -3.9, 24.9, -5.0);
  lugShape.quadraticCurveTo(21.5, -5.75, 17.6, -5.15);
  lugShape.lineTo(14.8, -4.4);
  lugShape.lineTo(14.8, 0.35);
  const lugBase = new THREE.ExtrudeGeometry(lugShape, { depth: 2.2, bevelEnabled: true, bevelThickness: 0.95, bevelSize: 0.75, bevelOffset: -0.75, bevelSegments: 4, curveSegments: 20 });
  // (u = y, v = z, w = x) → (x, y, z): cyclic, keeps the winding
  lugBase.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  const lugParts = [];
  for (const x0 of [11.25, -13.45]) {   // + bevel 0.95 each side → lugs span |x| 10.3 … 14.4
    const g1 = splitGroups(lugBase.clone().translate(x0, 0, 0));
    for (const g of g1) { lugParts.push(g.clone()); lugParts.push(g.clone().rotateZ(Math.PI)); }
  }
  // the crown tube
  const tube = clean(new THREE.CylinderGeometry(1.35, 1.35, 1.6, 32).rotateZ(Math.PI / 2).translate(20.6, 0, -2.05));
  unit('case', [[caseG, M.steelPolished], ...lugParts.map((g) => [g, M.steelPolished]), [tube, M.steelPolished]], { glint: true, label: 'Case' });

  // bezel (rose gold), domed
  const bezelProfile = [[17.0, 1.0], [20.12, 1.0], ...arcPts(18.7, 1.55, 1.48, -0.38, 2.05, 22), [17.45, 2.95], [17.08, 2.62], [17.0, 2.0], [17.0, 1.0]];
  unit('bezel', [[lathe(bezelProfile, 160, 0.7), M.rosePolished]], { label: 'Bezel' });

  // crown: fluted rose gold with an "A" on its end
  const crownG = (() => {
    const prof = [[0, 0], [2.6, 0], [2.95, 0.25], [3.1, 0.7], [3.1, 2.75], [2.95, 3.2], [2.4, 3.42], [0, 3.48]];
    let g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 192);
    g.rotateX(Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(x, y);
      if (r > 2.9 && z > 0.5 && z < 3.0) { const a = Math.atan2(y, x); const f = 1 - 0.055 * Math.pow(Math.max(0, Math.cos(a * 28)), 0.6); pos.setXY(i, x * f, y * f); }
    }
    g.computeVertexNormals();
    return clean(g);
  })();
  const crownA = splitGroups(new THREE.ExtrudeGeometry(monogramA(), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelOffset: -0.03, bevelSegments: 1 })).map((g) => g.scale(2.6, 2.6, 1).translate(0, 0, 3.4));
  const crownParts = [crownG, ...crownA].map((g) => g.clone().rotateY(Math.PI / 2).translate(21.2, 0, -2.05));
  unit('crown', crownParts.map((g) => [g, M.rosePolished]), { label: 'Crown' });

  // ---------- movement ----------
  function jewelAt(x, y, z) { return [
    [clean(new THREE.SphereGeometry(0.36, 20, 8, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.42).translate(x, y, z - 0.03)), M.ruby],
  ]; }
  const Z = L.z;
  // main plate (perlage) with a polished chamfer
  unit('plate', [
    [lathe([[0, Z.plate[0]], [15.5, Z.plate[0]], [15.5, Z.plate[1] - 0.15], [15.35, Z.plate[1]], [0, Z.plate[1]]], 128, 0.5), M.plate],
  ], { off: V(0, 0, 2.5), win: [0.07, 0.17], label: 'Main plate' });

  // barrel: toothed drum + cover (rose gold, circular graining)
  {
    const [bx, by] = L.barrel;
    const teeth = splitGroups(extrude(wheelShape({ r: 5.6, teeth: 90, spokes: 0, add: 0.14, ded: 0.18 }), Z.barrelTeeth[1] - Z.barrelTeeth[0], { bevel: 0.03 })).map((g) => g.translate(0, 0, Z.barrelTeeth[0]));
    const drum = lathe([[0, Z.barrelTeeth[1]], [5.15, Z.barrelTeeth[1]], [5.15, Z.barrelDrum[1] - 0.12], [5.0, Z.barrelDrum[1]], [0, Z.barrelDrum[1]]], 96, 0.5);
    const u = unit('barrel', [...teeth.map((g) => [g, M.roseWheel]), [drum, M.roseSatin], [cyl(0.5, Z.barrelDrum[1], Z.bridge[0]), M.steelPolished]],
      { pos: V(bx, by, 0), off: V(-1, 2, 6.5), offQuat: Q(0.3, -0.2, 0), spinFly: 2.5, win: [0.11, 0.24], label: 'Barrel' });
    u.kind = 'barrel';
  }

  // the gear train: wheel (rose gold) + pinion and arbor (polished steel)
  const wheel = (id, [x, y], r, teeth, spokes, zr, pin, pz, off, win, label, mat = M.roseWheel, extra = {}) => {
    const wg = splitGroups(extrude(wheelShape({ r, teeth, spokes, hub: Math.max(0.75, r * 0.2), rim: Math.max(0.42, r * 0.11), twist: 0.42, ...extra }), zr[1] - zr[0], { bevel: 0.025 })).map((g) => g.translate(0, 0, zr[0]));
    const pg = splitGroups(extrude(pinionShape(pin, extra.leaves || 8), pz[1] - pz[0], { bevel: 0.015 })).map((g) => g.translate(0, 0, pz[0]));
    const arbor = cyl(0.22, Z.plate[1], Z.bridge[0] + 0.05, 20);
    const hub = lathe([[0, zr[1]], [0.62, zr[1]], [0.62, zr[1] + 0.12], [0.45, zr[1] + 0.2], [0, zr[1] + 0.2]], 40, 0.6);
    return unit(id, [...wg.map((g) => [g, mat]), ...pg.map((g) => [g, M.steelPolished]), [arbor, M.steelPolished], [hub, M.steelPolished]],
      { pos: V(x, y, 0), off, offQuat: Q(0.45, 0.35, 0), spinFly: 3, win, label });
  };
  wheel('centre', L.centre, 5.0, 80, 5, Z.centre, 0.75, [Z.plate[1], Z.centre[0]], V(0.5, 0.5, 8), [0.15, 0.28], 'Centre wheel');
  wheel('third', L.third, 4.0, 75, 4, Z.third, 0.6, [Z.centre[0], Z.third[0]], V(2, -1, 10), [0.19, 0.31], 'Third wheel');
  wheel('fourth', L.fourth, 3.8, 70, 4, Z.fourth, 0.55, [Z.third[0], Z.fourth[0]], V(1.5, -2, 12), [0.22, 0.34], 'Fourth wheel');
  wheel('escape', L.escape, 2.45, 15, 5, Z.escape, 0.5, [Z.fourth[0], Z.escape[0]], V(-1.5, -2.5, 13.5), [0.25, 0.37], 'Escape wheel', M.steelPolished, { club: true, add: 0.0, ded: 0.75, toothFill: 0.3, leaves: 7, rim: 0.3 });

  // automatic works: two reverser wheels (steel, soleil) and the intermediate wheel (rose gold) on the right of the movement
  {
    const parts = [];
    const add = (x, y, r, teeth, z0, z1, mat, spokes = 0) => {
      parts.push(...splitGroups(extrude(wheelShape({ r, teeth, spokes, add: 0.13, ded: 0.17, hub: 0.7, rim: 0.4, twist: 0.4 }), z1 - z0, { bevel: 0.025 })).map((g) => [g.translate(x, y, z0), mat]));
      parts.push([cyl(0.5, z1, z1 + 0.12, 24).translate(x, y, 0), M.steelPolished], ...jewelAt(x, y, z1 + 0.12));
    };
    add(9.6, 3.2, 3.1, 48, -2.4, -2.1, M.steelSoleil, 5);
    add(9.9, -2.9, 2.5, 40, -1.9, -1.6, M.steelSoleil, 5);
    add(7.4, 9.6, 2.4, 44, -2.5, -2.2, M.roseWheel, 4);
    add(-10.4, 1.4, 2.9, 56, -2.6, -2.3, M.roseWheel, 5);
    unit('autoWorks', parts, { pos: V(0, 0, 0), off: V(1, 1, 9), offQuat: Q(0.25, 0.2, 0), win: [0.2, 0.33], label: 'Automatic works' });
  }
  // pallet fork: steel anchor with two ruby stones, pointing at the balance
  {
    const [px, py] = L.pallet;
    const toE = Math.atan2(L.escape[1] - py, L.escape[0] - px);
    const toB = Math.atan2(L.balance[1] - py, L.balance[0] - px);
    const f = sd.union(
      sd.capsule([0, 0], [Math.cos(toB) * 3.1, Math.sin(toB) * 3.1], 0.22),
      sd.capsule([Math.cos(toE + 0.9) * 2.0, Math.sin(toE + 0.9) * 2.0], [Math.cos(toE - 0.9) * 2.0, Math.sin(toE - 0.9) * 2.0], 0.3),
      sd.capsule([0, 0], [Math.cos(toE + 0.9) * 1.6, Math.sin(toE + 0.9) * 1.6], 0.32),
      sd.capsule([0, 0], [Math.cos(toE - 0.9) * 1.6, Math.sin(toE - 0.9) * 1.6], 0.32),
      sd.circle(0, 0, 0.6),
      sd.circle(Math.cos(toB) * 3.1, Math.sin(toB) * 3.1, 0.34),
    );
    const shapes = sdfShape(f, [-4, -4, 4, 4], 0.04, 0.03);
    const body = shapes.flatMap((s) => splitGroups(extrude(s, Z.escape[1] - Z.escape[0], { bevel: 0.02 })).map((g) => g.translate(0, 0, Z.escape[0])));
    const stones = [toE + 0.9, toE - 0.9].map((a) => clean(new THREE.BoxGeometry(0.34, 0.5, 0.2).rotateZ(a).translate(Math.cos(a) * 2.25, Math.sin(a) * 2.25, Z.escape[0] + 0.1)));
    const u = unit('pallet', [...body.map((g) => [g, M.steelPolished]), ...stones.map((g) => [g, M.ruby]), [cyl(0.2, Z.plate[1], Z.bridge[0], 16), M.steelPolished]],
      { pos: V(px, py, 0), off: V(-3, -2.5, 15), offQuat: Q(0.4, -0.3, 0.2), spinFly: 1.5, win: [0.28, 0.4], label: 'Pallet fork' });
    u.kind = 'pallet';
  }

  // balance: rose-gold rim with timing screws, three arms, blued-steel hairspring, roller
  {
    const [bx, by] = L.balance;
    const rimS = sdfShape(sd.union(sd.ring(0, 0, 3.85, 4.45), ...[0, 1, 2].map((k) => sd.capsule([0, 0], [Math.cos(k * TAU / 3 + 0.5) * 4.1, Math.sin(k * TAU / 3 + 0.5) * 4.1], 0.2)), sd.circle(0, 0, 0.7)), [-5, -5, 5, 5], 0.05, 0.06);
    const rim = rimS.flatMap((s) => splitGroups(extrude(s, Z.balance[1] - Z.balance[0], { bevel: 0.03 })).map((g) => g.translate(0, 0, Z.balance[0])));
    const screws = [];
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + 0.2; const g = clean(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 14).rotateZ(Math.PI / 2).rotateZ(a).translate(Math.cos(a) * 4.62, Math.sin(a) * 4.62, (Z.balance[0] + Z.balance[1]) / 2)); screws.push(g); }
    const spring = hairspring({ r0: 0.7, r1: 3.2, turns: 13, w: 0.055, h: 0.1, n: 900 });
    spring.translate(0, 0, Z.spring);
    const roller = cyl(0.55, Z.escape[0], Z.escape[1], 24);
    const u = unit('balance', [...rim.map((g) => [g, M.roseSatin]), ...screws.map((g) => [g, M.rosePolished]), [clean(spring), M.blued], [roller, M.steelPolished], [cyl(0.2, Z.plate[1], Z.cock[0], 16), M.steelPolished]],
      { pos: V(bx, by, 0), off: V(-5, 0, 16.5), offQuat: Q(0.45, -0.35, 0), spinFly: 2, win: [0.31, 0.43], label: 'Balance' });
    u.kind = 'balance';
  }

  // jewels: a ruby dome in a polished countersink
  const jewel = (x, y, z) => [
    [clean(new THREE.SphereGeometry(0.42, 24, 10, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.42).translate(x, y, z - 0.03)), M.ruby],
    [lathe([[0.4, z - 0.04], [0.82, z + 0.01], [0.82, z + 0.02], [0.4, z - 0.02]], 40, 0.3).translate(x, y, 0), M.rhodiumAnglage],
  ];
  // a blued screw: domed head with a slot
  const screw = (x, y, z, a = 0.4) => [
    [lathe([[0, z], [0.58, z], [0.6, z + 0.12], ...arcPts(0, z + 0.05, 0.6, 0.2, Math.PI / 2, 8)], 32, 0.6).translate(x, y, 0), M.blued],
    [clean(new THREE.BoxGeometry(1.24, 0.13, 0.2).rotateZ(a).translate(x, y, z + 0.6)), M.black],
  ];

  // bridges: Côtes de Genève on top, polished anglage on the sides
  const bridge = (id, f, box, zr, extras, off, win, label, quat = Q(0.5, -0.4, 0.15), pivot = null) => {
    const shapes = sdfShape(f, box, 0.05, 0.07);
    const parts = [];
    for (const s of shapes) {
      const [top, side] = splitGroups(extrude(s, zr[1] - zr[0], { bevel: 0.12, bevelSeg: 2 }));
      parts.push([top.translate(0, 0, zr[0]), M.rhodiumCotes], [side.translate(0, 0, zr[0]), M.rhodiumAnglage]);
    }
    return unit(id, [...parts, ...extras], { off, offQuat: quat, win, label, pivot });
  };
  const zb = Z.bridge[1];
  // barrel bridge: covers the barrel and the centre pivot, carries the ratchet wheel and the crown wheel
  {
    const [bx, by] = L.barrel, [cx, cy] = L.crownWheel;
    const f = sd.sub(sd.smoothUnion(1.2,
      sd.circle(bx, by, 6.0),
      sd.capsule([bx, by], [-11.2, 9.6], 3.2),
      sd.capsule([bx, by], [0, 0], 1.7),
      sd.circle(0, 0, 1.5),
      sd.capsule([bx, by], [cx, cy], 2.2),
      sd.circle(cx, cy, 2.6),
      sd.capsule([cx, cy], [8.2, 12.2], 1.9),
    ), sd.circle(0, 0, -100));
    const ratchet = (() => {
      // sawtooth ratchet wheel, steel with a soleil finish
      const pts = []; const n = 36;
      for (let k = 0; k < n; k++) { const a = k / n * TAU; pts.push(new THREE.Vector2(Math.cos(a) * 3.85, Math.sin(a) * 3.85), new THREE.Vector2(Math.cos(a + TAU / n * 0.85) * 4.3, Math.sin(a + TAU / n * 0.85) * 4.3)); }
      return splitGroups(extrude(new THREE.Shape(pts), Z.ratchet[1] - Z.ratchet[0], { bevel: 0.03 })).map((g) => g.translate(bx, by, Z.ratchet[0]));
    })();
    const crownW = splitGroups(extrude(wheelShape({ r: 2.55, teeth: 32, spokes: 0, add: 0.12, ded: 0.14 }), Z.ratchet[1] - Z.ratchet[0], { bevel: 0.03 })).map((g) => g.translate(cx, cy, Z.ratchet[0]));
    const extras = [
      ...ratchet.map((g) => [g, M.steelSoleil]), ...crownW.map((g) => [g, M.steelSoleil]),
      ...screw(bx, by, Z.ratchet[1], 0.6), ...screw(cx, cy, Z.ratchet[1], 1.1),
      ...screw(-10.4, 9.0, zb, 0.2), ...screw(7.6, 11.4, zb, 1.4),
      ...jewel(0, 0, zb),
    ];
    bridge('barrelBridge', f, [-15, -3, 11, 15], Z.bridge, extras, V(-2, 4, 19), [0.35, 0.47], 'Barrel bridge', Q(0.5, -0.4, 0.15), [-3, 6]);
  }
  // train bridge: a sweeping arm over the third, fourth and escape pivots
  {
    const f = sd.smoothUnion(0.9,
      sd.path([[13.4, -5.0], L.third, L.fourth, L.escape, [-3.4, -13.6]], 1.55),
      sd.circle(...L.third, 1.55), sd.circle(...L.fourth, 1.55), sd.circle(...L.escape, 1.45),
    );
    const extras = [...jewel(...L.third, zb), ...jewel(...L.fourth, zb), ...jewel(...L.escape, zb), ...jewel(...L.pallet, zb), ...screw(12.2, -5.6, zb, 0.9), ...screw(-3.2, -12.4, zb, 2.0)];
    const f2 = sd.union(f, sd.capsule(L.escape, L.pallet, 0.95), sd.circle(...L.pallet, 1.2));
    bridge('trainBridge', f2, [-7, -15, 15, 0], Z.bridge, extras, V(3, -3, 20.5), [0.38, 0.5], 'Train bridge', Q(0.4, 0.5, -0.2), [3, -7]);
  }
  // balance cock: a cantilever from the plate edge to the balance pivot, with the regulator index
  {
    const [bx, by] = L.balance;
    const f = sd.smoothUnion(1.6, sd.capsule([-12.6, -10.2], [bx, by], 2.0), sd.capsule([-14.2, -5.2], [-12.6, -10.2], 1.6), sd.circle(bx, by, 2.4));
    const index = splitGroups(extrude(sdfShape(sd.capsule([0, 0], [3.6, 2.0], 0.22), [-1, -1, 5, 3], 0.03)[0], 0.12, { bevel: 0.02 })).map((g) => g.translate(bx, by, Z.cock[1]));
    const extras = [...jewel(bx, by, Z.cock[1] + 0.02), ...screw(-12.9, -8.4, Z.cock[1], 0.5), ...index.map((g) => [g, M.steelPolished])];
    bridge('balanceCock', f, [-16, -12, -5, -2], Z.cock, extras, V(-6, -1, 22), [0.41, 0.52], 'Balance cock', Q(0.5, -0.4, 0.2), [-10, -7]);
  }

  // rotor: rose gold half-moon, Côtes de Genève, raised "A", steel bearing with blued screws
  {
    const f = sd.sub(sd.union(sd.intersect(sd.circle(0, 0, 15.2), (x, y) => y + 0.4), sd.circle(0, 0, 3.6)), sd.circle(0, 0, 1.6));
    const shapes = sdfShape(f, [-16, -16, 16, 5], 0.06, 0.08);
    const body = shapes.flatMap((s) => { const [t, sdg] = splitGroups(extrude(s, Z.rotor[1] - Z.rotor[0], { bevel: 0.14, bevelSeg: 2 })); return [[t.translate(0, 0, Z.rotor[0]), M.roseCotes], [sdg.translate(0, 0, Z.rotor[0]), M.rosePolished]]; });
    // the rotor's decorated face looks toward the caseback (−z): flip it so the "A" faces out of the back
    const mono = splitGroups(new THREE.ExtrudeGeometry(monogramA(), { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelOffset: -0.05, bevelSegments: 2 })).map((g) => g.scale(6.2, 6.2, 1).translate(0, -9.2, Z.rotor[1]));
    const bearing = [
      [lathe([[1.6, Z.rotor[0] - 0.1], [3.0, Z.rotor[0] - 0.1], [3.1, Z.rotor[1] + 0.25], [1.6, Z.rotor[1] + 0.3]], 64, 0.5), M.steelPolished],
      [lathe([[0, Z.rotor[1] + 0.2], [1.6, Z.rotor[1] + 0.2], [1.6, Z.rotor[1] + 0.32], [0, Z.rotor[1] + 0.32]], 48, 0.5), M.steelSoleil],
      ...jewel(0, 0, Z.rotor[1] + 0.33),
      ...[0, 1, 2].flatMap((k) => screw(Math.cos(k * TAU / 3 + 0.5) * 2.35, Math.sin(k * TAU / 3 + 0.5) * 2.35, Z.rotor[1] + 0.25, k)),
    ];
    // the rotor rides under the plate with its decorated side toward the back; we build it face-up (+z) and turn it over
    const u = unit('rotor', [...body, ...mono.map((g) => [g, M.rosePolished]), ...bearing], {
      quat: Q(Math.PI, 0, 0.6), pos: V(0, 0, 2 * Z.rotor[0] + (Z.rotor[1] - Z.rotor[0])).multiplyScalar(1),
      off: V(30, -14, 18), offQuat: Q(Math.PI - 0.35, 0.6, 0.3), arc: V(6, -8, -14), spinFly: 0.35, win: [0.44, 0.58], label: 'Rotor',
    });
    u.kind = 'rotor';
  }

  // winding stem with the setting lever (steel), into the crown at 3 o'clock
  {
    const shaft = clean(new THREE.CylinderGeometry(0.42, 0.42, 12.5, 20).rotateZ(Math.PI / 2).translate(14.6, 0, -2.05));
    const sq = clean(new THREE.BoxGeometry(2.6, 0.8, 0.8).translate(10.6, 0, -2.05));
    const lever = splitGroups(extrude(sdfShape(sd.smoothUnion(0.6, sd.capsule([9.0, 2.6], [13.6, 1.0], 0.55), sd.circle(9.0, 2.6, 0.9), sd.capsule([13.6, 1.0], [14.4, -0.2], 0.4)), [7, -1.5, 16, 4.5], 0.04)[0], 0.3, { bevel: 0.04 })).map((g) => g.translate(0, 0, -2.75));
    unit('stem', [[shaft, M.steelPolished], [sq, M.steelPolished], ...lever.map((g) => [g, M.steelPolished])],
      { off: V(-8, 25, 40), offQuat: Q(0.4, 0.2, 0.75), arc: V(10, 6, 4), win: [0.47, 0.58], label: 'Stem', pivot: [13, 0] });
  }

  // caseback (steel, polished bevel)
  unit('caseback', [[lathe([[0, -6.55], [15.6, -6.55], ...arcPts(15.6, -5.2, 1.35, -Math.PI / 2, 0, 10), [16.95, -5.2], [0, -5.2]], 128, 0.6), M.steelPolished]],
    { off: V(0, 0, -16), win: [0.5, 0.62], label: 'Caseback' });

  // ---------- dial module: sunburst fumé dial, print, applied indices, polished flange ring ----------
  {
    const R = L.dialR, zd = Z.dial;
    const top = clean(new THREE.CircleGeometry(R - 0.05, 256).translate(0, 0, zd[1]));
    const edge = lathe([[0, zd[0]], [R, zd[0]], [R, zd[1] - 0.05], [R - 0.05, zd[1]]], 160, 0.4);
    const print = clean(new THREE.CircleGeometry(R, 96).translate(0, 0, zd[1] + 0.004));
    const idx = [];
    for (let h = 0; h < 12; h++) {
      const a = -h / 12 * TAU;
      const pair = h === 0 ? [-0.48, 0.48] : [0];
      for (const dx of pair) idx.push(batonIndex(h === 0 ? 3.3 : 3.0, h === 0 ? 0.58 : 0.66, 0.46).translate(dx, (h === 0 ? 13.9 : 14.0), zd[1]).rotateZ(a));
    }
    const flange = lathe([[16.15, 0.38], [17.35, 0.38], [17.35, 1.0], [16.98, 1.0], [16.98, 1.72], [16.9, 1.76], [16.15, 0.45]], 160, 0.5);
    const pipe = lathe([[0, zd[1]], [0.95, zd[1]], [0.95, zd[1] + 0.35], [0.6, zd[1] + 0.42], [0, zd[1] + 0.42]], 32, 0.6);
    unit('dial', [[top, M.dial], [edge, M.dialEdge], [print, M.print], ...idx.map((g) => [g, M.rosePolished]), [flange, M.steelPolished], [pipe, M.rosePolished]],
      { off: V(-12, 5, 34), offQuat: Q(0.2, 0.2, 0.05), arc: V(-3, 4, 4), win: [0.56, 0.72], label: 'Dial', breathe: 0.35 });
  }

  // ---------- hands (rose gold, faceted) ----------
  const hourG = facetedHand({ len: 10.4, tail: 1.8, ridge: 0.26, thick: 0.1, half: (t) => (t < 0 ? 0.62 + t * 0.6 : t < 0.2 ? 0.62 + 0.42 * t / 0.2 : 1.04 * (1 - (t - 0.2) / 0.8) + 0.02) });
  const minG = facetedHand({ len: 15.1, tail: 2.2, ridge: 0.22, thick: 0.1, half: (t) => (t < 0 ? 0.55 + t * 0.5 : t < 0.18 ? 0.55 + 0.33 * t / 0.18 : 0.88 * (1 - (t - 0.18) / 0.82) + 0.015) });
  const secG = facetedHand({ len: 15.7, tail: 4.2, ridge: 0.05, thick: 0.08, n: 40, half: (t) => (t < -0.16 ? 0.34 : t < 0 ? 0.13 : 0.13 - 0.07 * t) });
  const collet = (r, h) => lathe([[0, 0], [r, 0], [r, h], [r * 0.8, h + 0.05], [0, h + 0.05]], 40, 0.6);
  unit('hour', [[hourG.translate(0, 0, 0), M.roseHand], [collet(0.95, 0.16), M.roseHand]],
    { pos: V(0, 0, Z.hour), off: V(-13, 21, 50), offQuat: Q(0.5, -0.3, 0.9), arc: V(-4, 3, 6), spinFly: 1.2, win: [0.7, 0.8], label: 'Hour hand', glint: true });
  unit('minute', [[minG, M.roseHand], [collet(0.78, 0.16), M.roseHand]],
    { pos: V(0, 0, Z.minute), off: V(-16, 25, 53), offQuat: Q(0.45, -0.2, 1.1), arc: V(-4, 3, 6), spinFly: 1.4, win: [0.74, 0.84], label: 'Minute hand', glint: true });
  unit('second', [[secG, M.roseHand], [lathe([[0, 0], [0.62, 0], [0.62, 0.12], ...arcPts(0, 0.1, 0.62, 0.05, Math.PI / 2, 8)], 32, 0.6), M.rosePolished]],
    { pos: V(0, 0, Z.second), off: V(-19, 29, 56), offQuat: Q(0.4, -0.1, 1.3), arc: V(-4, 3, 6), spinFly: 1.6, win: [0.78, 0.88], label: 'Seconds hand', glint: true });

  // ---------- sapphire crystal ----------
  unit('crystal', [[lathe([[0, Z.crystal[0]], [17.36, Z.crystal[0]], [17.4, 2.45], [17.22, 2.86], [0, 2.95]], 160, 0.35), M.crystal]],
    { off: V(-30, 70, 90), offQuat: Q(0.5, -0.3, 0), arc: V(-4, 6, 4), win: [0.85, 0.94], label: 'Sapphire crystal', glint: false });

  // ---------- strap: taupe saffiano leather, two halves on spring bars ----------
  {
    const path = (s) => {
      // integrate a curvature profile: straight off the lugs, then wrapping back round a wrist
      const Ltot = 84, l = s * Ltot;
      let y = 20.3, z = -3.6, a = -0.2; const dl = 0.25;
      for (let q = 0; q < l; q += dl) { const k = q < 3 ? 0 : Math.min(1, (q - 3) / 26) / 52; a -= k * dl; y += Math.cos(a) * dl; z += Math.sin(a) * dl; }
      return { y, z, ty: Math.cos(a), tz: Math.sin(a) };
    };
    const width = (s) => { const l = s * 84; const w = 19.9 - 2.2 * Math.min(1, l / 70); const tip = 7; return l > 84 - tip ? w * Math.sqrt(Math.max(0.0001, 1 - ((l - (84 - tip)) / tip) ** 2)) : w; };
    const thick = (s) => 3.5 - 0.9 * Math.min(1, s * 1.4);
    const body = sweepStrap({ path, width, thick, radius: 1.15, segs: 110, section: 24, uvScale: 1 });
    // end cap at the lug end (fan), slightly darker edge-painted
    const cap = (() => {
      const p = path(0), w = width(0) / 2, t = thick(0) / 2;
      const sh = new THREE.Shape(); const r = 1.1;
      sh.moveTo(-w + r, -t); sh.lineTo(w - r, -t); sh.quadraticCurveTo(w, -t, w, -t + r); sh.lineTo(w, t - r); sh.quadraticCurveTo(w, t, w - r, t); sh.lineTo(-w + r, t); sh.quadraticCurveTo(-w, t, -w, t - r); sh.lineTo(-w, -t + r); sh.quadraticCurveTo(-w, -t, -w + r, -t);
      const g = clean(new THREE.ShapeGeometry(sh, 6));
      // section plane: x across, local y = path normal; face −tangent
      const ny = -p.tz, nz = p.ty;
      const m = new THREE.Matrix4().set(1, 0, 0, 0, 0, ny, -p.ty, p.y, 0, nz, -p.tz, p.z, 0, 0, 0, 1);
      g.applyMatrix4(m);
      // the map has det +1, so the shape's +z face now looks along −tangent (out of the strap end)
      g.computeVertexNormals();
      return g;
    })();
    const bar = clean(new THREE.CylinderGeometry(0.5, 0.5, 20.6, 16).rotateZ(Math.PI / 2).translate(0, 21.9, -3.95));
    const strapParts = (flip) => [[flip ? body.clone().rotateZ(Math.PI) : body, M.leather], [flip ? cap.clone().rotateZ(Math.PI) : cap, M.leatherEdge], [flip ? bar.clone().rotateZ(Math.PI) : bar, M.steelPolished]];
    unit('strapTop', strapParts(false), { off: V(0, 6, -1), offQuat: Q(-0.1, 0, 0), win: [0.05, 0.16], label: 'Strap', breathe: 0.4 });
    unit('strapBottom', strapParts(true), { off: V(0, -6, -1), offQuat: Q(0.1, 0, 0), win: [0.06, 0.17], label: 'Strap', breathe: 0.4 });
  }

  for (const id of ['plate', 'barrel', 'centre', 'third', 'fourth', 'escape', 'autoWorks', 'pallet', 'balance', 'barrelBridge', 'trainBridge', 'balanceCock']) byId[id].inside = 'dial';
  byId.rotor.inside = 'back'; byId.stem.inside = 'case';

  // ---------- running ----------
  const hands = { hour: byId.hour, minute: byId.minute, second: byId.second };
  const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), zAxis = V(0, 0, 1), tmpV = new THREE.Vector3();
  const state = { p: 0, glints: true, breathe: 1, secShown: 0, aliveSince: -1 };

  /** Hand angles from a Date (clockwise from 12 → negative about +z). Seconds sweep in 8 beats a second (4 Hz). */
  function handAngles(now, alive) {
    const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds(), ms = now.getMilliseconds();
    const sec = alive ? s + Math.floor(ms / 125) / 8 : 0;
    return { hour: -((h + m / 60 + s / 3600) / 12) * TAU, minute: -((m + s / 60) / 60) * TAU, second: -(sec / 60) * TAU, sec };
  }

  /**
   * Pose every unit for scroll progress p (0..1) at wall time `now` (Date) and animation clock `t` (s).
   * Returns flags the stage uses to decide whether it must keep rendering.
   */
  function update(p, now, t, { reduced = false } = {}) {
    state.p = p;
    const running = p >= 0.53;                  // the balance cock is on: the movement beats
    const alive = p >= 0.955;                   // fully assembled: the seconds hand runs
    const ang = handAngles(now, alive);
    let flying = false;
    for (const u of units) {
      let e = 1, raw = 1;
      if (u.win) { raw = (p - u.win[0]) / (u.win[1] - u.win[0]); e = ease(Math.min(1, Math.max(0, raw))); }
      const away = 1 - e;
      if (away > 0) flying = true;
      // position: seat + offset (+ an arc bump mid-flight) + a slow breath while away
      tmpV.copy(u.off).multiplyScalar(away).addScaledVector(u.arc, Math.sin(Math.PI * e) * away);
      if (away > 0 && !reduced && state.breathe) {
        const b = u.breathe * state.breathe * Math.min(1, away * 3);
        tmpV.x += Math.sin(t * 0.55 + u.phase) * 0.35 * b; tmpV.y += Math.sin(t * 0.43 + u.phase * 1.7) * 0.35 * b; tmpV.z += Math.sin(t * 0.37 + u.phase * 2.3) * 0.5 * b;
      }
      u.group.position.copy(u.seatPos).add(tmpV);
      // rotation: exploded tilt → seat, plus a spin about the part's own axis while it flies
      let seat = u.seatQuat;
      if (u === hands.hour) seat = tmpQ2.setFromAxisAngle(zAxis, ang.hour);
      else if (u === hands.minute) seat = tmpQ2.setFromAxisAngle(zAxis, ang.minute);
      else if (u === hands.second) seat = tmpQ2.setFromAxisAngle(zAxis, ang.second);
      tmpQ.copy(seat).multiply(u.offQuat.clone().slerp(new THREE.Quaternion(), e));
      if (u.spinFly) tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, u.spinFly * away));
      if (away > 0 && !reduced && state.breathe) tmpQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * 0.31 + u.phase) * 0.03 * u.breathe, Math.sin(t * 0.27 + u.phase * 1.3) * 0.03 * u.breathe, 0)));
      u.group.quaternion.copy(tmpQ);
      // lock glint: a short flash as the part seats (scroll-driven, so it replays when you scrub)
      const g = u.win && state.glints ? Math.max(0, 1 - Math.abs(raw - 1) / 0.07) ** 2 * (raw <= 1.07 ? 1 : 0) : 0;
      for (const m of u.mats) if (m.userData.u) m.userData.u.uGlint.value = g;
    }
    // parts that end up fully enclosed stop drawing: the dial covers the movement once it is seated, the caseback covers
    // the rotor, the case swallows the stem (about two thirds of the triangles; the finished watch draws only what shows)
    const covered = p >= 0.725, backed = p >= 0.625;
    for (const u of units) {
      const hide = (u.inside === 'dial' && covered) || (u.inside === 'back' && backed) || (u.inside === 'case' && p >= 0.59);
      u.group.visible = !hide;
    }
    // the movement running: balance swings ±270° at 4 Hz, the escapement steps, the train turns
    const tb = running ? t : 0;
    const bal = byId.balance, esc = byId.escape, pal = byId.pallet;
    const amp = running && !reduced ? 4.7 : 0;
    bal.spin.rotation.z = amp * Math.sin(tb * TAU * 4);
    const beats = running ? Math.floor(tb * 8) + smooth(Math.min(1, ((tb * 8) % 1) / 0.25)) : 0;
    esc.spin.rotation.z = -beats * (TAU / 30);
    pal.spin.rotation.z = running ? 0.12 * (Math.floor(tb * 8) % 2 ? 1 : -1) * (1 - Math.exp(-((tb * 8) % 1) * 9)) : 0;
    byId.fourth.spin.rotation.z = beats * (TAU / 30) / 16;
    byId.third.spin.rotation.z = -beats * (TAU / 30) / 16 / 7.5;
    byId.centre.spin.rotation.z = beats * (TAU / 30) / 16 / 60;
    return { flying, running: running && !reduced, alive, sec: ang.sec };
  }

  return { root, units, byId, update, state, L };
}
