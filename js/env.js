// DV65 · a procedural photo studio for image-based lighting: black room, a warm key softbox high on the right, a tall
// neutral strip on the left, an overhead strip, a warm rim behind, a small kicker for sparkle. Rendered once to PMREM.
import * as THREE from 'three';

export function makeStudioEnv(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  const panel = (w, h, pos, col, intensity, soft = false) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(col[0] * intensity, col[1] * intensity, col[2] * intensity), side: THREE.DoubleSide });
    if (soft) {
      // a softbox: bright centre, falling off to the edges (reads as a real diffuser in reflections)
      mat.onBeforeCompile = (s) => {
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vQ;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvQ = uv * 2.0 - 1.0;');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vQ;')
          .replace('#include <opaque_fragment>', 'outgoingLight *= ( 1.0 - 0.55 * pow( max( abs( vQ.x ), abs( vQ.y ) ), 3.0 ) ) * smoothstep( 1.0, 0.92, max( abs( vQ.x ), abs( vQ.y ) ) );\n#include <opaque_fragment>');
      };
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos); m.lookAt(0, 0, 0);
    scene.add(m);
    return m;
  };
  // the room itself: never pure black, a touch lighter overhead (keeps polished steel from reading as black glass)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main() { vP = normalize( position ); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: 'varying vec3 vP; void main() { float h = vP.y * 0.5 + 0.5; float u = smoothstep( 0.35, 1.0, h ); vec3 c = mix( vec3( 0.004, 0.0035, 0.003 ), vec3( 0.09, 0.08, 0.07 ), smoothstep( 0.2, 0.55, h ) ); c = mix( c, vec3( 0.55, 0.5, 0.44 ), u * u ); gl_FragColor = vec4( c, 1.0 ); }',
  }));
  scene.add(dome);
  panel(10, 8, [11, 6, 4.5], [1.0, 0.9, 0.78], 2.4, true);        // big right softbox (beside the camera, off the dial's mirror line)
  panel(10, 8, [6, 9.5, 3], [1.0, 0.8, 0.6], 5.0, true);          // warm key softbox, high right
  panel(2.0, 14, [-9.5, 1.5, 4], [0.95, 0.97, 1.0], 4.0, true);   // tall strip, left
  panel(16, 1.6, [0, 11, -0.5], [1.0, 0.95, 0.9], 2.2, true);     // overhead strip
  panel(1.6, 12, [9, 0.5, -6.5], [1.0, 0.78, 0.55], 4.0, true);   // warm rim, behind right
  panel(1.4, 1.4, [-4.5, 6, 9.5], [1.0, 1.0, 1.0], 3.5);          // kicker: small hard sparkle
  panel(20, 7, [0, -9, 5], [0.55, 0.42, 0.3], 0.14);              // warm floor bounce
  panel(10, 8, [-6, 2, -8], [0.6, 0.7, 1.0], 0.45, true);         // cool back fill
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.0, 0.1, 100, { size: 512 });
  pmrem.dispose();
  scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return rt.texture;
}
