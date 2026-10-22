import { type State } from '@lichess-org/chessground/state';
import { type Color, type Key, type Piece } from '@lichess-org/chessground/types';
import * as THREE from 'three';

import {
  createLastMoveFromHighlightMarker,
  createLastMoveToHighlightMarker,
  createPremoveHighlightMarker,
  createSelectedSquareMarker,
} from '../objects/createMarkers';

import { createPieceHoverController } from './hover';
import { clearMoveDestinationHighlights, updateMoveDestinationHighlights } from './moveDestinationHighlight';
import { createShapeDrawingController } from './shapeDrawing.js';
import {
  coordinatesToSquare,
  getPieceAtSquare,
  getPieceMeshFromObject,
  getSquareCoordinate,
  isWithinBoard,
  keyToCoordinates,
} from './util';

const pieceRoleByCode: Record<string, Piece['role']> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
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
  animateMove: (
    piece: THREE.Mesh,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    destination: Key,
  ) => void;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
};

type MoveResult = {
  success: boolean;
  capture?: Piece;
};

export type PieceInteractionController = {
  moveProgrammaticallyBySquare: (from: Key, to: Key) => boolean;
  selectSquare: (key: Key | null) => void;
  setLastMoveSquares: (squares?: readonly Key[]) => void;
  setMoveAttemptCallback: (callback: (uci: string) => boolean) => void; // Set callback for validating user moves
  setMoveCallback: (callback: (from: Key, to: Key, isPremove: boolean) => void) => void; // Set callback after a successful move
  setAllowWhiteInteraction: (allow: boolean) => void;
  setAllowBlackInteraction: (allow: boolean) => void;
  setDraggable: (enabled: boolean) => void;
  setSelectable: (enabled: boolean) => void;
  setInteractionEnabled: (enabled: boolean) => void;
  setPremoveDests: (dests?: Map<Key, readonly Key[]>) => void;
  setPremoveCallbacks: (callbacks: { onSet?: (orig: Key, dest: Key) => void; onUnset?: () => void }) => void;
  getQueuedPremove: () => { orig: Key; dest: Key } | undefined;
  playQueuedPremove: () => boolean; // attempt to play the queued premove now; always clears it
  cancelQueuedPremove: () => void;
  setState: (newState: State | null) => void;
  setUserShapesGroup: (group: THREE.Group) => void;
  update: () => void;
  destroy: () => void;
};

export function setupInteractions({
  scene,
  board,
  animateMove,
  camera,
  renderer,
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
  const selectedSquareHighlight = createSelectedSquareMarker();
  const selectableMoveHighlights = new THREE.Group();
  lastMoveFromHighlight.rotation.x = -Math.PI / 2;
  lastMoveToHighlight.rotation.x = -Math.PI / 2;
  lastMoveFromHighlight.position.y = 0.005;
  lastMoveToHighlight.position.y = 0.006;
  lastMoveFromHighlight.visible = false;
  lastMoveToHighlight.visible = false;
  lastMoveFromHighlight.renderOrder = 8;
  lastMoveToHighlight.renderOrder = 9;
  selectedSquareHighlight.rotation.x = -Math.PI / 2;
  selectedSquareHighlight.position.y = 0.007;
  selectedSquareHighlight.visible = false;
  selectedSquareHighlight.renderOrder = 10;
  board.add(lastMoveFromHighlight);
  board.add(lastMoveToHighlight);
  board.add(premoveFromHighlight);
  board.add(premoveToHighlight);
  board.add(selectedSquareHighlight);
  board.add(selectableMoveHighlights);

  let state: State | null = null;
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
  let turnColor: Color | undefined;
  let movableColor: Color | 'both' | undefined;
  let premoveDests: Map<Key, readonly Key[]> | undefined;
  let queuedPremove: { orig: Key; dest: Key } | undefined;
  let onPremoveSet: ((orig: Key, dest: Key) => void) | undefined;
  let onPremoveUnset: (() => void) | undefined;
  let userShapesGroup: THREE.Group | null = null;
  const shapeDrawing = createShapeDrawingController(
    board,
    camera,
    renderer.domElement,
    () => state,
    () => userShapesGroup,
  );
  const hoverController = createPieceHoverController(scene, camera, renderer.domElement, board);

  function pointerNdcFromEvent(event: PointerEvent, out: THREE.Vector2 = new THREE.Vector2()): THREE.Vector2 {
    const rect = renderer.domElement.getBoundingClientRect();
    out.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    out.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return out;
  }

  function isWhitePiece(piece: THREE.Mesh): boolean {
    return piece.name === piece.name.toUpperCase();
  }

  function pieceFromMesh(piece: THREE.Mesh): Piece {
    const role = pieceRoleByCode[piece.name.toLowerCase()];
    if (!role) {
      throw new Error(`Unknown piece code: ${piece.name}`);
    }

    return { role, color: isWhitePiece(piece) ? 'white' : 'black' };
  }

  function isOppositeColor(a: THREE.Mesh, b: THREE.Mesh): boolean {
    return isWhitePiece(a) !== isWhitePiece(b);
  }

  function canInteractWithPiece(piece: THREE.Mesh): boolean {
    return isWhitePiece(piece) ? allowWhiteInteraction : allowBlackInteraction;
  }

  // Convert board coordinates to square notation (a1-h8)
  function coordinatesToUci(fromX: number, fromZ: number, toX: number, toZ: number): string {
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
    const show = isPremove ? state?.premovable?.showDests : state?.movable?.showDests;
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

  function canPieceMove(piece: THREE.Mesh): boolean {
    const dests = isPremoveCandidate(piece) ? premoveDests : allowedMoveDests;
    if (!dests) {
      return true;
    }
    const key = coordinatesToSquare(
      getSquareCoordinate(piece.position.x),
      getSquareCoordinate(piece.position.z),
    );
    return (dests.get(key)?.length ?? 0) > 0;
  }

  // Mouse down on the square of a movable piece, but not on the piece itself
  function getMovablePieceOnSquareUnderPointer(event: PointerEvent): THREE.Mesh | null {
    pointerRaycaster.setFromCamera(pointerNdcFromEvent(event, pointerNdc), camera);
    if (pointerRaycaster.ray.intersectPlane(boardPlane, boardPoint) === null) {
      return null;
    }
    board.worldToLocal(boardPoint);
    if (!isWithinBoard(boardPoint.x, boardPoint.z)) {
      return null;
    }
    const piece = getPieceAtSquare(
      scene,
      getSquareCoordinate(boardPoint.x),
      getSquareCoordinate(boardPoint.z),
    );
    return piece && canInteractWithPiece(piece) && canPieceMove(piece) ? piece : null;
  }

  function getPieceUnderPointer(event: PointerEvent): THREE.Mesh | null {
    return getPieceHitUnderPointer(event)?.piece ?? null;
  }

  function getSquareKeyUnderPointer(event: PointerEvent): Key | null {
    const targetPiece = getPieceUnderPointer(event);
    if (targetPiece) {
      return coordinatesToSquare(
        getSquareCoordinate(targetPiece.position.x),
        getSquareCoordinate(targetPiece.position.z),
      );
    }

    pointerRaycaster.setFromCamera(pointerNdcFromEvent(event, pointerNdc), camera);
    const hasBoardIntersection = pointerRaycaster.ray.intersectPlane(boardPlane, boardPoint) !== null;
    if (!hasBoardIntersection) {
      return null;
    }

    board.worldToLocal(boardPoint);
    if (!isWithinBoard(boardPoint.x, boardPoint.z)) {
      return null;
    }

    return coordinatesToSquare(getSquareCoordinate(boardPoint.x), getSquareCoordinate(boardPoint.z));
  }

  function clearSelection() {
    selectedPiece = null;
    clearSelectableMoveHighlights();
    selectedSquareHighlight.visible = false;
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

    if (isQueuedPremoveOrigin(piece)) {
      cancelQueuedPremove();
      clearSelection();
      return;
    }

    selectedPiece = piece;
    showSelectableMoveHighlights(piece);
    selectedSquareHighlight.visible = true;
    selectedSquareHighlight.position.x = getSquareCoordinate(piece.position.x);
    selectedSquareHighlight.position.z = getSquareCoordinate(piece.position.z);
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
  ): MoveResult {
    if (validateWithCallback && onMoveAttempt) {
      const normalizedFromX = getSquareCoordinate(fromX);
      const normalizedFromZ = getSquareCoordinate(fromZ);
      const uci = coordinatesToUci(normalizedFromX, normalizedFromZ, targetX, targetZ);
      if (!onMoveAttempt(uci)) {
        return { success: false };
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
      return { success: true };
    }

    if (!isOppositeColor(movingPiece, occupyingPiece)) {
      return { success: false };
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

    return { success: true, capture: pieceFromMesh(occupyingPiece) };
  }

  // User-initiated move: plays it immediately if it's the piece's turn,
  // otherwise queues it as a premove when the destination is a valid premove square.
  function attemptInteractionMove(
    piece: THREE.Mesh,
    targetX: number,
    targetZ: number,
    fromX = piece.position.x,
    fromZ = piece.position.z,
  ): boolean {
    if (!isPremoveCandidate(piece)) {
      return applyMoveOrCapture(piece, targetX, targetZ, fromX, fromZ).success;
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

  function setState(newState: State | null) {
    state = newState;
    turnColor = state?.turnColor;
    movableColor = state?.movable?.color;
    allowedMoveDests = state?.movable?.dests;
  }

  function setUserShapesGroup(group: THREE.Group) {
    userShapesGroup = group;
  }

  function setPremoveDests(dests?: Map<Key, readonly Key[]>) {
    premoveDests = dests;
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
    ).success;
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
      renderer.domElement.style.cursor = '';
      clearSelection();
      hoverController.setEnabled(false);
      return;
    }

    hoverController.setEnabled(true);
  }

  function setAllowWhiteInteraction(allow: boolean) {
    allowWhiteInteraction = allow;
    if (selectedPiece && !canInteractWithPiece(selectedPiece)) {
      clearSelection();
    }
  }

  function setAllowBlackInteraction(allow: boolean) {
    allowBlackInteraction = allow;
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
      renderer.domElement.style.cursor = '';
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
  ): MoveResult {
    if (dragState) {
      return { success: false };
    }

    const sourceX = getSquareCoordinate(fromX);
    const sourceZ = getSquareCoordinate(fromZ);
    const targetX = getSquareCoordinate(toX);
    const targetZ = getSquareCoordinate(toZ);
    if (!isWithinBoard(sourceX, sourceZ) || !isWithinBoard(targetX, targetZ)) {
      return { success: false };
    }

    const movingPiece = getPieceAtSquare(scene, sourceX, sourceZ);
    if (!movingPiece) {
      return { success: false };
    }

    const moved = applyMoveOrCapture(movingPiece, targetX, targetZ, sourceX, sourceZ, false, false);
    if (moved.success) {
      clearSelection();
      animateMove(movingPiece, sourceX, sourceZ, targetX, targetZ, coordinatesToSquare(targetX, targetZ));
    }

    return moved;
  }

  function moveProgrammaticallyBySquare(from: Key, to: Key): boolean {
    const source = keyToCoordinates(from);
    const target = keyToCoordinates(to);
    if (!source || !target) {
      return false;
    }

    const moveResult = moveProgrammaticallyByCoordinates(source.x, source.z, target.x, target.z);

    if (moveResult.success) {
      state?.events.move?.(from, to, moveResult.capture);
    }
    return moveResult.success;
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

    state?.events?.select?.(key);

    const targetPiece = getPieceAtSquare(scene, coords.x, coords.z);

    if (selectedPiece) {
      if (targetPiece === selectedPiece) {
        if (isQueuedPremoveOrigin(targetPiece)) {
          cancelQueuedPremove();
        }
        clearSelection();
        return;
      }

      const movingPiece = selectedPiece;
      const fromX = movingPiece.position.x;
      const fromZ = movingPiece.position.z;
      const played = attemptInteractionMove(movingPiece, coords.x, coords.z);
      clearSelection();
      // a queued premove leaves the piece where it was
      if (played && (movingPiece.position.x !== fromX || movingPiece.position.z !== fromZ)) {
        // the move callback may have rebuilt the pieces, so animate the mesh now at the destination
        const pieceAtDestination = getPieceAtSquare(scene, coords.x, coords.z);
        if (pieceAtDestination) {
          animateMove(pieceAtDestination, fromX, fromZ, coords.x, coords.z, key);
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

    const key = getSquareKeyUnderPointer(event);
    if (!key) {
      return false;
    }

    selectSquare(key);
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
      const clickedSquare = event.type === 'pointerup' ? getSquareKeyUnderPointer(event) : null;
      piece.position.copy(startPosition);
      piece.position.y = startPosition.y;
      dragState = null;
      hoverController.setDraggedPiece(null);
      hoverController.setIgnoredPiece(null);
      hoverController.setEnabled(true);

      if (clickedSquare) {
        state?.events?.select?.(clickedSquare);
      }

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
    hoverController.setEnabled(true);

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
  }

  renderer.domElement.addEventListener(
    'pointerdown',
    event => {
      if (!interactionEnabled) {
        return;
      }

      pointerRaycaster.setFromCamera(pointerNdcFromEvent(event, pointerNdc), camera);
      const hasBoardIntersection = pointerRaycaster.ray.intersectPlane(boardPlane, boardPoint) !== null;
      if (hasBoardIntersection) {
        board.worldToLocal(boardPoint);
      }

      shapeDrawing.start(event);

      if (event.button !== 0) {
        return;
      }

      shapeDrawing.clear();

      let pieceHit = getPieceHitUnderPointer(event);
      let snapToPointer = false;
      if (!pieceHit && draggable && !selectedPiece) {
        const squarePiece = getMovablePieceOnSquareUnderPointer(event);
        if (squarePiece) {
          const point = squarePiece.getWorldPosition(new THREE.Vector3());
          pointerRaycaster.setFromCamera(pointerNdcFromEvent(event, pointerNdc), camera);
          pointerRaycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y), point);
          pieceHit = { piece: squarePiece, point };
          snapToPointer = true;
        }
      }
      if (!pieceHit) {
        return;
      }
      const { piece } = pieceHit;

      if (selectedPiece && piece !== selectedPiece) {
        clickState = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
        };
        return;
      }

      if (!canInteractWithPiece(piece)) {
        return;
      }

      if (!draggable) {
        clickState = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
        };
        return;
      }

      const grabPoint = pieceHit.point.clone();
      board.worldToLocal(grabPoint);
      const pointerOffsetX = snapToPointer ? 0 : piece.position.x - grabPoint.x;
      const pointerOffsetZ = snapToPointer ? 0 : piece.position.z - grabPoint.z;

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
      hoverController.setIgnoredPiece(piece);
      hoverController.updateFromPointerEvent(event);
      renderer.domElement.setPointerCapture(event.pointerId);
      updateCursor(event);
    },
    { capture: true },
  );

  function updateCursor(event: PointerEvent) {
    const piece = !dragState && interactionEnabled ? getPieceUnderPointer(event) : null;
    renderer.domElement.style.cursor = dragState
      ? 'grabbing'
      : piece && canInteractWithPiece(piece)
        ? 'pointer'
        : '';
  }

  renderer.domElement.addEventListener('pointermove', event => {
    hoverController.updateFromPointerEvent(event);
    if (!interactionEnabled) {
      return;
    }

    updateCursor(event);

    shapeDrawing.move(event);

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

    shapeDrawing.finish(event);

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
        const key = getSquareKeyUnderPointer(event);
        if (key) {
          selectSquare(key);
        }
      } else {
        handleSelectedPieceClickTarget(event);
      }
    } else {
      const key = getSquareKeyUnderPointer(event);
      if (key) {
        state?.events?.select?.(key);
      }
    }
  });

  renderer.domElement.addEventListener('pointerup', updateCursor);

  renderer.domElement.addEventListener('pointercancel', event => {
    if (clickState?.pointerId === event.pointerId) {
      clickState = null;
    }

    if (!interactionEnabled) {
      return;
    }

    finishDrag(event);
    updateCursor(event);
  });

  renderer.domElement.addEventListener('pointerleave', () => {
    if (!dragState) {
      renderer.domElement.style.cursor = '';
    }
  });

  // prevents the context menu from popping when you draw a shape
  renderer.domElement.addEventListener('contextmenu', event => {
    event.preventDefault();
    if (interactionEnabled) {
      cancelQueuedPremove();
    }
  });

  function update() {
    hoverController.update();
  }

  function destroy() {
    // remove event listeners
  }

  return {
    moveProgrammaticallyBySquare,
    selectSquare,
    setLastMoveSquares,
    setMoveAttemptCallback,
    setMoveCallback,
    setAllowWhiteInteraction,
    setAllowBlackInteraction,
    setDraggable,
    setSelectable,
    setInteractionEnabled,
    setPremoveDests,
    setPremoveCallbacks,
    getQueuedPremove,
    playQueuedPremove,
    cancelQueuedPremove,
    setState,
    setUserShapesGroup,
    update,
    destroy,
  };
}
