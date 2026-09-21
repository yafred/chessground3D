import type { Key } from '@lichess-org/chessground/types';
import { key2pos } from '@lichess-org/chessground/util';

export const pieceCodes = new Set(['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p']);

export function coordinatesToSquare(x: number, z: number): Key {
  const fileIndex = Math.round(x + 3.5);
  const rank = Math.round(4.5 - z);
  return (String.fromCharCode('a'.charCodeAt(0) + fileIndex) + rank) as Key;
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

export function parseSquare(square: string): { x: number; z: number } | null {
  const normalized = square.trim().toLowerCase();
  if (!/^[a-h][1-8]$/.test(normalized)) {
    return null;
  }

  const fileIndex = normalized.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number.parseInt(normalized[1], 10);
  return {
    x: fileIndex - 3.5,
    z: 4.5 - rank,
  };
}
