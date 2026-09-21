import { type Key } from '@lichess-org/chessground/types';
import * as THREE from 'three';

import { createMoveDestinationHighlightMarker } from '../objects/createMarkers.js';

import { coordinatesToSquare, parseSquare, pieceCodes } from './util.js';

function getSquareCoordinate(value: number): number {
  return Math.round(value + 3.5) - 3.5;
}

function getPieceAtSquare(
  scene: THREE.Scene,
  x: number,
  z: number,
  ignorePiece?: THREE.Mesh,
): THREE.Mesh | null {
  let pieceAtSquare: THREE.Mesh | null = null;

  scene.traverse(obj => {
    if (pieceAtSquare || !(obj instanceof THREE.Mesh) || !pieceCodes.has(obj.name) || obj === ignorePiece) {
      return;
    }

    if (Math.abs(obj.position.x - x) < 0.001 && Math.abs(obj.position.z - z) < 0.001) {
      pieceAtSquare = obj;
    }
  });

  return pieceAtSquare;
}

export function clearMoveDestinationHighlights(highlightGroup: THREE.Group) {
  highlightGroup.clear();
}

export function updateMoveDestinationHighlights(
  scene: THREE.Scene,
  highlightGroup: THREE.Group,
  selectedPiece: THREE.Mesh | null,
  allowedMoveDests?: Map<Key, readonly Key[]>,
  fromSquareOverride?: Key,
) {
  clearMoveDestinationHighlights(highlightGroup);
  if (!selectedPiece) {
    return;
  }

  const fromSquare =
    fromSquareOverride ||
    coordinatesToSquare(
      getSquareCoordinate(selectedPiece.position.x),
      getSquareCoordinate(selectedPiece.position.z),
    );
  const destinationSquares = allowedMoveDests?.get(fromSquare);
  if (!destinationSquares?.length) {
    return;
  }

  for (const square of destinationSquares) {
    const coordinates = parseSquare(square);
    if (!coordinates) {
      continue;
    }

    const occupyingPiece = getPieceAtSquare(scene, coordinates.x, coordinates.z, selectedPiece);
    const marker = createMoveDestinationHighlightMarker(!!occupyingPiece);
    marker.position.x = coordinates.x;
    marker.position.z = coordinates.z;
    highlightGroup.add(marker);
  }
}
