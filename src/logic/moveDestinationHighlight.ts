import { type Key } from '@lichess-org/chessground/types';
import type * as THREE from 'three';

import { createMoveDestinationHighlightMarker } from '../objects/createMarkers';

import { coordinatesToSquare, getPieceAtSquare, parseSquare } from './util';

function getSquareCoordinate(value: number): number {
  return Math.round(value + 3.5) - 3.5;
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
