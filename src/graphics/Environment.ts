import * as THREE from 'three';
import { createSky, type SkyTheme } from './Sky';
import { Rng } from '../core/utils';

/**
 * Builds a PMREM environment map from a small procedural "light studio" scene so that
 * PBR paint, glass and wet roads get believable reflections for each theme.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer, theme: SkyTheme): THREE.Texture {
  const scene = new THREE.Scene();
  const sky = createSky(theme, 100);
  sky.material.depthTest = false;
  scene.add(sky);
  const panel = (w: number, h: number, color: string, intensity: number, pos: THREE.Vector3, look = new THREE.Vector3()) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.copy(pos);
    m.lookAt(look);
    scene.add(m);
    return m;
  };
  const rng = new Rng(42);
  switch (theme) {
    case 'showroom': {
      // ceiling light strips
      for (let i = -2; i <= 2; i++) panel(2.2, 40, '#ffffff', 5, new THREE.Vector3(i * 6, 22, 0), new THREE.Vector3(i * 6, 0, 0));
      // large softboxes
      panel(26, 10, '#ffffff', 1.6, new THREE.Vector3(30, 8, 0));
      panel(26, 10, '#ffffff', 1.2, new THREE.Vector3(-30, 8, 0));
      panel(30, 8, '#dfe8ff', 1.0, new THREE.Vector3(0, 7, 34));
      // accent neon
      panel(40, 0.8, '#29e8ff', 3, new THREE.Vector3(0, 2, -32));
      panel(40, 0.8, '#ff2d95', 2.5, new THREE.Vector3(0, 4, 32));
      // floor
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: '#0b0c10' }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1;
      scene.add(floor);
      break;
    }
    case 'tokyo': {
      const cols = ['#ff2d95', '#29e8ff', '#ffb000', '#b18cff', '#ffffff', '#5fa8ff'];
      for (let i = 0; i < 70; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(30, 60);
        const y = rng.range(-2, 22);
        panel(rng.range(1, 6), rng.range(1, 8), rng.pick(cols), rng.range(1.2, 3.2), new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      // building window glow
      for (let i = 0; i < 40; i++) {
        const a = rng.range(0, Math.PI * 2);
        panel(rng.range(4, 10), rng.range(10, 40), '#ffd9a0', 0.25, new THREE.Vector3(Math.cos(a) * 70, 10, Math.sin(a) * 70));
      }
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ color: '#07070b' }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1.5;
      scene.add(floor);
      break;
    }
    case 'canyon': {
      // red rock walls reflected
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        panel(30, 18, '#7a3a20', 0.6, new THREE.Vector3(Math.cos(a) * 60, 6, Math.sin(a) * 60));
      }
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ color: '#5a3324' }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1.5;
      scene.add(floor);
      break;
    }
    case 'skyline': {
      for (let i = 0; i < 16; i++) {
        const a = rng.range(0, Math.PI * 2);
        panel(rng.range(4, 9), rng.range(20, 60), '#c8d8ee', 0.9, new THREE.Vector3(Math.cos(a) * 65, rng.range(-10, 20), Math.sin(a) * 65));
      }
      break;
    }
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.035, 0.1, 400);
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}
