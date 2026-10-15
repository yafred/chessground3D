import { type DrawShape } from '@lichess-org/chessground/draw';
import { write as fenWrite } from '@lichess-org/chessground/fen';
import { premove } from '@lichess-org/chessground/premove';
import { type State } from '@lichess-org/chessground/state';
import { type Color, type Key, type MouchEvent, type Piece } from '@lichess-org/chessground/types';
import { eventPosition, opposite } from '@lichess-org/chessground/util';
import * as THREE from 'three';

import { updateCheckHighlight } from './logic/checkHighlight.js';
import { createPieceHoverController } from './logic/hover.js';
import { setupPieceInteraction } from './logic/interaction.js';
import { applyInteractionPolicy } from './logic/interactionPolicy.js';
import { setupMoveAttemptAdapter } from './logic/moveAttemptAdapter.js';
import { updateMeshesFromShapes } from './logic/shapes.js';
import { coordinatesToSquare, keyToCoordinates, pieceCodes } from './logic/util.js';
import {
  createA1Marker,
  createCheckHighlightMarker,
  createH8Marker,
  createPremoveHighlightMarker,
} from './objects/createMarkers.js';
import { piecesToScene } from './objects/createPieces.js';
import { createPieceTemplates } from './objects/createPieceTemplates.js';
import { createCamera } from './scene/createCamera.js';
import { createLights } from './scene/createLights.js';
import { createRenderer } from './scene/createRenderer.js';
import { createScene } from './scene/createScene.js';
import { createControls } from './systems/controls.js';
import { registerSceneRenderStep } from './systems/renderScheduler.js';
import { handleResize } from './systems/resize.js';

const SCENE_ASSET_URL = new URL('/assets/scene.glb', window.location.origin).href; // hardcoded for lila

export interface ChessScene {
  set(state: State, hasFen?: boolean): void;
  move(from: Key, to: Key): void;
  selectSquare(key: Key | null): void;
  setSystemShapes(shapes: DrawShape[]): void;
  setUserShapes(shapes: DrawShape[]): void;
  getFen(): string;
  getKeyAtDomPos(pos: [number, number]): Key | undefined;
  dragNewPiece(piece: Piece, event: MouchEvent, force?: boolean): () => void;
  playPremove(): boolean;
  cancelPremove(): void;
  destroy(): void;
}

export function createChessScene(htmlElement: HTMLElement, state: State): ChessScene {
  const scene = createScene();
  const camera = createCamera(htmlElement);
  const renderer = createRenderer(htmlElement);
  const controls = createControls(camera, renderer.domElement);
  const pointerRaycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const boardPoint = new THREE.Vector3();
  const lights = createLights();
  scene.add(lights);
  const a1Marker = createA1Marker();
  const h8Marker = createH8Marker();
  const checkHighlight = createCheckHighlightMarker();
  const systemShapesGroup = new THREE.Group();
  const userShapesGroup = new THREE.Group();
  const board = new THREE.Group();
  scene.add(board);
  board.add(a1Marker);
  board.add(h8Marker);
  board.add(checkHighlight);
  const predropHighlight = createPremoveHighlightMarker(true);
  board.add(predropHighlight);
  board.add(systemShapesGroup);
  board.add(userShapesGroup);
  const stopHandlingResize = handleResize(htmlElement, camera, renderer, state.addDimensionsCssVarsTo);

  let materialTemplates = new Map<string, THREE.Material>();
  let pieceTemplates = new Map<string, THREE.Mesh>();
  let isDestroyed = false;
  let currentOrientation: Color = 'white';
  let targetRotationY = 0;
  let lastFrameTime = performance.now();

  function setOrientation(orientation: Color) {
    if (!orientation || orientation === currentOrientation) {
      return;
    }
    targetRotationY = orientation === 'white' ? 0 : Math.PI;

    currentOrientation = orientation;
  }

  setOrientation(state.orientation);

  // Set up piece hover and interaction
  const hoverController = createPieceHoverController(scene, camera, renderer.domElement, board);
  htmlElement.addEventListener('pointermove', hoverController.updateFromPointerEvent);

  // Set up interactions
  const interactionController = setupPieceInteraction({
    scene,
    board,
    camera,
    renderer,
    hoverController,
  });
  interactionController.setUserShapesGroup(userShapesGroup);

  function notifyMove(orig: Key, dest: Key, isPremove: boolean) {
    const piece = state.pieces.get(orig);
    const capturedPiece = state.pieces.get(dest);
    if (piece) {
      state.pieces.set(dest, piece);
      state.pieces.delete(orig);
      state.lastMove = [orig, dest];
      state.check = undefined;
    }

    state.movable.dests = undefined;
    state.turnColor = opposite(state.turnColor);
    state.events?.move?.(orig, dest, capturedPiece);
    state.movable?.events?.after?.(orig, dest, { premove: isPremove, captured: capturedPiece });
    state.events?.change?.();
  }

  setupMoveAttemptAdapter(
    interactionController,
    () => state.movable.dests,
    notifyMove,
    () => state.movable.free ?? false,
  );

  interactionController.setPremoveCallbacks({
    onSet: (orig, dest) => {
      state.premovable.current = [orig, dest];
      state.premovable.events?.set?.(orig, dest);
    },
    onUnset: () => {
      state.premovable.current = undefined;
      state.premovable.events?.unset?.();
    },
  });

  // premove destinations for every piece of the non-moving color, mirroring board.ts's `premove()` usage
  function computePremoveDests(s: State): Map<Key, readonly Key[]> | undefined {
    if (!s.premovable.enabled) {
      return undefined;
    }

    const dests = new Map<Key, readonly Key[]>();
    for (const key of s.pieces.keys()) {
      const keyDests = s.premovable.customDests?.get(key) ?? premove(s, key);
      if (keyDests.length > 0) {
        dests.set(key, keyDests);
      }
    }
    return dests;
  }

  function setAllowInteractionForColors(state: State) {
    applyInteractionPolicy(interactionController, {
      isViewOnly: state.viewOnly,
      turnColor: state.turnColor,
      movableColor: state.movable?.color,
      draggable: state.draggable.enabled,
      selectable: state.selectable.enabled,
      premovableEnabled: state.premovable.enabled,
    });
  }

  function updatePredropHighlight(s: State) {
    const coords = s.predroppable.current ? keyToCoordinates(s.predroppable.current.key) : null;
    predropHighlight.visible = !!coords;
    if (coords) {
      predropHighlight.position.x = coords.x;
      predropHighlight.position.z = coords.z;
    }
  }

  function applyState(s: State, hasFen = true) {
    updatePredropHighlight(s);
    interactionController.setLastMoveSquares(s.highlight.lastMove ? s.lastMove : undefined);
    if (hasFen) {
      piecesToScene(s.pieces, board, pieceTemplates, materialTemplates);
    }
    updateCheckHighlight(checkHighlight, s.check, s.highlight.check);

    interactionController.setPremoveDests(computePremoveDests(s));

    setOrientation(s.orientation);
    setAllowInteractionForColors(s);
    interactionController.setState(s); // just give it all
  }

  // Load scene and templates (pieces and materials)
  void createPieceTemplates(scene, SCENE_ASSET_URL).then(
    ({ pieceTemplates: loadedPieces, materialTemplates: loadedMaterials }) => {
      pieceTemplates = loadedPieces;
      materialTemplates = loadedMaterials;

      applyState(state);

      scene.visible = true;
      return undefined;
    },
  );

  const renderStep = () => {
    const now = performance.now();
    const delta = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    board.rotation.y = THREE.MathUtils.damp(board.rotation.y, targetRotationY, 8, delta);
    if (Math.abs(board.rotation.y - targetRotationY) < 0.0001) {
      targetRotationY = currentOrientation === 'white' ? 0 : Math.PI;
      board.rotation.y = targetRotationY;
    }

    // Custom SVGs stay facing the camera (same as white orientation) while the board rotates.
    for (const group of [systemShapesGroup, userShapesGroup]) {
      for (const child of group.children) {
        if (child.userData.keepUpright) {
          child.rotation.y = -board.rotation.y;
        }
      }
    }

    hoverController.update();
    controls.update();
    renderer.render(scene, camera);
  };
  const unregisterRenderStep = registerSceneRenderStep(renderStep);

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

  // API implementation
  return {
    set(state, hasFen = true) {
      applyState(state, hasFen);
    },

    move(from, to) {
      interactionController.moveProgrammaticallyBySquare(from, to);
    },

    selectSquare(key) {
      interactionController.selectSquare(key);
    },

    setSystemShapes(shapes) {
      updateMeshesFromShapes(systemShapesGroup, shapes, state.drawable.brushes);
    },

    setUserShapes(shapes) {
      updateMeshesFromShapes(userShapesGroup, shapes, state.drawable.brushes);
    },

    getFen() {
      return fenWrite(state.pieces);
    },

    getKeyAtDomPos(pos) {
      const rect = htmlElement.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return undefined;
      }

      pointerNdc.x = ((pos[0] - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((pos[1] - rect.top) / rect.height) * 2 + 1;
      pointerRaycaster.setFromCamera(pointerNdc, camera);

      // Prefer the piece under the pointer, so its square wins even if the ray also clips the board plane elsewhere.
      const pieceHit = pointerRaycaster
        .intersectObjects(scene.children, true)
        .map(hit => getPieceMeshFromObject(hit.object))
        .find((mesh): mesh is THREE.Mesh => mesh !== null);
      if (pieceHit) {
        const squareX = Math.round(pieceHit.position.x + 3.5) - 3.5;
        const squareZ = Math.round(pieceHit.position.z + 3.5) - 3.5;
        if (Math.abs(squareX) <= 4 && Math.abs(squareZ) <= 4) {
          return coordinatesToSquare(squareX, squareZ);
        }
      }

      const hasBoardIntersection = pointerRaycaster.ray.intersectPlane(boardPlane, boardPoint) !== null;
      if (!hasBoardIntersection) {
        return undefined;
      }
      board.worldToLocal(boardPoint);

      const boardX = boardPoint.x;
      const boardZ = boardPoint.z;
      if (Math.abs(boardX) > 4 || Math.abs(boardZ) > 4) {
        return undefined;
      }

      const squareX = Math.round(boardX + 3.5) - 3.5;
      const squareZ = Math.round(boardZ + 3.5) - 3.5;
      if (Math.abs(squareX) > 4 || Math.abs(squareZ) > 4) {
        return undefined;
      }

      return coordinatesToSquare(squareX, squareZ);
    },

    dragNewPiece(piece: Piece, event: MouchEvent, force = false): () => void {
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
        const key = dropPosition ? this.getKeyAtDomPos(dropPosition) : undefined;
        const canDropNow =
          state.movable.color === 'both' ||
          (state.movable.color === piece.color && state.turnColor === piece.color);
        const destPiece = key ? state.pieces.get(key) : undefined;
        if (key && canDropNow && (force || !destPiece)) {
          state.pieces.set(key, piece);
          state.events.dropNewPiece?.(piece, key);
          state.movable.events?.afterNewPiece?.(piece.role, key, { premove: false, predrop: false });
          this.set(state);
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
          interactionController.cancelQueuedPremove();
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
    },

    playPremove() {
      return interactionController.playQueuedPremove();
    },

    cancelPremove() {
      interactionController.cancelQueuedPremove();
    },

    destroy() {
      if (isDestroyed) {
        return;
      }
      isDestroyed = true;

      unregisterRenderStep();
      stopHandlingResize();
      renderer.dispose();
      controls.dispose();
      htmlElement.removeEventListener('pointermove', hoverController.updateFromPointerEvent);
    },
  };
}
