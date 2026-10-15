import { type Key } from '@lichess-org/chessground/types';
import * as THREE from 'three';

import { coordinatesToSquare, pieceCodes } from '../logic/util.js';

function getPieceMeshFromObject(object: THREE.Object3D | null): THREE.Mesh | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current instanceof THREE.Mesh && pieceCodes.has(current.name)) {
      return current;
    }
    current = current.parent;
  }

  return null;
}

export function createSquarePicker(
  htmlElement: HTMLElement,
  scene: THREE.Scene,
  camera: THREE.Camera,
  board: THREE.Group,
): (pos: [number, number]) => Key | undefined {
  const pointerRaycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const boardPoint = new THREE.Vector3();

  return pos => {
    const rect = htmlElement.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return undefined;
    }

    pointerNdc.x = ((pos[0] - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((pos[1] - rect.top) / rect.height) * 2 + 1;
    pointerRaycaster.setFromCamera(pointerNdc, camera);

    // Prefer the piece under the pointer, so its square wins even if the ray also clips the board plane elsewhere.
    const pieceHit = pointerRaycaster
      .intersectObjects(scene.children, true)
      .map(hit => getPieceMeshFromObject(hit.object))
      .find((mesh): mesh is THREE.Mesh => mesh !== null);
    if (pieceHit) {
      const squareX = Math.round(pieceHit.position.x + 3.5) - 3.5;
      const squareZ = Math.round(pieceHit.position.z + 3.5) - 3.5;
      if (Math.abs(squareX) <= 4 && Math.abs(squareZ) <= 4) {
        return coordinatesToSquare(squareX, squareZ);
      }
    }

    const hasBoardIntersection = pointerRaycaster.ray.intersectPlane(boardPlane, boardPoint) !== null;
    if (!hasBoardIntersection) {
      return undefined;
    }
    board.worldToLocal(boardPoint);

    const boardX = boardPoint.x;
    const boardZ = boardPoint.z;
    if (Math.abs(boardX) > 4 || Math.abs(boardZ) > 4) {
      return undefined;
    }

    const squareX = Math.round(boardX + 3.5) - 3.5;
    const squareZ = Math.round(boardZ + 3.5) - 3.5;
    if (Math.abs(squareX) > 4 || Math.abs(squareZ) > 4) {
      return undefined;
    }

    return coordinatesToSquare(squareX, squareZ);
  };
}
