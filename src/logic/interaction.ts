import { type State } from '@lichess-org/chessground/state';
import { type Color, type Key } from '@lichess-org/chessground/types';
import * as THREE from 'three';
import { type OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import {
  createLastMoveFromHighlightMarker,
  createLastMoveToHighlightMarker,
  createPremoveHighlightMarker,
} from '../objects/createMarkers';
import { createArrowMesh, createCircleMesh } from '../objects/createShapes.js';

import { type PieceHoverController } from './hover';
import { clearMoveDestinationHighlights, updateMoveDestinationHighlights } from './moveDestinationHighlight';
import { disposeShape, updateMeshesFromShapes } from './shapes.js';
import { coordinatesToSquare, getPieceAtSquare, keyToCoordinates, pieceCodes } from './util';

type DrawState = {
  pointerId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  shapeMesh: THREE.Mesh;
  brush: string;
};

type DragState = {
  piece: THREE.Mesh;
  pointerId: number;
  startPosition: THREE.Vector3;
  startClientX: number;
  startClientY: number;
  pointerOffsetX: number;
  pointerOffsetZ: number;
  dragPlane: THREE.Plane;
  hasMoved: boolean;
};

type ClickState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
};

type SetupPieceInteractionParams = {
  scene: THREE.Scene;
  board: THREE.Group;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  hoverController: PieceHoverController;
};

export type PieceInteractionController = {
  moveProgrammaticallyBySquare: (from: Key, to: Key) => boolean;
  selectSquare: (key: Key | null) => void;
  setLastMoveSquares: (squares?: readonly Key[]) => void;
  setAllowedMoveDests: (dests?: Map<Key, readonly Key[]>, showDests?: boolean) => void;
  setMoveAttemptCallback: (callback: (uci: string) => boolean) => void; // Set callback for validating user moves
  setMoveCallback: (callback: (from: Key, to: Key, isPremove: boolean) => void) => void; // Set callback after a successful move
  setAllowWhiteInteraction: (allow: boolean) => void;
  setAllowBlackInteraction: (allow: boolean) => void;
  setDraggable: (enabled: boolean) => void;
  setSelectable: (enabled: boolean) => void;
  setInteractionEnabled: (enabled: boolean) => void;
  setTurnColor: (color?: Color) => void; // color allowed to move immediately (others queue premoves)
  setMovableColor: (color?: Color | 'both') => void; // 'both' is never a premove candidate
  setPremoveDests: (dests?: Map<Key, readonly Key[]>, showDests?: boolean) => void;
  setPremoveCallbacks: (callbacks: { onSet?: (orig: Key, dest: Key) => void; onUnset?: () => void }) => void;
  getQueuedPremove: () => { orig: Key; dest: Key } | undefined;
  playQueuedPremove: () => boolean; // attempt to play the queued premove now; always clears it
  cancelQueuedPremove: () => void;
  setState: (newState: State | null) => void;
  setUserShapesGroup: (group: THREE.Group) => void;
};

export function setupPieceInteraction({
  scene,
  board,
  camera,
  renderer,
  controls,
  hoverController,
}: SetupPieceInteractionParams): PieceInteractionController {
  const pointerRaycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const boardPoint = new THREE.Vector3();
  const dragThresholdPx = 4;
  const lastMoveFromHighlight = createLastMoveFromHighlightMarker();
  const lastMoveToHighlight = createLastMoveToHighlightMarker();
  const premoveFromHighlight = createPremoveHighlightMarker(false);
  const premoveToHighlight = createPremoveHighlightMarker(true);
  const selectableMoveHighlights = new THREE.Group();
  lastMoveFromHighlight.rotation.x = -Math.PI / 2;
  lastMoveToHighlight.rotation.x = -Math.PI / 2;
  lastMoveFromHighlight.position.y = 0.005;
  lastMoveToHighlight.position.y = 0.006;
  lastMoveFromHighlight.visible = false;
  lastMoveToHighlight.visible = false;
  lastMoveFromHighlight.renderOrder = 8;
  lastMoveToHighlight.renderOrder = 9;
  board.add(lastMoveFromHighlight);
  board.add(lastMoveToHighlight);
  board.add(premoveFromHighlight);
  board.add(premoveToHighlight);
  board.add(selectableMoveHighlights);

  let state: State | null = null;
  let drawState: DrawState | null = null; // maybe use state?.drawable.current instead
  let drawEnabled = true;
  let dragState: DragState | null = null;
  let clickState: ClickState | null = null;
  let selectedPiece: THREE.Mesh | null = null;
  let onMoveAttempt: ((uci: string) => boolean) | undefined = undefined;
  let onMove: ((from: Key, to: Key, isPremove: boolean) => void) | undefined = undefined;
  let allowWhiteInteraction = true;
  let allowBlackInteraction = true;
  let draggable = true;
  let selectable = true;
  let interactionEnabled = true;
  let allowedMoveDests: Map<Key, readonly Key[]> | undefined;
  let showDests = true;
  let turnColor: Color | undefined;
  let movableColor: Color | 'both' | undefined;
  let premoveDests: Map<Key, readonly Key[]> | undefined;
  let showPremoveDests = true;
  let queuedPremove: { orig: Key; dest: Key } | undefined;
  let onPremoveSet: ((orig: Key, dest: Key) => void) | undefined;
  let onPremoveUnset: (() => void) | undefined;
  let userShapesGroup: THREE.Group | null = null;

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

  function pointerNdcFromEvent(event: PointerEvent, out: THREE.Vector2 = new THREE.Vector2()): THREE.Vector2 {
    const rect = renderer.domElement.getBoundingClientRect();
    out.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    out.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return out;
  }

  function getSquareCoordinate(value: number): number {
    return Math.round(value + 3.5) - 3.5;
  }

  function isWithinBoard(x: number, z: number): boolean {
    return Math.abs(x) <= 4 && Math.abs(z) <= 4;
  }

  function isWhitePiece(piece: THREE.Mesh): boolean {
    return piece.name === piece.name.toUpperCase();
  }

  function isOppositeColor(a: THREE.Mesh, b: THREE.Mesh): boolean {
    return isWhitePiece(a) !== isWhitePiece(b);
  }

  function canInteractWithPiece(piece: THREE.Mesh): boolean {
    return isWhitePiece(piece) ? allowWhiteInteraction : allowBlackInteraction;
  }

  hoverController.setPieceHighlightFilter(canInteractWithPiece);

  function coordinatesToUci(fromX: number, fromZ: number, toX: number, toZ: number): string {
    // Convert board coordinates to square notation (a1-h8)
    return coordinatesToSquare(fromX, fromZ) + coordinatesToSquare(toX, toZ);
  }

  function clearSelectableMoveHighlights() {
    clearMoveDestinationHighlights(selectableMoveHighlights);
  }

  function isPremoveCandidate(piece: THREE.Mesh): boolean {
    if (movableColor === 'both') {
      return false;
    }
    const color: Color = isWhitePiece(piece) ? 'white' : 'black';
    return turnColor !== undefined && color !== turnColor;
  }

  function showSelectableMoveHighlights(piece: THREE.Mesh, fromSquareOverride?: Key) {
    const isPremove = isPremoveCandidate(piece);
    const dests = isPremove ? premoveDests : allowedMoveDests;
    const show = isPremove ? showPremoveDests : showDests;
    updateMoveDestinationHighlights(
      scene,
      selectableMoveHighlights,
      piece,
      show ? dests : undefined,
      fromSquareOverride,
    );
  }

  function updatePremoveHighlight() {
    if (!queuedPremove) {
      premoveFromHighlight.visible = false;
      premoveToHighlight.visible = false;
      return;
    }

    const from = keyToCoordinates(queuedPremove.orig);
    const to = keyToCoordinates(queuedPremove.dest);
    if (!from || !to) {
      premoveFromHighlight.visible = false;
      premoveToHighlight.visible = false;
      return;
    }

    premoveFromHighlight.position.x = from.x;
    premoveFromHighlight.position.z = from.z;
    premoveToHighlight.position.x = to.x;
    premoveToHighlight.position.z = to.z;
    premoveFromHighlight.visible = true;
    premoveToHighlight.visible = true;
  }

  function setLastMoveHighlights(fromX: number, fromZ: number, toX: number, toZ: number) {
    lastMoveFromHighlight.position.x = fromX;
    lastMoveFromHighlight.position.z = fromZ;
    lastMoveToHighlight.position.x = toX;
    lastMoveToHighlight.position.z = toZ;
    lastMoveFromHighlight.visible = true;
    lastMoveToHighlight.visible = true;
  }

  function clearLastMoveHighlights() {
    lastMoveFromHighlight.visible = false;
    lastMoveToHighlight.visible = false;
  }

  function setLastMoveSquares(squares?: readonly Key[]) {
    if (!squares || squares.length === 0) {
      clearLastMoveHighlights();
      return;
    }

    const from = keyToCoordinates(squares[0]);
    if (!from) {
      clearLastMoveHighlights();
      return;
    }

    if (squares.length === 1) {
      lastMoveFromHighlight.visible = false;
      lastMoveToHighlight.position.x = from.x;
      lastMoveToHighlight.position.z = from.z;
      lastMoveToHighlight.visible = true;
      return;
    }

    const to = keyToCoordinates(squares[1]);
    if (!to) {
      clearLastMoveHighlights();
      return;
    }

    setLastMoveHighlights(from.x, from.z, to.x, to.z);
  }

  function getPieceHitUnderPointer(event: PointerEvent): { piece: THREE.Mesh; point: THREE.Vector3 } | null {
    pointerRaycaster.setFromCamera(pointerNdcFromEvent(event, pointerNdc), camera);
    const hits = pointerRaycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      const piece = getPieceMeshFromObject(hit.object);
      if (piece) {
        return { piece, point: hit.point };
      }
    }

    return null;
  }

  function getPieceUnderPointer(event: PointerEvent): THREE.Mesh | null {
    return getPieceHitUnderPointer(event)?.piece ?? null;
  }

  function clearSelection() {
    selectedPiece = null;
    hoverController.setPinnedPiece(null);
    clearSelectableMoveHighlights();
  }

  function isQueuedPremoveOrigin(piece: THREE.Mesh): boolean {
    if (!queuedPremove) {
      return false;
    }

    const square = coordinatesToSquare(
      getSquareCoordinate(piece.position.x),
      getSquareCoordinate(piece.position.z),
    );
    return square === queuedPremove.orig;
  }

  function selectPiece(piece: THREE.Mesh) {
    if (!canInteractWithPiece(piece)) {
      return;
    }

    // clicking the piece that owns the queued premove cancels it instead of reselecting
    if (isQueuedPremoveOrigin(piece)) {
      cancelQueuedPremove();
      clearSelection();
      return;
    }

    selectedPiece = piece;
    hoverController.setPinnedPiece(piece);
    showSelectableMoveHighlights(piece);
  }

  function applyMoveOrCapture(
    movingPiece: THREE.Mesh,
    targetX: number,
    targetZ: number,
    fromX = movingPiece.position.x,
    fromZ = movingPiece.position.z,
    validateWithCallback = true,
    triggerMoveCallback = true,
    isPremove = false,
  ): boolean {
    // Validate move through callback if provided
    if (validateWithCallback && onMoveAttempt) {
      const normalizedFromX = getSquareCoordinate(fromX);
      const normalizedFromZ = getSquareCoordinate(fromZ);
      const uci = coordinatesToUci(normalizedFromX, normalizedFromZ, targetX, targetZ);
      if (!onMoveAttempt(uci)) {
        return false; // Move rejected by validation callback
      }
    }

    const fromSquareX = getSquareCoordinate(fromX);
    const fromSquareZ = getSquareCoordinate(fromZ);
    const targetSquareX = getSquareCoordinate(targetX);
    const targetSquareZ = getSquareCoordinate(targetZ);
    const occupyingPiece = getPieceAtSquare(scene, targetX, targetZ, movingPiece);
    if (!occupyingPiece) {
      movingPiece.position.set(targetX, movingPiece.position.y, targetZ);
      setLastMoveHighlights(fromSquareX, fromSquareZ, targetX, targetZ);
      if (triggerMoveCallback) {
        onMove?.(
          coordinatesToSquare(fromSquareX, fromSquareZ),
          coordinatesToSquare(targetSquareX, targetSquareZ),
          isPremove,
        );
      }
      return true;
    }

    if (!isOppositeColor(movingPiece, occupyingPiece)) {
      return false;
    }

    occupyingPiece.removeFromParent();
    movingPiece.position.set(targetX, movingPiece.position.y, targetZ);
    setLastMoveHighlights(fromSquareX, fromSquareZ, targetX, targetZ);
    if (triggerMoveCallback) {
      onMove?.(
        coordinatesToSquare(fromSquareX, fromSquareZ),
        coordinatesToSquare(targetSquareX, targetSquareZ),
        isPremove,
      );
    }
    return true;
  }

  // Routes a user-initiated move: plays it immediately if it's the piece's turn,
  // otherwise queues it as a premove when the destination is a valid premove square.
  function attemptInteractionMove(
    piece: THREE.Mesh,
    targetX: number,
    targetZ: number,
    fromX = piece.position.x,
    fromZ = piece.position.z,
  ): boolean {
    if (!isPremoveCandidate(piece)) {
      return applyMoveOrCapture(piece, targetX, targetZ, fromX, fromZ);
    }

    const fromSquareX = getSquareCoordinate(fromX);
    const fromSquareZ = getSquareCoordinate(fromZ);
    const targetSquareX = getSquareCoordinate(targetX);
    const targetSquareZ = getSquareCoordinate(targetZ);
    const orig = coordinatesToSquare(fromSquareX, fromSquareZ);
    const dest = coordinatesToSquare(targetSquareX, targetSquareZ);
    if (!premoveDests?.get(orig)?.includes(dest)) {
      return false;
    }

    queuedPremove = { orig, dest };
    updatePremoveHighlight();
    onPremoveSet?.(orig, dest);
    return true;
  }

  function setMoveAttemptCallback(callback: (uci: string) => boolean) {
    onMoveAttempt = callback;
  }

  function setMoveCallback(callback: (from: Key, to: Key, isPremove: boolean) => void) {
    onMove = callback;
  }

  function setAllowedMoveDests(dests?: Map<Key, readonly Key[]>, nextShowDests = true) {
    allowedMoveDests = dests;
    showDests = nextShowDests;
    if (selectedPiece) {
      showSelectableMoveHighlights(selectedPiece);
    } else {
      clearSelectableMoveHighlights();
    }
  }

  function setTurnColor(color?: Color) {
    turnColor = color;
    if (selectedPiece) {
      showSelectableMoveHighlights(selectedPiece);
    }
  }

  function setState(newState: State | null) {
    state = newState;
  }

  function setUserShapesGroup(group: THREE.Group) {
    userShapesGroup = group;
  }

  function setMovableColor(color?: Color | 'both') {
    movableColor = color;
    if (selectedPiece) {
      showSelectableMoveHighlights(selectedPiece);
    }
  }

  function setPremoveDests(dests?: Map<Key, readonly Key[]>, nextShowDests = true) {
    premoveDests = dests;
    showPremoveDests = nextShowDests;
    if (selectedPiece && isPremoveCandidate(selectedPiece)) {
      showSelectableMoveHighlights(selectedPiece);
    }
  }

  function setPremoveCallbacks(callbacks: { onSet?: (orig: Key, dest: Key) => void; onUnset?: () => void }) {
    onPremoveSet = callbacks.onSet;
    onPremoveUnset = callbacks.onUnset;
  }

  function getQueuedPremove() {
    return queuedPremove;
  }

  function cancelQueuedPremove() {
    if (!queuedPremove) {
      return;
    }

    queuedPremove = undefined;
    updatePremoveHighlight();
    onPremoveUnset?.();
  }

  function playQueuedPremove(): boolean {
    if (!queuedPremove) {
      return false;
    }

    const { orig, dest } = queuedPremove;
    queuedPremove = undefined;
    updatePremoveHighlight();

    const source = keyToCoordinates(orig);
    const target = keyToCoordinates(dest);
    if (!source || !target) {
      return false;
    }

    const movingPiece = getPieceAtSquare(scene, source.x, source.z);
    if (!movingPiece) {
      return false;
    }

    return applyMoveOrCapture(
      movingPiece,
      getSquareCoordinate(target.x),
      getSquareCoordinate(target.z),
      source.x,
      source.z,
      true,
      true,
      true,
    );
  }

  function setInteractionEnabled(enabled: boolean) {
    interactionEnabled = enabled;
    if (!interactionEnabled) {
      if (dragState) {
        restoreHiddenPiece();
        dragState.piece.position.copy(dragState.startPosition);
        dragState.piece.position.y = dragState.startPosition.y;
        hoverController.setDraggedPiece(null);
        hoverController.setIgnoredPiece(null);
        if (renderer.domElement.hasPointerCapture(dragState.pointerId)) {
          renderer.domElement.releasePointerCapture(dragState.pointerId);
        }
        dragState = null;
      }
      clearSelection();
      hoverController.setEnabled(false);
      controls.enabled = true;
      return;
    }

    hoverController.setEnabled(true);
  }

  function setAllowWhiteInteraction(allow: boolean) {
    allowWhiteInteraction = allow;
    hoverController.setPieceHighlightFilter(canInteractWithPiece);
    if (selectedPiece && !canInteractWithPiece(selectedPiece)) {
      clearSelection();
    }
  }

  function setAllowBlackInteraction(allow: boolean) {
    allowBlackInteraction = allow;
    hoverController.setPieceHighlightFilter(canInteractWithPiece);
    if (selectedPiece && !canInteractWithPiece(selectedPiece)) {
      clearSelection();
    }
  }

  function setDraggable(enabled: boolean) {
    draggable = enabled;
    if (!draggable && dragState) {
      restoreHiddenPiece();
      dragState.piece.position.copy(dragState.startPosition);
      hoverController.setDraggedPiece(null);
      hoverController.setIgnoredPiece(null);
      if (renderer.domElement.hasPointerCapture(dragState.pointerId)) {
        renderer.domElement.releasePointerCapture(dragState.pointerId);
      }
      dragState = null;
      controls.enabled = true;
      hoverController.setEnabled(true);
    }
  }

  function setSelectable(enabled: boolean) {
    selectable = enabled;
    if (!selectable) {
      clearSelection();
    }
  }

  function moveProgrammaticallyByCoordinates(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
  ): boolean {
    if (dragState) {
      return false;
    }

    const sourceX = getSquareCoordinate(fromX);
    const sourceZ = getSquareCoordinate(fromZ);
    const targetX = getSquareCoordinate(toX);
    const targetZ = getSquareCoordinate(toZ);
    if (!isWithinBoard(sourceX, sourceZ) || !isWithinBoard(targetX, targetZ)) {
      return false;
    }

    const movingPiece = getPieceAtSquare(scene, sourceX, sourceZ);
    if (!movingPiece) {
      return false;
    }

    const moved = applyMoveOrCapture(movingPiece, targetX, targetZ, sourceX, sourceZ, false, false);
    if (!moved) {
      return false;
    }

    clearSelection();
    return true;
  }

  function moveProgrammaticallyBySquare(from: Key, to: Key): boolean {
    const source = keyToCoordinates(from);
    const target = keyToCoordinates(to);
    if (!source || !target) {
      return false;
    }

    return moveProgrammaticallyByCoordinates(source.x, source.z, target.x, target.z);
  }

  function selectSquare(key: Key | null) {
    if (!key) {
      clearSelection();
      return;
    }

    const coords = keyToCoordinates(key);
    if (!coords) {
      clearSelection();
      return;
    }

    const targetPiece = getPieceAtSquare(scene, coords.x, coords.z);

    if (selectedPiece) {
      if (targetPiece === selectedPiece) {
        if (isQueuedPremoveOrigin(targetPiece)) {
          cancelQueuedPremove();
        }
        clearSelection();
        return;
      }

      if (targetPiece && isOppositeColor(selectedPiece, targetPiece)) {
        if (attemptInteractionMove(selectedPiece, coords.x, coords.z)) {
          clearSelection();
          return;
        }
      }

      if (targetPiece && canInteractWithPiece(targetPiece)) {
        selectPiece(targetPiece);
        return;
      }

      if (!targetPiece) {
        if (attemptInteractionMove(selectedPiece, coords.x, coords.z)) {
          clearSelection();
          return;
        }
      }

      return;
    }

    if (targetPiece && canInteractWithPiece(targetPiece)) {
      selectPiece(targetPiece);
    }
  }

  function handleSelectedPieceClickTarget(event: PointerEvent): boolean {
    if (!selectedPiece || event.button !== 0) {
      return false;
    }

    pointerRaycaster.setFromCamera(pointerNdcFromEvent(event, pointerNdc), camera);

    const targetPiece = getPieceUnderPointer(event);
    if (targetPiece) {
      if (targetPiece === selectedPiece) {
        if (isQueuedPremoveOrigin(targetPiece)) {
          cancelQueuedPremove();
        }
        clearSelection();
        return true;
      }

      if (isOppositeColor(selectedPiece, targetPiece)) {
        const targetX = targetPiece.position.x;
        const targetZ = targetPiece.position.z;
        if (attemptInteractionMove(selectedPiece, targetX, targetZ)) {
          clearSelection();
          return true;
        }
      }

      if (!canInteractWithPiece(targetPiece)) {
        return true;
      }

      selectPiece(targetPiece);
      return true;
    }

    const hasBoardIntersection = pointerRaycaster.ray.intersectPlane(boardPlane, boardPoint) !== null;
    if (hasBoardIntersection) {
      board.worldToLocal(boardPoint);
    }
    if (!hasBoardIntersection || !isWithinBoard(boardPoint.x, boardPoint.z)) {
      return false;
    }

    const targetX = getSquareCoordinate(boardPoint.x);
    const targetZ = getSquareCoordinate(boardPoint.z);
    if (attemptInteractionMove(selectedPiece, targetX, targetZ)) {
      clearSelection();
    }

    return true;
  }

  let hiddenPiece: THREE.Mesh | null = null;

  function restoreHiddenPiece() {
    if (hiddenPiece) {
      hiddenPiece.visible = true;
      hiddenPiece = null;
    }
  }

  function dragPieceToPointer(event: PointerEvent) {
    if (!dragState) {
      return;
    }

    pointerRaycaster.setFromCamera(pointerNdcFromEvent(event, pointerNdc), camera);
    const hasBoardIntersection =
      pointerRaycaster.ray.intersectPlane(dragState.dragPlane, boardPoint) !== null;
    if (hasBoardIntersection) {
      board.worldToLocal(boardPoint);
    }
    if (
      !hasBoardIntersection ||
      !isWithinBoard(boardPoint.x + dragState.pointerOffsetX, boardPoint.z + dragState.pointerOffsetZ)
    ) {
      restoreHiddenPiece();
      return;
    }

    dragState.piece.position.x = boardPoint.x + dragState.pointerOffsetX;
    dragState.piece.position.z = boardPoint.z + dragState.pointerOffsetZ;
    dragState.piece.position.y = dragState.startPosition.y;

    const hoveredPiece = getPieceAtSquare(
      scene,
      getSquareCoordinate(boardPoint.x + dragState.pointerOffsetX),
      getSquareCoordinate(boardPoint.z + dragState.pointerOffsetZ),
      dragState.piece,
    );
    const nextHidden = hoveredPiece && isOppositeColor(dragState.piece, hoveredPiece) ? hoveredPiece : null;
    if (nextHidden !== hiddenPiece) {
      restoreHiddenPiece();
      if (nextHidden) {
        nextHidden.visible = false;
        hiddenPiece = nextHidden;
      }
    }
  }

  function finishDrag(event: PointerEvent) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    restoreHiddenPiece();
    const { piece, startPosition } = dragState;

    if (!dragState.hasMoved) {
      piece.position.copy(startPosition);
      piece.position.y = startPosition.y;
      dragState = null;
      hoverController.setDraggedPiece(null);
      hoverController.setIgnoredPiece(null);
      controls.enabled = true;
      hoverController.setEnabled(true);

      if (selectedPiece === piece) {
        clearSelection();
      } else if (selectable) {
        selectPiece(piece);
      }

      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }

      return;
    }

    pointerRaycaster.setFromCamera(pointerNdcFromEvent(event, pointerNdc), camera);
    const hasBoardIntersection =
      pointerRaycaster.ray.intersectPlane(dragState.dragPlane, boardPoint) !== null;
    if (hasBoardIntersection) {
      board.worldToLocal(boardPoint);
    }

    let dropApplied = false;
    const wasPremoveAttempt = isPremoveCandidate(piece);
    if (hasBoardIntersection) {
      const dropX = boardPoint.x + dragState.pointerOffsetX;
      const dropZ = boardPoint.z + dragState.pointerOffsetZ;
      if (isWithinBoard(dropX, dropZ)) {
        const targetX = getSquareCoordinate(dropX);
        const targetZ = getSquareCoordinate(dropZ);
        dropApplied = attemptInteractionMove(piece, targetX, targetZ, startPosition.x, startPosition.z);
      }
    }

    // a queued premove doesn't move the piece yet, so the drag must always snap back
    if (!dropApplied || wasPremoveAttempt) {
      piece.position.copy(startPosition);
    }

    piece.position.y = startPosition.y;
    hoverController.setDraggedPiece(null);
    clearSelection();
    dragState = null;
    hoverController.setIgnoredPiece(null);
    controls.enabled = true;
    hoverController.setEnabled(true);

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
  }

  renderer.domElement.addEventListener(
    'pointerdown',
    event => {
      // we just handle left-click interactions
      if (!interactionEnabled) {
        return;
      }

      if (drawEnabled) {
        event.stopPropagation();
      }

      pointerRaycaster.setFromCamera(pointerNdcFromEvent(event, pointerNdc), camera);
      const hasBoardIntersection = pointerRaycaster.ray.intersectPlane(boardPlane, boardPoint) !== null;
      if (hasBoardIntersection) {
        board.worldToLocal(boardPoint);
      }

      if (event.button === 2 && drawEnabled) {
        if (hasBoardIntersection && isWithinBoard(boardPoint.x, boardPoint.z)) {
          const fromX = getSquareCoordinate(boardPoint.x);
          const fromY = getSquareCoordinate(boardPoint.z);
          const brush = event.shiftKey ? 'red' : event.altKey ? 'blue' : event.ctrlKey ? 'red' : 'green';
          drawState = {
            pointerId: event.pointerId,
            fromX,
            fromY,
            toX: fromX,
            toY: fromY,
            shapeMesh: createCircleMesh(fromX, fromY, brush, 1),
            brush,
          };
          board.add(drawState.shapeMesh);
        }
      }

      if (event.button !== 0) {
        return;
      }

      if (state?.drawable) {
        state.drawable.shapes = [];
        if (userShapesGroup) {
          updateMeshesFromShapes(userShapesGroup, state.drawable.shapes, state.drawable.brushes);
        }
      }
      state?.drawable?.onChange?.(state.drawable.shapes);

      const pieceHit = getPieceHitUnderPointer(event);
      if (!pieceHit) {
        if (selectedPiece) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const { piece } = pieceHit;

      if (!canInteractWithPiece(piece)) {
        return;
      }

      if (!draggable) {
        event.stopPropagation();
        clickState = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
        };
        return;
      }

      // If a piece is pinned, clicking another piece should act as a click target,
      // not start a drag on the clicked piece.
      if (selectedPiece && piece !== selectedPiece) {
        event.stopPropagation();

        if (isOppositeColor(selectedPiece, piece)) {
          const targetX = piece.position.x;
          const targetZ = piece.position.z;
          if (attemptInteractionMove(selectedPiece, targetX, targetZ)) {
            clearSelection();
            return;
          }
        }

        selectPiece(piece);
        return;
      }

      event.stopPropagation();
      const grabPoint = pieceHit.point.clone();
      board.worldToLocal(grabPoint);
      const pointerOffsetX = piece.position.x - grabPoint.x;
      const pointerOffsetZ = piece.position.z - grabPoint.z;

      dragState = {
        piece,
        pointerId: event.pointerId,
        startPosition: piece.position.clone(),
        startClientX: event.clientX,
        startClientY: event.clientY,
        pointerOffsetX,
        pointerOffsetZ,
        dragPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -pieceHit.point.y),
        hasMoved: false,
      };
      controls.enabled = false;
      hoverController.setPinnedPiece(piece);
      hoverController.setIgnoredPiece(piece);
      hoverController.updateFromPointerEvent(event);
      renderer.domElement.setPointerCapture(event.pointerId);
    },
    { capture: true },
  );

  function handleDraw(event: PointerEvent) {
    if (drawState && event.pointerId === drawState.pointerId) {
      pointerRaycaster.setFromCamera(pointerNdcFromEvent(event, pointerNdc), camera);
      const hasBoardIntersection = pointerRaycaster.ray.intersectPlane(boardPlane, boardPoint) !== null;
      if (hasBoardIntersection) {
        board.worldToLocal(boardPoint);
      }
      if (hasBoardIntersection && isWithinBoard(boardPoint.x, boardPoint.z)) {
        const toX = getSquareCoordinate(boardPoint.x);
        const toY = getSquareCoordinate(boardPoint.z);
        if (toX !== drawState.toX || toY !== drawState.toY) {
          const brush = event.shiftKey ? 'red' : event.altKey ? 'blue' : event.ctrlKey ? 'red' : 'green';
          drawState.toX = toX;
          drawState.toY = toY;
          drawState.brush = brush;
          drawState.shapeMesh.removeFromParent();
          disposeShape(drawState.shapeMesh);
          if (drawState.toX === drawState.fromX && drawState.toY === drawState.fromY) {
            drawState.shapeMesh = createCircleMesh(drawState.fromX, drawState.fromY, brush, 1);
          } else {
            drawState.shapeMesh = createArrowMesh(
              drawState.fromX,
              drawState.fromY,
              drawState.toX,
              drawState.toY,
              brush,
              1,
            );
          }
          board.add(drawState.shapeMesh);
          event.stopPropagation();
        }
      }
    }
  }

  renderer.domElement.addEventListener('pointermove', event => {
    if (!interactionEnabled) {
      return;
    }

    if (drawState && event.pointerId === drawState.pointerId) {
      handleDraw(event);
    }

    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    hoverController.updateFromPointerEvent(event);

    if (!dragState.hasMoved) {
      const deltaX = event.clientX - dragState.startClientX;
      const deltaY = event.clientY - dragState.startClientY;
      const movement = Math.hypot(deltaX, deltaY);
      if (movement < dragThresholdPx) {
        return;
      }

      dragState.hasMoved = true;
      if (selectedPiece === dragState.piece) {
        clearSelection();
      }

      const dragStartSquare = coordinatesToSquare(dragState.startPosition.x, dragState.startPosition.z);
      showSelectableMoveHighlights(dragState.piece, dragStartSquare);
      hoverController.setDraggedPiece(dragState.piece);
    }

    dragPieceToPointer(event);
  });

  renderer.domElement.addEventListener('pointerup', event => {
    if (!interactionEnabled) {
      return;
    }

    if (event.button === 2 && drawState && event.pointerId === drawState.pointerId) {
      handleDraw(event);
      const orig = coordinatesToSquare(drawState.fromX, drawState.fromY);
      const dest = coordinatesToSquare(drawState.toX, drawState.toY);
      const brush = drawState.brush;

      const shapes = state?.drawable?.shapes || [];

      let shapeFound = false;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const shape = shapes[i];

        if (shape.orig === orig && (shape.dest === dest || (orig === dest && !shape.dest))) {
          if (shape.brush === brush) {
            shapes.splice(i, 1);
          } else {
            shape.brush = brush;
          }
          shapeFound = true;
          break;
        }
      }

      if (!shapeFound) {
        shapes.push({
          orig,
          dest,
          brush,
        });
      }
      if (state?.drawable) {
        state.drawable.shapes = shapes;
        if (userShapesGroup) {
          updateMeshesFromShapes(userShapesGroup, shapes, state.drawable.brushes);
        }
      }

      drawState.shapeMesh.removeFromParent();
      disposeShape(drawState.shapeMesh);
      drawState = null;
      state?.drawable?.onChange?.(shapes);
    }

    if (event.button !== 0) {
      return;
    }
    if (dragState && event.pointerId === dragState.pointerId) {
      finishDrag(event);
      return;
    }

    if (clickState && event.pointerId === clickState.pointerId) {
      const deltaX = event.clientX - clickState.startClientX;
      const deltaY = event.clientY - clickState.startClientY;
      const movedPastClickThreshold = Math.hypot(deltaX, deltaY) >= dragThresholdPx;
      clickState = null;
      if (movedPastClickThreshold) {
        return;
      }
    }

    if (selectable) {
      if (!selectedPiece) {
        const piece = getPieceUnderPointer(event);
        if (piece && canInteractWithPiece(piece)) {
          selectPiece(piece);
        }
      } else {
        handleSelectedPieceClickTarget(event);
      }
    }
  });

  renderer.domElement.addEventListener('pointercancel', event => {
    if (clickState?.pointerId === event.pointerId) {
      clickState = null;
    }

    if (!interactionEnabled) {
      return;
    }

    finishDrag(event);
  });

  // right-click cancels a queued premove, mirroring lichess's board behavior
  renderer.domElement.addEventListener('contextmenu', event => {
    event.preventDefault();
    if (interactionEnabled) {
      cancelQueuedPremove();
    }
  });

  renderer.domElement.addEventListener('dblclick', event => {
    drawEnabled = !drawEnabled;
    event.preventDefault();
  });

  return {
    moveProgrammaticallyBySquare,
    selectSquare,
    setLastMoveSquares,
    setAllowedMoveDests,
    setMoveAttemptCallback,
    setMoveCallback,
    setAllowWhiteInteraction,
    setAllowBlackInteraction,
    setDraggable,
    setSelectable,
    setInteractionEnabled,
    setTurnColor,
    setMovableColor,
    setPremoveDests,
    setPremoveCallbacks,
    getQueuedPremove,
    playQueuedPremove,
    cancelQueuedPremove,
    setState,
    setUserShapesGroup,
  };
}
