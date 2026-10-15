import { type State } from '@lichess-org/chessground/state';
import * as THREE from 'three';

import { createArrowMesh, createCircleMesh } from '../objects/createShapes.js';

import { disposeShape, updateMeshesFromShapes } from './shapes.js';
import { coordinatesToSquare, getSquareCoordinate, isWithinBoard } from './util.js';

type DrawState = {
  pointerId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  shapeMesh: THREE.Mesh;
  brush: string;
};

export type ShapeDrawingController = {
  start(event: PointerEvent): void;
  move(event: PointerEvent): void;
  finish(event: PointerEvent): void;
  clear(): void;
};

export function createShapeDrawingController(
  board: THREE.Group,
  camera: THREE.Camera,
  domElement: HTMLElement,
  getState: () => State | null,
  getUserShapesGroup: () => THREE.Group | null,
): ShapeDrawingController {
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const boardPoint = new THREE.Vector3();
  let drawState: DrawState | null = null;

  function getBoardPoint(event: PointerEvent): THREE.Vector3 | null {
    const rect = domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    if (!raycaster.ray.intersectPlane(boardPlane, boardPoint)) {
      return null;
    }

    board.worldToLocal(boardPoint);
    return boardPoint;
  }

  function brushForEvent(event: PointerEvent): string {
    return event.shiftKey ? 'red' : event.altKey ? 'blue' : event.ctrlKey ? 'red' : 'green';
  }

  function handleDraw(event: PointerEvent) {
    if (!drawState || event.pointerId !== drawState.pointerId) {
      return;
    }

    const boardPoint = getBoardPoint(event);
    if (!boardPoint || !isWithinBoard(boardPoint.x, boardPoint.z)) {
      return;
    }

    const toX = getSquareCoordinate(boardPoint.x);
    const toY = getSquareCoordinate(boardPoint.z);
    if (toX === drawState.toX && toY === drawState.toY) {
      return;
    }

    const brush = brushForEvent(event);
    drawState.toX = toX;
    drawState.toY = toY;
    drawState.brush = brush;
    drawState.shapeMesh.removeFromParent();
    disposeShape(drawState.shapeMesh);
    drawState.shapeMesh =
      drawState.toX === drawState.fromX && drawState.toY === drawState.fromY
        ? createCircleMesh(drawState.fromX, drawState.fromY, brush, 1)
        : createArrowMesh(drawState.fromX, drawState.fromY, drawState.toX, drawState.toY, brush, 1);
    board.add(drawState.shapeMesh);
    event.stopPropagation();
  }

  function start(event: PointerEvent) {
    if (event.button !== 2) {
      return;
    }

    const boardPoint = getBoardPoint(event);
    if (!boardPoint || !isWithinBoard(boardPoint.x, boardPoint.z)) {
      return;
    }

    const fromX = getSquareCoordinate(boardPoint.x);
    const fromY = getSquareCoordinate(boardPoint.z);
    const brush = brushForEvent(event);
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

  function clear() {
    const state = getState();
    const userShapesGroup = getUserShapesGroup();
    if (state?.drawable) {
      state.drawable.shapes = [];
      if (userShapesGroup) {
        updateMeshesFromShapes(userShapesGroup, state.drawable.shapes, state.drawable.brushes);
      }
    }
    state?.drawable?.onChange?.(state.drawable.shapes);
  }

  function finish(event: PointerEvent) {
    if (event.button !== 2 || !drawState || event.pointerId !== drawState.pointerId) {
      return;
    }

    handleDraw(event);
    const orig = coordinatesToSquare(drawState.fromX, drawState.fromY);
    const dest = coordinatesToSquare(drawState.toX, drawState.toY);
    const { brush } = drawState;
    const state = getState();
    const userShapesGroup = getUserShapesGroup();
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
      shapes.push({ orig, dest, brush });
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

  return {
    start,
    move: handleDraw,
    finish,
    clear,
  };
}
