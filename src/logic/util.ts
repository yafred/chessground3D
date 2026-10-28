import type { Key } from '@lichess-org/chessground/types';
import { key2pos } from '@lichess-org/chessground/util';
import * as THREE from 'three';

// Canvas smaller than this (px, shortest side) is treated as a smartphone.
export const SMALL_SCREEN_SIZE_PX = 500;

// Small canvas on a touch device (coarse primary pointer); a mouse on a small viewport doesn't count.
export function isSmallTouchScreen(width: number, height: number): boolean {
  return (
    Math.min(width, height) < SMALL_SCREEN_SIZE_PX &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export const pieceCodes = new Set(['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p']);

export function getPieceMeshFromObject(object: THREE.Object3D | null): THREE.Mesh | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current instanceof THREE.Mesh && pieceCodes.has(current.name)) {
      return current;
    }
    current = current.parent;
  }

  return null;
}

export function coordinatesToSquare(x: number, z: number): Key {
  const fileIndex = Math.round(x + 3.5);
  const rank = Math.round(4.5 - z);
  return (String.fromCharCode('a'.charCodeAt(0) + fileIndex) + rank) as Key;
}

export function getSquareCoordinate(value: number): number {
  return Math.round(value + 3.5) - 3.5;
}

export function isWithinBoard(x: number, z: number): boolean {
  return Math.abs(x) <= 4 && Math.abs(z) <= 4;
}

export function keyToCoordinates(key: Key): { x: number; z: number } | null {
  const pos = key2pos(key);
  if (!pos) {
    return null;
  }
  return {
    x: pos[0] - 3.5,
    z: 4.5 - (pos[1] + 1),
  };
}

export function getPieceAtSquare(
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
