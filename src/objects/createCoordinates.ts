import type { Color } from '@lichess-org/chessground/types';
import * as THREE from 'three';

const COORDINATE_SIZE = 0.1;
const LABEL_COLOR = '#ffffff';

function createLabel(text: string, x: number, z: number) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create canvas context for board coordinates');
  }

  context.font = 'bold 128px sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  const metrics = context.measureText(text);
  const glyphWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  const glyphHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  const padding = 2;
  canvas.width = Math.ceil(glyphWidth + padding * 2);
  canvas.height = Math.ceil(glyphHeight + padding * 2);

  // context is reset by changing canvas width/height, so we need to set font and alignment again
  context.font = 'bold 128px sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = LABEL_COLOR;
  context.fillText(text, padding + metrics.actualBoundingBoxLeft, padding + metrics.actualBoundingBoxAscent);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(
      (COORDINATE_SIZE * canvas.width) / glyphHeight,
      (COORDINATE_SIZE * canvas.height) / glyphHeight,
    ),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;

  const label = new THREE.Group();
  label.position.set(x, 0.02, z);
  label.add(mesh);
  return label;
}

export function createCoordinateLabels() {
  const group = new THREE.Group();
  const labels: { group: THREE.Group; x: number; z: number; axis: 'file' | 'rank' }[] = [];

  for (let file = 0; file < 8; file++) {
    const x = file - 3.5;
    const label = createLabel(String.fromCharCode('A'.charCodeAt(0) + file), x, 4.15);
    labels.push({ group: label, x, z: 4.15, axis: 'file' });
    group.add(label);
  }

  for (let rank = 1; rank <= 8; rank++) {
    const z = 4.5 - rank;
    const label = createLabel(String(rank), 4.15, z);
    labels.push({ group: label, x: 4.15, z, axis: 'rank' });
    group.add(label);
  }

  return {
    group,
    setOrientation(orientation: Color) {
      const flip = orientation === 'black';
      for (const { group: label, x, z, axis } of labels) {
        label.position.set(
          flip && axis === 'rank' ? -x : x,
          0.02,
          flip && axis === 'file' ? -z : z,
        );
        label.rotation.y = flip ? -Math.PI : 0;
      }
    },
    dispose() {
      for (const { group: label } of labels) {
        const mesh = label.children[0];
        if (mesh instanceof THREE.Mesh) {
          mesh.geometry.dispose();
          const material = mesh.material;
          if (material instanceof THREE.Material) {
            if ('map' in material && material.map instanceof THREE.Texture) {
              material.map.dispose();
            }
            material.dispose();
          }
        }
      }
    },
  };
}
