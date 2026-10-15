import { type Key, type Pieces } from '@lichess-org/chessground/types';
import { key2pos } from '@lichess-org/chessground/util';
import * as THREE from 'three';

const pieceRoleMap: Record<string, string> = {
  pawn: 'Pawn',
  knight: 'Knight',
  bishop: 'Bishop',
  rook: 'Rook',
  queen: 'Queen',
  king: 'King',
};

const pieceCodeMap: Record<string, string> = {
  pawn: 'P',
  knight: 'N',
  bishop: 'B',
  rook: 'R',
  queen: 'Q',
  king: 'K',
};

export function piecesToScene(
  pieces: Pieces,
  board: THREE.Group,
  pieceTemplates: Map<string, THREE.Mesh>,
  materialTemplates: Map<string, THREE.Material>,
  preservedPieceSquares: ReadonlySet<Key> = new Set(),
) {
  // Remove clones previously created.
  for (let i = board.children.length - 1; i >= 0; i--) {
    const child = board.children[i];
    if (child.userData?.isClone) {
      if (child instanceof THREE.Mesh) {
        if (Array.isArray(child.material)) {
          child.material.forEach(material => material.dispose());
        } else {
          child.material.dispose();
        }
      }
      board.remove(child);
    }
  }

  for (const [key, piece] of pieces) {
    if (preservedPieceSquares.has(key)) {
      continue;
    }

    const pieceName = pieceRoleMap[piece.role];
    const pieceMesh = pieceName ? pieceTemplates.get(pieceName) : undefined;
    if (!pieceMesh) {
      continue;
    }

    const pos = key2pos(key);
    const clone = pieceMesh.clone();
    clone.userData.isClone = true;
    clone.position.set(pos[0] - 3.5, 0, 7 - pos[1] - 3.5);

    const code = pieceCodeMap[piece.role] ?? 'P';
    clone.name = piece.color === 'white' ? code : code.toLowerCase();

    // Reminder: X: horizontal positive to the right, Y: vertical positive up, Z: horizontal positive towards the camera
    const materialName = piece.color === 'white' ? 'white piece' : 'black piece';
    const material = materialTemplates.get(materialName);
    if (material) {
      clone.material = material.clone();
    } else if (Array.isArray(clone.material)) {
      clone.material = clone.material.map(m => m.clone());
    } else {
      clone.material = clone.material.clone();
    }

    clone.visible = true;
    board.add(clone);
  }
}
