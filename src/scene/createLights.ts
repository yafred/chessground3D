import * as THREE from 'three';

export function createLights() {
  const group = new THREE.Group();

  // Soft environment approximation
  const hemi = new THREE.HemisphereLight("#bfd8ff", "#4a3b2f", 0.3);
  group.add(hemi);

  // Main light and shadows
  const key = new THREE.DirectionalLight("#ffffff", 2.2);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.intensity = 0.35;
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.02;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 30;
  group.add(key);

  // Optional rim light for dark pieces
  const rim = new THREE.DirectionalLight("#ffffff", 1.0);
  rim.position.set(-2, 5, -6);
  group.add(rim);
  return group;
}
