// DV65 · watchmaking finishes as shader patches on MeshPhysicalMaterial (three r186).
// Approach adapted from DV04 CALIBRE's shader-patches.js (our own code): one shared onBeforeCompile per mode with a
// constant program cache key, every tunable value a uniform. r186 stretches the GGX lobe along material.anisotropyT, so T
// is set PERPENDICULAR to the grooves: highlights then run across the grooves (turned wheels, sunray bow-tie).
//
// Modes (named after the groove / brushing direction, as a watchmaker would):
//   tangential  circular graining round the object's own z axis (wheels, barrel)
//   radial      soleil: grooves along the radius (ratchet wheel, crown wheel)
//   sunray      the dial: radial grooves + a per-angle groove relief + fumé darkening toward the rim
//   cotes       Côtes de Genève: parallel bands across the bridges / rotor, each band a softly curved surface
//   perlage     overlapping circular spots on the main plate (procedural, no texture)
//   glass       sapphire: no aniso; grazing-angle boost and an env gain (used with additive-premultiplied blending)
import * as THREE from 'three';

const ANISO = new Set(['tangential', 'radial', 'sunray', 'cotes', 'perlage']);

const GROOVE = {
  tangential: 'vec3( - vWPos.y, vWPos.x, 0.0 )',
  radial: 'vec3( vWPos.x, vWPos.y, 0.0 )',
  sunray: 'vec3( vWPos.x, vWPos.y, 0.0 )',
  cotes: 'vec3( uCotesDir, 0.0 )',
  perlage: 'wPerlageGroove()',
};

function rep(src, target, add, where) {
  if (!src.includes(target)) throw new Error(`patches: '${target}' missing in ${where}`);
  return src.replace(target, add);
}

function vertex(src, mode) {
  let s = rep(src, '#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWX; varying vec3 vWY; varying vec3 vWZ;`, 'vertex');
  s = rep(s, '#include <begin_vertex>', `#include <begin_vertex>
	vWPos = transformed;
	{ mat3 m = mat3( modelViewMatrix ); vWX = m[ 0 ]; vWY = m[ 1 ]; vWZ = m[ 2 ]; }`, 'vertex');
  return s;
}

function fragment(src, mode) {
  let decl = `#include <common>
varying vec3 vWPos;
varying vec3 vWX; varying vec3 vWY; varying vec3 vWZ;
uniform float uGlint;
float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`;
  if (mode === 'sunray') decl += `
uniform sampler2D uSunrayNoise; uniform float uSunrayStrength; uniform float uFume; uniform float uDialR;`;
  if (mode === 'cotes') decl += `
uniform vec2 uCotesDir; uniform float uCotesWidth; uniform float uCotesTilt;`;
  if (mode === 'perlage') decl += `
uniform float uPerlageCell;
vec3 wSpot() {
	// the top-most spot covering this point; rows are laid bottom to top, each row offset by half a cell
	vec2 p = vWPos.xy / uPerlageCell;
	float row0 = floor( p.y );
	vec3 best = vec3( 0.0, 0.0, -1.0 );
	float bestOrder = -1e9;
	for ( int j = -1; j <= 1; j ++ ) {
		float row = row0 + float( j );
		float off = mod( row, 2.0 ) * 0.5;
		float col0 = floor( p.x - off );
		for ( int i = -1; i <= 1; i ++ ) {
			float col = col0 + float( i );
			vec2 c = vec2( col + off + 0.5, row + 0.5 );
			float d = length( p - c );
			float order = row * 4096.0 + col;
			if ( d < 0.78 && order > bestOrder ) { bestOrder = order; best = vec3( p - c, wHash( c ) ); }
		}
	}
	return best;
}
vec3 wPerlageGroove() { vec3 s = wSpot(); return vec3( - s.y, s.x, 0.0 ); }`;
  if (mode === 'glass') decl += `
uniform float uGrazing; uniform float uEnvGain;`;
  let s = rep(src, '#include <common>', decl, 'fragment');

  if (mode === 'sunray') {
    s = rep(s, '#include <color_fragment>', `#include <color_fragment>
	{
		float r = length( vWPos.xy ) / uDialR;
		diffuseColor.rgb *= mix( 1.0, 0.06, uFume * smoothstep( 0.22, 1.05, r ) );
		diffuseColor.rgb *= 1.0 + 0.25 * ( 1.0 - smoothstep( 0.0, 0.35, r ) );
	}`, 'fragment');
  }
  if (mode === 'perlage') {
    s = rep(s, '#include <color_fragment>', `#include <color_fragment>
	diffuseColor.rgb *= 0.99 + 0.02 * wSpot().z;`, 'fragment');
  }

  if (mode === 'sunray') {
    s = rep(s, '#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	{
		float r2 = max( dot( vWPos.xy, vWPos.xy ), 1e-6 );
		vec3 px = dFdx( vWPos ); vec3 py = dFdy( vWPos );
		float ax = ( vWPos.x * px.y - vWPos.y * px.x ) / r2 / 6.28318530718;
		float ay = ( vWPos.x * py.y - vWPos.y * py.x ) / r2 / 6.28318530718;
		float a = atan( vWPos.y, vWPos.x ) / 6.28318530718 + 0.5;
		float h0 = textureGrad( uSunrayNoise, vec2( a - 0.5 / 2048.0, 0.5 ), vec2( ax, 0.0 ), vec2( ay, 0.0 ) ).r;
		float h1 = textureGrad( uSunrayNoise, vec2( a + 0.5 / 2048.0, 0.5 ), vec2( ax, 0.0 ), vec2( ay, 0.0 ) ).r;
		vec3 t = vWX * ( - vWPos.y ) + vWY * vWPos.x;
		float tl = length( t );
		if ( tl > 1e-5 ) normal = normalize( normal + ( t / tl ) * ( h1 - h0 ) * uSunrayStrength );
	}`, 'fragment');
  }
  if (mode === 'cotes') {
    s = rep(s, '#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	{
		// only on faces looking along +z (the decorated top); sides and bevels stay plain polished
		vec3 nObj = normalize( vec3( dot( normal, vWX ), dot( normal, vWY ), dot( normal, vWZ ) ) );
		float top = smoothstep( 0.7, 0.95, nObj.z );
		vec2 perp = vec2( - uCotesDir.y, uCotesDir.x );
		float sCoord = dot( vWPos.xy, perp ) / uCotesWidth;
		float fw = fwidth( sCoord );
		float f = fract( sCoord ) - 0.5;
		float tilt = f * 2.0 * uCotesTilt * ( 1.0 - smoothstep( 0.25, 0.6, fw ) );
		vec3 pv = vWX * perp.x + vWY * perp.y;
		normal = normalize( normal + normalize( pv ) * tilt * top );
	}`, 'fragment');
  }
  if (mode === 'perlage') {
    s = rep(s, '#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	{
		vec3 sp = wSpot();
		vec3 rv = vWX * sp.x + vWY * sp.y;
		normal = normalize( normal - rv * 0.0 );
	}`, 'fragment');
  }

  let phys = THREE.ShaderChunk.lights_physical_fragment;
  if (ANISO.has(mode)) {
    const target = `	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;`;
    let extra = '';
    if (mode === 'cotes') extra = `
		{ vec3 nObj = normalize( vec3( dot( normal, vWX ), dot( normal, vWY ), dot( normal, vWZ ) ) );
		  material.anisotropy *= smoothstep( 0.7, 0.95, nObj.z );
		  material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) ); }`;
    if (mode === 'perlage') extra = `
		material.anisotropy *= smoothstep( 0.05, 0.3, length( wSpot().xy ) );
		material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
		material.anisotropy *= 0.8;`;
    phys = rep(phys, target, `	{
		vec3 g = ${GROOVE[mode]};
		vec3 gv = vWX * g.x + vWY * g.y + vWZ * g.z;
		vec3 t = cross( normal, gv );
		float l = length( t );
		// at a groove singularity (a wheel's centre) fall back to any perpendicular; tbn from uv derivatives can be NaN there
		t = l > 1e-6 ? t / l : normalize( cross( normal, abs( normal.x ) < 0.9 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 ) ) );
		material.anisotropyT = t;
		material.anisotropyB = normalize( cross( normal, t ) );${extra}
	}`, 'lights_physical_fragment');
  }
  if (mode === 'glass') {
    phys += `
	{ float nv = saturate( dot( normal, normalize( vViewPosition ) ) );
	  material.specularF90 *= mix( uGrazing, 1.0, smoothstep( 0.05, 0.6, nv ) ); }`;
  }
  s = rep(s, '#include <lights_physical_fragment>', phys, 'fragment');
  if (mode === 'glass') {
    s = rep(s, '#include <lights_fragment_maps>', `#include <lights_fragment_maps>
	radiance *= uEnvGain;`, 'fragment');
  }
  // lock glint: a brief lift of the specular response, driven by scroll (uGlint 0..1)
  s = rep(s, '#include <opaque_fragment>', `outgoingLight *= 1.0 + uGlint * 0.9;
#include <opaque_fragment>`, 'fragment');
  return s;
}

function uniformsFor(mode) {
  const u = { uGlint: { value: 0 } };
  if (mode === 'sunray') Object.assign(u, { uSunrayNoise: { value: null }, uSunrayStrength: { value: 0.22 }, uFume: { value: 1 }, uDialR: { value: 16.4 } });
  if (mode === 'cotes') Object.assign(u, { uCotesDir: { value: new THREE.Vector2(Math.cos(0.5), Math.sin(0.5)) }, uCotesWidth: { value: 1.7 }, uCotesTilt: { value: 0.45 } });
  if (mode === 'perlage') Object.assign(u, { uPerlageCell: { value: 1.05 } });
  if (mode === 'glass') Object.assign(u, { uGrazing: { value: 1 }, uEnvGain: { value: 1 } });
  return u;
}

const HOOKS = {};
for (const mode of ['surface', ...ANISO, 'glass']) {
  HOOKS[mode] = function onBeforeCompile(shader) {
    Object.assign(shader.uniforms, this.userData.u);
    shader.vertexShader = vertex(shader.vertexShader, mode);
    shader.fragmentShader = fragment(shader.fragmentShader, mode);
  };
}

/** Attach a patch; per-material uniform objects live in material.userData.u (set .value, never recompiles). */
export function patch(material, mode = 'surface') {
  material.onBeforeCompile = HOOKS[mode];
  material.customProgramCacheKey = () => `dv65-${mode}`;
  material.userData.mode = mode;
  material.userData.u = uniformsFor(mode);
  return material;
}

/** A clone that keeps the hook but owns its uniforms (for per-unit lock glints). */
export function clonePatched(m) {
  const u = m.userData.u;
  m.userData.u = undefined;
  const c = m.clone();
  m.userData.u = u;
  patch(c, m.userData.mode);
  for (const k of Object.keys(u)) c.userData.u[k].value = u[k].value && u[k].value.clone && !u[k].value.isTexture ? u[k].value.clone() : u[k].value;
  return c;
}
