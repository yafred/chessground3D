import { type DrawShape } from '@lichess-org/chessground/draw';
import { write as fenWrite } from '@lichess-org/chessground/fen';
import { premove } from '@lichess-org/chessground/premove';
import { type State } from '@lichess-org/chessground/state';
import {
  type Color,
  type Key,
  type MouchEvent,
  type Piece,
  type Pieces,
} from '@lichess-org/chessground/types';
import { opposite } from '@lichess-org/chessground/util';
import * as THREE from 'three';

import { startScenePieceDrag } from './drag.js';
import { updateCheckHighlight } from './logic/checkHighlight.js';
import { createPieceHoverController } from './logic/hover.js';
import { setupPieceInteraction } from './logic/interaction.js';
import { applyInteractionPolicy } from './logic/interactionPolicy.js';
import { createMoveAnimator } from './logic/moveAnimation.js';
import { setupMoveAttemptAdapter } from './logic/moveAttemptAdapter.js';
import { updateMeshesFromShapes } from './logic/shapes.js';
import { keyToCoordinates } from './logic/util.js';
import { createCoordinateLabels } from './objects/createCoordinates.js';
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
import { createSquarePicker } from './scene/squarePicker.js';
import { createControls } from './systems/controls.js';
import { registerSceneRenderStep } from './systems/renderScheduler.js';
import { handleResize } from './systems/resize.js';

const SCENE_ASSET_URL = new URL('/assets/scene.glb', window.location.origin).href; // hardcoded for lila

export interface ChessScene {
  set(state: State, hasFen?: boolean, previousPieces?: Pieces): void;
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
  const lights = createLights();
  scene.add(lights);
  const a1Marker = createA1Marker();
  const h8Marker = createH8Marker();
  const checkHighlight = createCheckHighlightMarker();
  const systemShapesGroup = new THREE.Group();
  const userShapesGroup = new THREE.Group();
  const board = new THREE.Group();
  scene.add(board);
  const getKeyAtDomPos = createSquarePicker(htmlElement, scene, camera, board);
  const coordinateLabels = createCoordinateLabels();
  board.add(coordinateLabels.group);
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
  let lastFrameTime = performance.now();
  let systemShapes: readonly DrawShape[] = [];
  let userShapes: readonly DrawShape[] = [];
  let appleSquares: { x: number; z: number }[] = [];

  function updateAppleShapeSquares() {
    appleSquares = [];
    for (const shape of [...systemShapes, ...userShapes]) {
      const customSvg = shape.customSvg as string | { html?: string } | undefined;
      const html = typeof customSvg === 'string' ? customSvg : customSvg?.html;
      if (!html?.includes('<g class="apple')) {
        continue;
      }
      const coords = keyToCoordinates(shape.orig);
      if (coords) {
        appleSquares.push(coords);
      }
    }
  }

  function updateApplePawnVisibility() {
    for (const child of board.children) {
      if (
        !(child instanceof THREE.Mesh) ||
        !child.userData.isClone ||
        (child.name !== 'P' && child.name !== 'p')
      ) {
        continue;
      }

      child.visible = !appleSquares.some(
        coords =>
          Math.abs(child.position.x - coords.x) < 0.001 && Math.abs(child.position.z - coords.z) < 0.001,
      );
    }
  }

  // chessground expresses animation.duration in milliseconds
  const moveAnimator = createMoveAnimator(board, () =>
    state.animation.enabled ? state.animation.duration / 1000 : 0,
  );

  // Knights are turned 180° on their vertical axis when the board is seen from black's side.
  function updateKnightRotations() {
    const knightTurn = currentOrientation === 'black' ? Math.PI : 0;
    for (const child of board.children) {
      if (child.userData.isClone && (child.name === 'N' || child.name === 'n')) {
        child.userData.baseRotationY ??= child.rotation.y;
        child.rotation.y = (child.userData.baseRotationY as number) + knightTurn;
      }
    }
  }

  function setOrientation(orientation: Color) {
    if (!orientation || orientation === currentOrientation) {
      return;
    }
    board.rotation.y = orientation === 'white' ? 0 : Math.PI;
    coordinateLabels.setOrientation(orientation);
    currentOrientation = orientation;
  }

  setOrientation(state.orientation);

  const hoverController = createPieceHoverController(scene, camera, renderer.domElement, board);
  htmlElement.addEventListener('pointermove', hoverController.updateFromPointerEvent);

  const interactionController = setupPieceInteraction({
    scene,
    board,
    camera,
    renderer,
    hoverController,
    animateMove: moveAnimator.animateMove,
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

  // mimic board.ts's `premove()` usage
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

  function applyState(s: State, previousPieces?: Pieces, hasFen = true) {
    // no distinction between inside and outside the board for coordinate visibility
    // we could do it by testing classes coords-in and coords-out on element body of the page
    coordinateLabels.group.visible = s.coordinates;
    a1Marker.visible = !s.coordinates;
    h8Marker.visible = !s.coordinates;
    const border = scene.getObjectByName('Border');
    if (border) {
      border.visible = s.coordinates;
    }
    updatePredropHighlight(s);
    interactionController.setLastMoveSquares(s.highlight.lastMove ? s.lastMove : undefined);
    if (hasFen) {
      const preservedPieceSquares = previousPieces
        ? moveAnimator.animatePieceChanges(previousPieces, s.pieces)
        : new Set<Key>();
      for (const square of moveAnimator.syncWithPieces(s.pieces)) {
        preservedPieceSquares.add(square);
      }
      piecesToScene(s.pieces, board, pieceTemplates, materialTemplates, preservedPieceSquares);
      updateKnightRotations();
      updateApplePawnVisibility();
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
    moveAnimator.update(delta);
    updateApplePawnVisibility();

    updateKnightRotations();

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

  // API implementation
  return {
    set(state, hasFen, previousPieces) {
      applyState(state, previousPieces, hasFen ?? true);
    },

    move(from, to) {
      interactionController.moveProgrammaticallyBySquare(from, to);
    },

    selectSquare(key) {
      interactionController.selectSquare(key);
    },

    setSystemShapes(shapes) {
      systemShapes = shapes;
      updateMeshesFromShapes(systemShapesGroup, shapes, state.drawable.brushes);
      updateAppleShapeSquares();
      updateApplePawnVisibility();
    },

    setUserShapes(shapes) {
      userShapes = shapes;
      updateMeshesFromShapes(userShapesGroup, shapes, state.drawable.brushes);
      updateAppleShapeSquares();
      updateApplePawnVisibility();
    },

    getFen() {
      return fenWrite(state.pieces);
    },

    getKeyAtDomPos,

    dragNewPiece(piece: Piece, event: MouchEvent, force = false): () => void {
      return startScenePieceDrag({
        state,
        piece,
        event,
        force,
        getKeyAtDomPos: this.getKeyAtDomPos,
        set: nextState => applyState(nextState),
        cancelQueuedPremove: interactionController.cancelQueuedPremove,
        updatePredropHighlight,
      });
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
      coordinateLabels.dispose();
      renderer.dispose();
      controls.dispose();
      htmlElement.removeEventListener('pointermove', hoverController.updateFromPointerEvent);
    },
  };
}
