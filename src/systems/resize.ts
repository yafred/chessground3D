import type * as THREE from 'three';

export function handleResize(
  sceneElement: HTMLElement,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  cssVarsTarget?: HTMLElement,
) {
  const resize = () => {
    const { width, height } = sceneElement.getBoundingClientRect();
    if (width === 0 || height === 0) {
      return;
    }
    cssVarsTarget?.style.setProperty('---cg-width', `${width}px`);
    cssVarsTarget?.style.setProperty('---cg-height', `${height}px`);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };

  resize();
  window.addEventListener('resize', resize);

  const observer = new ResizeObserver(resize);
  observer.observe(sceneElement);

  return () => {
    window.removeEventListener('resize', resize);
    observer.disconnect();
  };
}
