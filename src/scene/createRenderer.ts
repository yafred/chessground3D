import * as THREE from 'three';

export function createRenderer(sceneElement: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(sceneElement.clientWidth, sceneElement.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // Set background to transparent 
  sceneElement.appendChild(renderer.domElement);
  return renderer;
}
