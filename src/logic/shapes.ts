import { type DrawBrushes, type DrawShape } from '@lichess-org/chessground/draw';
import * as THREE from 'three';

import { createArrowMesh, createCircleMesh, createCustomSvgMesh } from '../objects/createShapes';

import { keyToCoordinates } from './util';

export function disposeShape(shape: THREE.Mesh) {
  shape.geometry.dispose();
  if (shape.material instanceof THREE.MeshBasicMaterial && shape.material.map) {
    shape.material.map.dispose();
  }
  (shape.material as THREE.Material).dispose();
}

export function clearShapes(group: THREE.Group) {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      disposeShape(child);
    }
  }
  group.clear();
}

function shapeKey(shape: DrawShape, brushes: DrawBrushes): string | undefined {
  const customSvg = shape.customSvg as string | { html?: string } | undefined;
  const brush = shape.brush ? brushes[shape.brush] : undefined;
  return JSON.stringify([
    shape.orig,
    shape.dest,
    customSvg ? (typeof customSvg === 'string' ? customSvg : customSvg.html) : undefined,
    brush?.color,
    brush?.opacity,
  ]);
}

function createShapeMesh(shape: DrawShape, brushes: DrawBrushes): THREE.Mesh | undefined {
  const orig = keyToCoordinates(shape.orig);
  if (!orig) {
    return undefined;
  }

  if (shape.customSvg) {
    const customSvg = shape.customSvg as string | { html?: string };
    const html = typeof customSvg === 'string' ? customSvg : customSvg.html;
    return html ? createCustomSvgMesh(orig.x, orig.z, html) : undefined;
  }

  if (!shape.brush) {
    return undefined;
  }

  const brush = brushes[shape.brush];
  if (!brush) {
    return undefined;
  }

  if (!shape.dest || shape.dest === shape.orig) {
    return createCircleMesh(orig.x, orig.z, brush.color, brush.opacity);
  }

  const dest = keyToCoordinates(shape.dest);
  if (!dest) {
    return undefined;
  }

  return createArrowMesh(orig.x, orig.z, dest.x, dest.z, brush.color, brush.opacity);
}

// Reuses meshes of unchanged shapes so they don't flicker when the same shapes are set again.
export function updateMeshesFromShapes(
  group: THREE.Group,
  shapes: readonly DrawShape[],
  brushes: DrawBrushes,
) {
  const existing = new Map<string, THREE.Mesh[]>();
  for (const child of group.children) {
    const key = child.userData.shapeKey as string | undefined;
    if (child instanceof THREE.Mesh && key !== undefined) {
      const list = existing.get(key) ?? [];
      list.push(child);
      existing.set(key, list);
    } else if (child instanceof THREE.Mesh) {
      disposeShape(child);
    }
  }

  const next: THREE.Mesh[] = [];
  for (const shape of shapes) {
    const key = shapeKey(shape, brushes);
    const reused = key === undefined ? undefined : existing.get(key)?.pop();
    if (reused) {
      next.push(reused);
      continue;
    }
    const mesh = createShapeMesh(shape, brushes);
    if (mesh) {
      mesh.userData.shapeKey = key;
      next.push(mesh);
    }
  }

  for (const list of existing.values()) {
    for (const mesh of list) {
      disposeShape(mesh);
    }
  }

  group.clear();
  if (next.length > 0) {
    group.add(...next);
  }
}
