import * as THREE from 'three';

import { pieceCodes } from './util';

export type PieceHoverController = {
  updateFromPointerEvent: (event: PointerEvent) => void;
  update: () => void;
  setEnabled: (enabled: boolean) => void;
  setDraggedPiece: (piece: THREE.Mesh | null) => void;
  setIgnoredPiece: (piece: THREE.Mesh | null) => void;
};

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

export function createPieceHoverController(
  scene: THREE.Scene,
  camera: THREE.Camera,
  domElement: HTMLElement,
  board: THREE.Object3D,
): PieceHoverController {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const boardPoint = new THREE.Vector3();
  let enabled = true;
  let hasPointerPosition = false;
  let draggedPiece: THREE.Mesh | null = null;
  let ignoredPiece: THREE.Mesh | null = null;
  const squareHighlight = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: '#f7e27f',
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  squareHighlight.rotation.x = -Math.PI / 2;
  squareHighlight.position.y = 0.01;
  squareHighlight.visible = false;
  squareHighlight.renderOrder = 10;
  board.add(squareHighlight);

  function setEnabled(nextEnabled: boolean) {
    enabled = nextEnabled;
    if (!enabled) {
      squareHighlight.visible = false;
    }
  }

  function setDraggedPiece(piece: THREE.Mesh | null) {
    draggedPiece = piece;
    squareHighlight.visible = false;
  }

  function setIgnoredPiece(piece: THREE.Mesh | null) {
    ignoredPiece = piece;
  }

  function updateFromPointerEvent(event: PointerEvent) {
    const rect = domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    hasPointerPosition = true;
  }

  function update() {
    if (!enabled) {
      return;
    }

    if (!hasPointerPosition) {
      squareHighlight.visible = false;
      return;
    }

    if (draggedPiece && !draggedPiece.parent) {
      draggedPiece = null;
    }

    if (draggedPiece) {
      const squareX = Math.round(draggedPiece.position.x + 3.5) - 3.5;
      const squareZ = Math.round(draggedPiece.position.z + 3.5) - 3.5;
      if (Math.abs(squareX) <= 4 && Math.abs(squareZ) <= 4) {
        squareHighlight.position.x = squareX;
        squareHighlight.position.z = squareZ;
        squareHighlight.visible = true;
      } else {
        squareHighlight.visible = false;
      }

      return;
    }

    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObjects(scene.children, true);

    let hitPiece: THREE.Mesh | null = null;
    for (const intersection of hits) {
      const candidate = getPieceMeshFromObject(intersection.object);
      if (candidate && ignoredPiece && candidate === ignoredPiece) {
        continue;
      }
      if (candidate) {
        hitPiece = candidate;
        break;
      }
    }

    if (hitPiece) {
      squareHighlight.position.x = hitPiece.position.x;
      squareHighlight.position.z = hitPiece.position.z;
      squareHighlight.visible = true;
    } else {
      const hasBoardIntersection = raycaster.ray.intersectPlane(boardPlane, boardPoint) !== null;
      if (hasBoardIntersection) {
        board.worldToLocal(boardPoint);
      }
      if (hasBoardIntersection && Math.abs(boardPoint.x) <= 4 && Math.abs(boardPoint.z) <= 4) {
        squareHighlight.position.x = Math.round(boardPoint.x + 3.5) - 3.5;
        squareHighlight.position.z = Math.round(boardPoint.z + 3.5) - 3.5;
        squareHighlight.visible = true;
      } else {
        squareHighlight.visible = false;
      }
    }
  }

  return {
    updateFromPointerEvent,
    update,
    setEnabled,
    setDraggedPiece,
    setIgnoredPiece,
  };
}
