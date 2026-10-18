import * as THREE from 'three';

export function createLights() {
  const group = new THREE.Group();

  // Soft environment approximation
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a3b2f, 0.3);
  group.add(hemi);

  // Main light and shadows
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  group.add(key);

  // Optional rim light for dark pieces
  const rim = new THREE.DirectionalLight(0xffffff, 1.0);
  rim.position.set(-2, 5, -6);
  group.add(rim);
  return group;
}
