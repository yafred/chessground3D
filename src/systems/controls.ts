import type * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

function setLockedAzimuth(controls: OrbitControls, azimuth: number) {
  controls.minAzimuthAngle = azimuth;
  controls.maxAzimuthAngle = azimuth;
}

const STORAGE_KEY = 'chessground3d.view';

type SavedView = { position: number[]; target: number[]; zoom: number };

function isVec3(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
}

function loadView(camera: THREE.Camera, controls: OrbitControls) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const view = JSON.parse(raw) as SavedView;
    if (!isVec3(view.position) || !isVec3(view.target)) return;
    camera.position.set(...(view.position as [number, number, number]));
    controls.target.set(...(view.target as [number, number, number]));
    const cam = camera as THREE.PerspectiveCamera;
    if (typeof view.zoom === 'number' && Number.isFinite(view.zoom) && view.zoom > 0) {
      cam.zoom = view.zoom;
      cam.updateProjectionMatrix();
    }
    controls.update();
  } catch {}
}

function saveView(camera: THREE.Camera, controls: OrbitControls) {
  try {
    const view: SavedView = {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      zoom: (camera as THREE.PerspectiveCamera).zoom,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {}
}

export function createControls(camera: THREE.Camera, domElement: HTMLElement) {
  const controls = new OrbitControls(camera, domElement);
  controls.enabled = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  if (window.localStorage.getItem('chessground3d.free') !== 'true') {
    setLockedAzimuth(controls, controls.getAzimuthalAngle());
  }

  loadView(camera, controls);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  controls.addEventListener('change', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveView(camera, controls), 200);
  });
  return controls;
}
