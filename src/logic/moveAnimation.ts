import { type Key, type Piece, type Pieces } from '@lichess-org/chessground/types';
import { key2pos } from '@lichess-org/chessground/util';
import * as THREE from 'three';

import { coordinatesToSquare, keyToCoordinates, pieceCodes } from './util';

const roleCodes: Record<Piece['role'], string> = {
  pawn: 'P',
  knight: 'N',
  bishop: 'B',
  rook: 'R',
  queen: 'Q',
  king: 'K',
};

type MoveAnimation = {
  wrapper: THREE.Group;
  piece: THREE.Mesh;
  startOffset: THREE.Vector3;
  elapsed: number;
  destination: Key;
};

export type MoveAnimator = {
  animateMove: (
    piece: THREE.Mesh,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    destination: Key,
  ) => boolean;
  update: (deltaSeconds: number) => void;
  // Animates pieces that moved between two piece maps (e.g. after an external state change),
  // and returns the destination squares whose meshes must not be rebuilt.
  animatePieceChanges: (previousPieces: Pieces, currentPieces: Pieces) => Set<Key>;
  // Ends animations whose destination no longer holds a piece, and returns the squares still animating
  // so that their meshes are not rebuilt.
  syncWithPieces: (pieces: Pieces) => Set<Key>;
};

// Animates a piece (already at its destination in board coordinates) by offsetting it
// from its origin through a wrapper group, then easing the offset back to zero.
export function createMoveAnimator(board: THREE.Group, getDurationSeconds: () => number): MoveAnimator {
  const animationGroup = new THREE.Group();
  board.add(animationGroup);
  const animations: MoveAnimation[] = [];

  function finish(animation: MoveAnimation) {
    animation.wrapper.position.set(0, 0, 0);
    board.attach(animation.piece);
    animationGroup.remove(animation.wrapper);
    const index = animations.indexOf(animation);
    if (index !== -1) {
      animations.splice(index, 1);
    }
  }

  function animateMove(
    piece: THREE.Mesh,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    destination: Key,
  ) {
    if (getDurationSeconds() <= 0) {
      return false;
    }

    const previous = animations.find(animation => animation.piece === piece);
    if (previous) {
      finish(previous);
    }

    const wrapper = new THREE.Group();
    const startOffset = new THREE.Vector3(fromX - toX, 0, fromZ - toZ);
    wrapper.position.copy(startOffset);
    animationGroup.add(wrapper);
    wrapper.add(piece);
    animations.push({ wrapper, piece, startOffset, elapsed: 0, destination });
    return true;
  }

  function update(deltaSeconds: number) {
    if (animations.length === 0) {
      return;
    }

    const duration = getDurationSeconds();
    for (let i = animations.length - 1; i >= 0; i--) {
      const animation = animations[i];
      animation.elapsed = Math.min(animation.elapsed + deltaSeconds, duration);
      const progress = duration > 0 ? animation.elapsed / duration : 1;
      const easeOutProgress = 1 - (1 - progress) ** 3;
      animation.wrapper.position.copy(animation.startOffset).multiplyScalar(1 - easeOutProgress);
      if (progress === 1) {
        finish(animation);
      }
    }
  }

  function animatePieceChanges(previousPieces: Pieces, currentPieces: Pieces): Set<Key> {
    const meshesBySquare = new Map<Key, THREE.Mesh>();
    board.traverse(object => {
      if (object instanceof THREE.Mesh && pieceCodes.has(object.name)) {
        meshesBySquare.set(coordinatesToSquare(object.position.x, object.position.z), object);
      }
    });

    const origins: { key: Key; piece: Piece; mesh: THREE.Mesh }[] = [];
    for (const [key, piece] of previousPieces) {
      const current = currentPieces.get(key);
      const mesh = meshesBySquare.get(key);
      if (mesh && (!current || current.color !== piece.color || current.role !== piece.role)) {
        origins.push({ key, piece, mesh });
      }
    }
    const animatedSquares = new Set<Key>();
    const usedOrigins = new Set<Key>();

    for (const [destination, piece] of currentPieces) {
      const previous = previousPieces.get(destination);
      if (previous?.color === piece.color && previous.role === piece.role) continue;

      const target = keyToCoordinates(destination);
      if (!target) continue;

      const targetPos = key2pos(destination);
      const origin = origins
        .filter(
          candidate =>
            !usedOrigins.has(candidate.key) &&
            candidate.piece.color === piece.color &&
            candidate.piece.role === piece.role,
        )
        .sort((a, b) => {
          const aPos = key2pos(a.key);
          const bPos = key2pos(b.key);
          const aDistance = (aPos[0] - targetPos[0]) ** 2 + (aPos[1] - targetPos[1]) ** 2;
          const bDistance = (bPos[0] - targetPos[0]) ** 2 + (bPos[1] - targetPos[1]) ** 2;
          return aDistance - bDistance;
        })[0];
      if (!origin) continue;

      const source = board.worldToLocal(origin.mesh.getWorldPosition(new THREE.Vector3()));

      origin.mesh.position.set(target.x, 0, target.z);
      if (animateMove(origin.mesh, source.x, source.z, target.x, target.z, destination)) {
        usedOrigins.add(origin.key);
        animatedSquares.add(destination);
      }
    }

    return animatedSquares;
  }

  // Returns the set of squares that are still animating.
  function syncWithPieces(pieces: Pieces): Set<Key> {
    for (let i = animations.length - 1; i >= 0; i--) {
      const piece = pieces.get(animations[i].destination);
      const expectedName = piece
        ? piece.color === 'white'
          ? roleCodes[piece.role]
          : roleCodes[piece.role].toLowerCase()
        : undefined;
      if (animations[i].piece.name !== expectedName) {
        finish(animations[i]);
      }
    }
    return new Set(animations.map(animation => animation.destination));
  }

  return { animateMove, update, animatePieceChanges, syncWithPieces };
}
