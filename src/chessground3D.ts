import { Chessground as Chessground2D } from '@lichess-org/chessground';
import { type Api } from '@lichess-org/chessground/api';
import { type Config, configure } from '@lichess-org/chessground/config';
import { defaults, type HeadlessState, type State } from '@lichess-org/chessground/state';
import { type Drop, type Key, type Piece, type PiecesDiff } from '@lichess-org/chessground/types';
import { opposite } from '@lichess-org/chessground/util';

import { createChessScene } from './chessScene';
import { dragNewPiece, registerScene, unregisterScene } from './drag';

export function Chessground(element: HTMLElement, config?: Config): Api {
  // temporary hack to allow a 2D view
  if (window.localStorage.getItem('chessground3d') === 'false') {
    return Chessground2D(element, config);
  }

  // temporary hack to hide stuff pertaining to 2D
  const style = document.createElement('style');
  style.textContent = `
  .variant-kingOfTheHill cg-container::before,
  .variant-racingKings cg-container::before {
    display: none !important;
  }
`;
  document.head.appendChild(style);

  // Mimic chessground initialisation
  const maybeState: HeadlessState = defaults();
  configure(maybeState, config || {});
  const state = maybeState as State;

  element.innerHTML = '';
  element.classList.add('cg-wrap');
  const container = document.createElement('cg-container');
  element.appendChild(container);
  const scene = createChessScene(container, state);
  const elements = { board: container, container, wrap: element };
  state.events.insert?.(elements);
  state.dom = {
    redraw: () => {},
    redrawNow: () => {},
    unbind: () => {},
    elements,
    bounds: Object.assign(() => element.getBoundingClientRect(), {
      clear() {},
    }),
  };

  registerScene(state, scene);

  return {
    state,

    set(config) {
      console.log('API - set', config);
      const previousPieces = 'fen' in config ? new Map(state.pieces) : undefined;
      configure(state, config);
      scene.set(state, 'fen' in config, previousPieces);
    },

    getFen() {
      console.log('API - getFen');
      return scene.getFen();
    },

    toggleOrientation() {
      console.log('API - toggleOrientation');
      state.orientation = opposite(state.orientation);
      state.animation.current = state.draggable.current = state.selected = undefined;
      scene.selectSquare(null);
      scene.set(state, false);
    },

    move(orig, dest) {
      console.log(`API - move ${orig} to ${dest}.`);
      scene.move(orig, dest);
    },

    setPieces(pieces: PiecesDiff) {
      console.log('API - setPieces', pieces);
      for (const [key, piece] of pieces) {
        if (piece) {
          state.pieces.set(key, piece);
        } else {
          state.pieces.delete(key);
        }
      }
      scene.set(state);
    },

    selectSquare(key, force): void {
      console.log(`API - selectSquare ${key}, force ${force}`);
      scene.selectSquare(key);
    },

    newPiece(piece: Piece, key: Key): void {
      console.log(`API - newPiece ${piece} at ${key}.`);
    },

    cancelMove(): void {
      console.log('API - cancelMove');
    },

    stop(): void {
      console.log('API - stop');
    },

    explode(keys: Key[]): void {
      console.log('API - explode', keys);
      let changed = false;
      for (const key of keys) {
        changed = state.pieces.delete(key) || changed;
      }
      scene.set(state);
      if (changed) {
        state.events.change?.();
      }
    },

    setShapes(shapes) {
      console.log('API - setShapes', shapes);
      scene.setUserShapes(shapes);
    },

    setAutoShapes(shapes) {
      console.log('API - setAutoShapes', shapes);
      scene.setSystemShapes(shapes);
    },

    dragNewPiece(piece, event, force) {
      console.log(`API - dragNewPiece ${piece} with event:`, event, 'force:', force);
      dragNewPiece(state, piece, event, force);
    },

    redrawAll() {
      console.log('API - redrawAll');
      return () => {};
    },

    playPremove() {
      console.log('API - playPremove');
      return scene.playPremove();
    },

    cancelPremove() {
      console.log('API - cancelPremove');
      scene.cancelPremove();
    },

    playPredrop(validate: (drop: Drop) => boolean): boolean {
      console.log('API - playPredrop', validate);
      const drop = state.predroppable.current;
      if (!drop) {
        return false;
      }

      let success = false;
      const color = state.movable.color;
      if (validate(drop) && (color === 'white' || color === 'black') && !state.pieces.has(drop.key)) {
        const piece: Piece = { role: drop.role, color };
        state.events.dropNewPiece?.(piece, drop.key);
        state.pieces.set(drop.key, piece);
        state.lastMove = [drop.key];
        state.check = undefined;
        state.events.change?.();
        state.movable.dests = undefined;
        state.turnColor = opposite(state.turnColor);
        state.movable.events?.afterNewPiece?.(drop.role, drop.key, { premove: false, predrop: true });
        success = true;
      }

      state.predroppable.current = undefined;
      state.predroppable.events.unset?.();
      scene.set(state, success);
      return success;
    },

    cancelPredrop() {
      console.log('API - cancelPredrop');
      if (state.predroppable.current) {
        state.predroppable.current = undefined;
        state.predroppable.events.unset?.();
        scene.set(state, false);
      }
    },

    getKeyAtDomPos(pos) {
      console.log('API - getKeyAtDomPos', pos);
      return scene.getKeyAtDomPos(pos);
    },

    destroy() {
      unregisterScene(state);
      scene.destroy();
    },
  };
}
