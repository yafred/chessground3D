import { type Key, type Pieces } from '@lichess-org/chessground/types';
import * as THREE from 'three';

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
  ) => void;
  update: (deltaSeconds: number) => void;
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
      return;
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

  // Returns the set of squares that are still animating.
  function syncWithPieces(pieces: Pieces): Set<Key> {
    for (let i = animations.length - 1; i >= 0; i--) {
      if (!pieces.has(animations[i].destination)) {
        finish(animations[i]);
      }
    }
    return new Set(animations.map(animation => animation.destination));
  }

  return { animateMove, update, syncWithPieces };
}
