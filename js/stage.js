// DV65 · the WebGL stage: renderer, studio light, camera rig, and a small post chain
//   scene (HalfFloat, 4× MSAA, jittered when still) → history (running average: supersampled AA when nothing moves)
//   → bloom (5-level dual filter on the brightest glints) → output (ACES, sRGB, fine grain + dither) onto a transparent
//   canvas over the DOM velvet. The loop sleeps when nothing changes; a still frame converges to 16 samples and stops.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { makeStudioEnv } from './env.js';
import { createMaterials } from './materials.js';
import { buildWatch } from './watch.js';

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
const DEG = Math.PI / 180;

function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

// Camera keyframes over scroll progress: yaw/pitch (deg, orbit round the target), dist (mm), target (mm), shift (NDC lens shift)
const SHOTS = {
  desk: [
    { p: 0.00, yaw: 31, pitch: 10, dist: 285, tgt: [-3, 2, 12], shift: [0.08, 0.17] },
    { p: 0.12, yaw: 31, pitch: 12, dist: 262, tgt: [-2, 0, 9], shift: [0.09, 0.18] },
    { p: 0.34, yaw: 30, pitch: 18, dist: 205, tgt: [-1, -1, 5], shift: [0.1, 0.18] },
    { p: 0.52, yaw: 34, pitch: 14, dist: 240, tgt: [0, 2, 7], shift: [0.09, 0.18] },
    { p: 0.7, yaw: 38, pitch: 9, dist: 275, tgt: [-1, 3, 11], shift: [0.08, 0.17] },
    { p: 0.9, yaw: 30, pitch: 9, dist: 270, tgt: [0, 0, 0], shift: [0.1, 0.2] },
    { p: 1.00, yaw: 28, pitch: 8, dist: 262, tgt: [0, 0, 0], shift: [0.1, 0.2] },
  ],
  phone: [
    { p: 0.00, yaw: 6, pitch: -27, dist: 410, tgt: [0, 6, 16], shift: [0, 0.07] },
    { p: 0.34, yaw: 6, pitch: -30, dist: 370, tgt: [0, 0, 6], shift: [0, 0.1] },
    { p: 0.7, yaw: 4, pitch: -22, dist: 380, tgt: [0, 2, 10], shift: [0, 0.12] },
    { p: 1.00, yaw: 0, pitch: -3, dist: 318, tgt: [0, 0, 0], shift: [0, 0.135] },
  ],
};

const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (t) => t * t * (3 - 2 * t);
function shotAt(list, p) {
  let i = 0; while (i < list.length - 2 && p > list[i + 1].p) i++;
  const a = list[i], b = list[i + 1], t = sstep(Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p))));
  return { yaw: lerp(a.yaw, b.yaw, t), pitch: lerp(a.pitch, b.pitch, t), dist: lerp(a.dist, b.dist, t), tgt: a.tgt.map((v, k) => lerp(v, b.tgt[k], t)), shift: a.shift.map((v, k) => lerp(v, b.shift[k], t)) };
}

export async function createStage(canvas, { reduced = false, maxDpr = 2, font = 'Lato', centre = false, dbg = new URLSearchParams(location.search) } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance', stencil: false });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // the output pass converts
  renderer.shadowMap.enabled = !dbg.has('noshadow');
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.environment = makeStudioEnv(renderer);
  scene.environmentIntensity = 1.0;
  scene.environmentRotation = new THREE.Euler(0, 0, 0);

  const { m: M } = createMaterials({ dialFont: font });
  const watch = buildWatch(M);
  // the watch sits upright, 12 o'clock up, dial toward +z
  scene.add(watch.root);

  // key: a warm spot from high right, soft shadows inside the case and under the bridges
  const key = new THREE.SpotLight(new THREE.Color().setRGB(1.0, 0.86, 0.7), 3.2, 0, 0.24, 0.9, 0);
  key.position.set(230, 300, 260); key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  key.shadow.camera.near = 250; key.shadow.camera.far = 620;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 3;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(new THREE.Color().setRGB(0.75, 0.82, 1.0), 0.9);
  rim.position.set(-200, 120, -150);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(22, 1, 20, 2000);

  // ---------- post ----------
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
  const rtScene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: dbg.has('nomsaa') ? 0 : 4, stencilBuffer: false });
  const hist = [new THREE.WebGLRenderTarget(1, 1, rtOpts), new THREE.WebGLRenderTarget(1, 1, rtOpts)];
  let histI = 0;
  const blend = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tCur: { value: null }, tPrev: { value: null }, uW: { value: 1 }, uScale: { value: new THREE.Vector2(1, 1) } },
    vertexShader: VS,
    fragmentShader: 'uniform sampler2D tCur; uniform sampler2D tPrev; uniform float uW; uniform vec2 uScale; varying vec2 vUv; void main() { vec4 c = texture2D( tCur, vUv * uScale ); if ( any( isnan( c ) ) || any( isinf( c ) ) ) c = vec4( 0.0 ); gl_FragColor = mix( texture2D( tPrev, vUv ), c, uW ); }',
    depthTest: false, depthWrite: false,
  }));
  const LEVELS = 4;
  const bloomRT = Array.from({ length: LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, rtOpts));
  const down = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPrefilter: { value: 0 }, uThreshold: { value: 2.0 }, uSrcScale: { value: new THREE.Vector2(1, 1) } },
    vertexShader: VS,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uPrefilter; uniform float uThreshold; uniform vec2 uSrcScale; varying vec2 vUv;
      vec3 pf( vec3 c ) { float l = max( c.r, max( c.g, c.b ) ); float k = max( l - uThreshold, 0.0 ); k = k * k / ( k + 0.6 ); return c * ( k / max( l, 1e-4 ) ); }
      void main() {
        vec2 o = uTexel, U = vUv * uSrcScale;
        vec3 s = texture2D( tSrc, U ).rgb * 4.0;
        s += texture2D( tSrc, U + vec2( -o.x, -o.y ) ).rgb + texture2D( tSrc, U + vec2( o.x, -o.y ) ).rgb
           + texture2D( tSrc, U + vec2( -o.x, o.y ) ).rgb + texture2D( tSrc, U + vec2( o.x, o.y ) ).rgb;
        s /= 8.0;
        if ( uPrefilter > 0.5 ) { s = pf( s ); if ( any( isnan( s ) ) || any( isinf( s ) ) ) s = vec3( 0.0 ); s = min( s, vec3( 64.0 ) ); }
        gl_FragColor = vec4( s, 1.0 );
      }`,
    depthTest: false, depthWrite: false,
  }));
  const up = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: VS,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec2 o = uTexel * 0.5;
        vec3 s = texture2D( tSrc, vUv + vec2( -o.x * 2.0, 0.0 ) ).rgb + texture2D( tSrc, vUv + vec2( o.x * 2.0, 0.0 ) ).rgb
           + texture2D( tSrc, vUv + vec2( 0.0, -o.y * 2.0 ) ).rgb + texture2D( tSrc, vUv + vec2( 0.0, o.y * 2.0 ) ).rgb;
        s += ( texture2D( tSrc, vUv + vec2( -o.x, o.y ) ).rgb + texture2D( tSrc, vUv + vec2( o.x, o.y ) ).rgb
           + texture2D( tSrc, vUv + vec2( -o.x, -o.y ) ).rgb + texture2D( tSrc, vUv + vec2( o.x, -o.y ) ).rgb ) * 2.0;
        gl_FragColor = vec4( s / 12.0, 1.0 );
      }`,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  }));
  const out = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tHist: { value: null }, tBloom: { value: null }, uHistScale: { value: new THREE.Vector2(1, 1) }, uBloom: { value: 0.16 }, uExposure: { value: 2.0 }, uSeed: { value: 0 }, uGrain: { value: 0.018 } },
    vertexShader: VS,
    fragmentShader: `uniform sampler2D tHist; uniform sampler2D tBloom; uniform vec2 uHistScale; uniform float uBloom; uniform float uExposure; uniform float uSeed; uniform float uGrain; varying vec2 vUv;
      // ACES (Stephen Hill fit)
      vec3 RRTODT( vec3 v ) { vec3 a = v * ( v + 0.0245786 ) - 0.000090537; vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081; return a / b; }
      vec3 aces( vec3 c ) {
        const mat3 I = mat3( 0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777 );
        const mat3 O = mat3( 1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602 );
        return clamp( O * RRTODT( I * c ), 0.0, 1.0 );
      }
      vec3 toSRGB( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) ); }
      float hash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
      void main() {
        vec4 h = texture2D( tHist, vUv * uHistScale );
        vec3 b = texture2D( tBloom, vUv ).rgb;
        vec3 c = ( h.rgb + b * uBloom ) * uExposure;
        c = toSRGB( aces( c ) );
        float a = clamp( h.a, 0.0, 1.0 );
        float n = hash( gl_FragCoord.xy + uSeed * 61.0 ) - 0.5;
        c += ( n * uGrain * a + ( hash( gl_FragCoord.yx * 1.37 + uSeed ) - 0.5 ) / 255.0 * step( 0.004, a ) ) ;
        gl_FragColor = vec4( max( c, 0.0 ), a );
      }`,
    depthTest: false, depthWrite: false,
  }));

  // ---------- sizing ----------
  let W = 1, H = 1, dpr = 1, layout = 'desk';
  const size = { w: 0, h: 0 };
  function resize(w, h, forceLayout) {
    W = Math.max(1, Math.round(w)); H = Math.max(1, Math.round(h));
    layout = forceLayout || (W / H < 0.82 ? 'phone' : 'desk');
    // pixel budget: ≤ 3.0 MP at rest (≈ 1.55 MP while moving, see motionScale) — the DV49 rule of thumb on the M1 Pro at 120 Hz
    const budget = dbg.has('mp') ? +dbg.get('mp') * 1e6 : 3.0e6;
    dpr = Math.min(maxDpr, window.devicePixelRatio || 1, Math.sqrt(budget / (W * H)));
    dpr = Math.max(0.75, dpr * qualityScale);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    size.w = pw; size.h = ph;
    rtScene.setSize(pw, ph); hist[0].setSize(pw, ph); hist[1].setSize(pw, ph);
    let bw = pw, bh = ph;
    bw >>= 1; bh >>= 1;                                  // the chain starts at a quarter: bloom is soft, the first half-res level was 1/3 of its cost
    for (const rt of bloomRT) { bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1); rt.setSize(bw, bh); }
    camera.aspect = W / H;
    invalidate();
  }

  // ---------- camera ----------
  const rig = { yaw: 0, pitch: 0, px: 0, py: 0 };
  function placeCamera(p, jx = 0, jy = 0) {
    const s = shotAt(SHOTS[layout], p);
    // a short screen keeps the watch whole: pull back a little below 760 px tall
    const tall = layout === 'desk' ? Math.min(1, Math.max(0.82, H / 900)) : 1;
    const wide = layout === 'desk' ? Math.min(1, Math.max(0.78, (W / H) / 1.45)) : Math.min(1, Math.max(0.8, (W / H) / 0.46));
    const yaw = (s.yaw + rig.px * 2.6) * DEG, pitch = (s.pitch - rig.py * 1.8) * DEG, d = centre ? s.dist * 0.72 : s.dist / Math.min(tall, wide);
    camera.position.set(s.tgt[0] + Math.sin(yaw) * Math.cos(pitch) * d, s.tgt[1] + Math.sin(pitch) * d, s.tgt[2] + Math.cos(yaw) * Math.cos(pitch) * d);
    camera.up.set(0, 1, 0);
    camera.lookAt(s.tgt[0], s.tgt[1], s.tgt[2]);
    camera.updateProjectionMatrix();
    const e = camera.projectionMatrix.elements;
    const shiftX = layout === 'desk' ? s.shift[0] * Math.min(1, (W / H) / 1.3) : s.shift[0];
    e[8] = -(centre ? -0.02 : shiftX) * 2 + jx * 2 / size.w;
    e[9] = -(centre ? 0.02 : s.shift[1]) * 2 + jy * 2 / size.h;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  // ---------- loop state ----------
  let qualityScale = 1;
  const st = {
    target: 0, shown: 0, pointer: [0, 0], pointerShown: [0, 0], samples: 0, maxSamples: 16, lastRender: 0, lastSec: -1,
    raf: 0, shadowTick: 0, motionScale: 0.72, histValid: false, visible: true, running: false, needReset: true, breathe: !reduced, onFrame: null, frames: [], longFrames: 0,
  };
  watch.state.breathe = reduced ? 0 : 1;
  const clock0 = performance.now();

  function invalidate() { st.needReset = true; wake(); }
  function wake() { if (!st.raf && st.visible) st.raf = requestAnimationFrame(frame); }

  let lastPoseKey = '';
  let stopAt = 9;
  // dynamic resolution: while things move the scene renders into a smaller window of the same target (no reallocation);
  // when everything is still it renders at full size and the jittered samples converge to a supersampled frame
  function renderSample(jitter, w, scale = 1) {
    const k = jitter ? st.samples : 0;
    const vw = Math.max(1, Math.round(size.w * scale)), vh = Math.max(1, Math.round(size.h * scale));
    const jx = jitter ? halton(k + 1, 2) - 0.5 : 0, jy = jitter ? halton(k + 1, 3) - 0.5 : 0;
    placeCamera(st.shown, jx * size.w / vw, jy * size.h / vh);
    rtScene.viewport.set(0, 0, vw, vh); rtScene.scissor.set(0, 0, vw, vh); rtScene.scissorTest = scale < 1;
    renderer.setRenderTarget(rtScene); renderer.clear(); renderer.render(scene, camera);
    if (stopAt <= 1) return;
    // history: a moving frame skips it (it would be thrown away next frame); a still frame blends into it
    let src, sx = 1, sy = 1;
    if (w >= 1 && scale < 1) { src = rtScene.texture; sx = vw / size.w; sy = vh / size.h; st.histValid = false; }
    else {
      const prev = hist[histI], next = hist[1 - histI];
      blend.material.uniforms.tCur.value = rtScene.texture; blend.material.uniforms.tPrev.value = prev.texture; blend.material.uniforms.uW.value = w; blend.material.uniforms.uScale.value.set(vw / size.w, vh / size.h);
      renderer.setRenderTarget(next); blend.render(renderer);
      histI = 1 - histI; src = next.texture; st.histValid = true;
    }
    const shown = src;
    if (stopAt <= 2) return;
    // bloom
    out.material.uniforms.uHistScale.value.set(sx, sy);
    if (dbg.has('nobloom')) { out.material.uniforms.tHist.value = shown; out.material.uniforms.tBloom.value = bloomRT[LEVELS - 1].texture; renderer.setRenderTarget(null); out.render(renderer); return; }
    let sw = size.w, sh = size.h;
    for (let i = 0; i < LEVELS; i++) {
      down.material.uniforms.tSrc.value = src; down.material.uniforms.uTexel.value.set((i ? 1 : 1.5) / sw, (i ? 1 : 1.5) / sh); down.material.uniforms.uPrefilter.value = i === 0 ? 1 : 0; down.material.uniforms.uSrcScale.value.set(i ? 1 : sx, i ? 1 : sy);
      renderer.setRenderTarget(bloomRT[i]); down.render(renderer);
      src = bloomRT[i].texture; sw = bloomRT[i].width; sh = bloomRT[i].height;
    }
    for (let i = LEVELS - 1; i > 0; i--) {
      up.material.uniforms.tSrc.value = bloomRT[i].texture; up.material.uniforms.uTexel.value.set(1 / bloomRT[i].width, 1 / bloomRT[i].height);
      renderer.setRenderTarget(bloomRT[i - 1]); renderer.autoClear = false; up.render(renderer); renderer.autoClear = true;
    }
    if (stopAt <= 3) return;
    out.material.uniforms.tHist.value = shown; out.material.uniforms.tBloom.value = bloomRT[0].texture; out.material.uniforms.uSeed.value = (st.samples % 7) + 1;
    renderer.setRenderTarget(null); out.render(renderer);
  }

  let lastT = performance.now();
  function frame(now) {
    st.raf = 0;
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    const t = (now - clock0) / 1000;
    // smoothing toward the scroll target and the pointer (critically damped feel)
    const k = reduced ? 1 : 1 - Math.exp(-dt * 7.5);
    const dp = st.target - st.shown;
    st.shown = Math.abs(dp) < 1e-4 ? st.target : st.shown + dp * k;
    const kp = 1 - Math.exp(-dt * 5);
    let pMoving = false;
    for (const i of [0, 1]) { const d = st.pointer[i] - st.pointerShown[i]; if (Math.abs(d) > 1e-3) { st.pointerShown[i] += d * kp; pMoving = true; } else st.pointerShown[i] = st.pointer[i]; }
    rig.px = st.pointerShown[0]; rig.py = st.pointerShown[1];

    const flags = watch.update(st.shown, new Date(), t, { reduced });
    const scrolling = Math.abs(dp) >= 1e-4;
    const tick = flags.alive && flags.sec !== st.lastSec; st.lastSec = flags.sec;
    const poseMoving = scrolling || flags.running;              // parts move fast enough to need a fresh frame
    const breathing = st.breathe && flags.flying;               // slow drift of the exploded parts (sub-pixel per frame)
    let rendered = false;
    if (!st.histValid && !poseMoving && !pMoving) st.needReset = true;   // came to rest after scaled frames: start clean at full size
    if (st.needReset || poseMoving || pMoving || tick) {
      // shadows follow the parts; while scrolling they refresh every other frame (sub-pixel lag, half the cost)
      if (st.needReset || tick || ((scrolling || flags.running) && (st.shadowTick = (st.shadowTick + 1) % 2) === 0)) renderer.shadowMap.needsUpdate = true;
      st.samples = 0; renderSample(false, 1, poseMoving || pMoving ? st.motionScale : 1); st.samples = 1; st.needReset = false; rendered = true;
    } else if (st.samples < (flags.alive ? 5 : st.maxSamples)) {   // ticking: a few samples per beat, not sixteen
      if (breathing || st.samples === 1) renderer.shadowMap.needsUpdate = true;
      renderSample(true, 1 / (st.samples + 1)); st.samples++; rendered = true;
    } else if (breathing && now - st.lastRender > 90) {
      renderer.shadowMap.needsUpdate = true;
      renderSample(true, 1 / st.maxSamples); rendered = true;
    }
    if (rendered) st.lastRender = now;
    if (st.onFrame) st.onFrame(st.shown, flags);
    const more = scrolling || pMoving || flags.running || flags.alive || breathing || st.samples < (flags.alive ? 5 : st.maxSamples);
    if (more && st.visible) st.raf = requestAnimationFrame(frame);
  }

  // pre-compile every program (hidden parts included) before the first visible frame
  function warm() {
    resize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
    placeCamera(0);
    renderer.compile(scene, camera);
    renderer.shadowMap.needsUpdate = true;
    renderSample(false, 1);
  }

  return {
    renderer, scene, camera, watch, materials: M,
    resize, warm, invalidate, wake,
    setProgress(p) { st.target = Math.min(1, Math.max(0, p)); wake(); },
    jumpProgress(p) { st.target = st.shown = Math.min(1, Math.max(0, p)); invalidate(); },
    setPointer(x, y) { if (reduced) return; st.pointer[0] = x; st.pointer[1] = y; wake(); },
    setVisible(v) { st.visible = v; if (v) wake(); },
    setQuality(q) { qualityScale = q; resize(W, H); },
    get layout() { return layout; },
    get progress() { return st.shown; },
    onFrame(fn) { st.onFrame = fn; },
    get dpr() { return dpr; },
    _render(jitter = false, upTo = 9, scale = 1) { stopAt = upTo; renderSample(jitter, 1, scale); stopAt = 9; },
    _post: { rtScene, out, blend, bloom0: bloomRT[0], hist },
    st,
  };
}
