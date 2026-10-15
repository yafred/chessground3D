import { dragNewPiece as dragNewPiece2D } from '@lichess-org/chessground/drag';
import { type State } from '@lichess-org/chessground/state';
import { type Key, type MouchEvent, type Piece } from '@lichess-org/chessground/types';
import { eventPosition } from '@lichess-org/chessground/util';

import { type ChessScene } from './chessScene';

const scenes = new WeakMap<State, ChessScene>();
const activeDrags = new WeakMap<State, () => void>();

interface SceneDragContext {
  state: State;
  piece: Piece;
  event: MouchEvent;
  force: boolean;
  getKeyAtDomPos: (pos: [number, number]) => Key | undefined;
  set: (state: State) => void;
  cancelQueuedPremove: () => void;
  updatePredropHighlight: (state: State) => void;
}

export function startScenePieceDrag({
  state,
  piece,
  event,
  force,
  getKeyAtDomPos,
  set,
  cancelQueuedPremove,
  updatePredropHighlight,
}: SceneDragContext): () => void {
  let position = eventPosition(event);
  const mainBoard = state.dom.elements.wrap.parentElement as HTMLElement | null;
  const previousCursor = mainBoard?.style.getPropertyValue('cursor');
  const previousPriority = mainBoard?.style.getPropertyPriority('cursor');
  const assetUrl = (globalThis as { site?: { asset?: { url(path: string): string } } }).site?.asset?.url;
  if (mainBoard) {
    const cursorUrl = assetUrl?.(`cursors/${piece.color}-${piece.role}.cur`);
    mainBoard.style.setProperty(
      'cursor',
      cursorUrl ? `url('${cursorUrl}'), default` : 'grabbing',
      'important',
    );
  }
  const onMove = (moveEvent: Event) => {
    position = eventPosition(moveEvent as MouchEvent) ?? position;
  };
  const onEnd = (endEvent: Event) => {
    const dropPosition = eventPosition(endEvent as MouchEvent) ?? position;
    const key = dropPosition ? getKeyAtDomPos(dropPosition) : undefined;
    const canDropNow =
      state.movable.color === 'both' ||
      (state.movable.color === piece.color && state.turnColor === piece.color);
    const destPiece = key ? state.pieces.get(key) : undefined;
    if (key && canDropNow && (force || !destPiece)) {
      state.pieces.set(key, piece);
      state.events.dropNewPiece?.(piece, key);
      state.movable.events?.afterNewPiece?.(piece.role, key, { premove: false, predrop: false });
      set(state);
      state.events.change?.();
    } else if (
      key &&
      !canDropNow &&
      state.predroppable.enabled &&
      state.movable.color === piece.color &&
      state.turnColor !== piece.color &&
      (!destPiece || destPiece.color !== piece.color) &&
      (piece.role !== 'pawn' || (key[1] !== '1' && key[1] !== '8'))
    ) {
      cancelQueuedPremove();
      state.predroppable.current = { role: piece.role, key };
      state.predroppable.events.set?.(piece.role, key);
      updatePredropHighlight(state);
    } else if (state.predroppable.current) {
      state.predroppable.current = undefined;
      state.predroppable.events.unset?.();
      updatePredropHighlight(state);
    }
    cancel();
  };
  const cancel = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchend', onEnd);
    if (mainBoard) {
      mainBoard.style.setProperty('cursor', previousCursor ?? '', previousPriority ?? '');
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove);
  document.addEventListener('mouseup', onEnd, { once: true });
  document.addEventListener('touchend', onEnd, { once: true });

  return cancel;
}

export function registerScene(state: State, scene: ChessScene): void {
  scenes.set(state, scene);
}

export function unregisterScene(state: State): void {
  activeDrags.get(state)?.();
  activeDrags.delete(state);
  scenes.delete(state);
}

// Same signature as '@lichess-org/chessground/drag', which lila calls directly for crazyhouse pockets
export function dragNewPiece(state: State, piece: Piece, event: MouchEvent, force?: boolean): void {
  const scene = scenes.get(state);
  if (!scene) {
    dragNewPiece2D(state, piece, event, force);
    return;
  }

  activeDrags.get(state)?.();
  activeDrags.set(state, scene.dragNewPiece(piece, event, force));
}
