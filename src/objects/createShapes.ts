import * as THREE from 'three';

const ARROW_HEIGHT = 0.02;
const SHAFT_WIDTH = 0.12;
const HEAD_WIDTH = 0.6;
const HEAD_LENGTH = 0.5;
const TIP_GAP = 0.2; // leave room near the destination square center

export function createArrowMesh(
  origX: number,
  origZ: number,
  destX: number,
  destZ: number,
  color: string,
  opacity: number,
): THREE.Mesh {
  const dx = destX - origX;
  const dz = destZ - origZ;
  const length = Math.hypot(dx, dz);
  const effectiveLength = Math.max(length - TIP_GAP, 0.01);
  const headLength = Math.min(HEAD_LENGTH, effectiveLength);
  const shaftEnd = effectiveLength - headLength;

  const ux = dx / length;
  const uz = dz / length;
  const px = -uz;
  const pz = ux;

  const point = (u: number, v: number) =>
    new THREE.Vector3(origX + ux * u + px * v, ARROW_HEIGHT, origZ + uz * u + pz * v);

  const shaftStartLeft = point(0, SHAFT_WIDTH / 2);
  const shaftStartRight = point(0, -SHAFT_WIDTH / 2);
  const shaftEndLeft = point(shaftEnd, SHAFT_WIDTH / 2);
  const shaftEndRight = point(shaftEnd, -SHAFT_WIDTH / 2);
  const headBaseLeft = point(shaftEnd, HEAD_WIDTH / 2);
  const headBaseRight = point(shaftEnd, -HEAD_WIDTH / 2);
  const tip = point(effectiveLength, 0);

  const vertices = [
    shaftStartLeft,
    shaftStartRight,
    shaftEndRight,
    shaftStartLeft,
    shaftEndRight,
    shaftEndLeft,
    headBaseLeft,
    headBaseRight,
    tip,
  ];

  const positions = new Float32Array(vertices.length * 3);
  vertices.forEach((v, i) => v.toArray(positions, i * 3));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 12;
  return mesh;
}

const CIRCLE_OUTER_RADIUS = 0.47; // squares are 1x1, so the ring stays inside its square
const CIRCLE_INNER_RADIUS = 0.4;

export function createCircleMesh(x: number, z: number, color: string, opacity: number): THREE.Mesh {
  const geometry = new THREE.RingGeometry(CIRCLE_INNER_RADIUS, CIRCLE_OUTER_RADIUS, 64);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, ARROW_HEIGHT, z);
  mesh.renderOrder = 12;
  return mesh;
}

const CUSTOM_SVG_HEIGHT = 0.021;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function centerAppleGraphic(svgMarkup: string): string {
  const parsed = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || !svg.querySelector('g.apple')) {
    return svgMarkup;
  }

  const measuringSvg = svg.cloneNode(true) as SVGSVGElement;
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '-10000px';
  container.style.visibility = 'hidden';
  document.body.appendChild(container);
  container.appendChild(measuringSvg);

  try {
    const appleGroup = measuringSvg.querySelector('g.apple');
    const parent = appleGroup?.parentElement;
    if (!appleGroup || !parent) {
      return svgMarkup;
    }

    const centeringGroup = document.createElementNS(SVG_NAMESPACE, 'g');
    parent.insertBefore(centeringGroup, appleGroup);
    centeringGroup.appendChild(appleGroup);
    const bounds = centeringGroup.getBBox();
    const viewBox = measuringSvg.viewBox.baseVal;
    const centerX = viewBox.width ? viewBox.x + viewBox.width / 2 : 50;
    const centerY = viewBox.height ? viewBox.y + viewBox.height / 2 : 50;
    centeringGroup.setAttribute(
      'transform',
      `translate(${centerX - bounds.x - bounds.width / 2} ${centerY - bounds.y - bounds.height / 2})`,
    );

    return new XMLSerializer().serializeToString(measuringSvg);
  } finally {
    container.remove();
  }
}

export function createCustomSvgMesh(x: number, z: number, svgHtml: string, size = 2.0): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, CUSTOM_SVG_HEIGHT, z);
  mesh.renderOrder = 13;
  mesh.userData.keepUpright = true;

  const isAppleGraphic = svgHtml.includes('<g class="apple');
  const trimmedSvg = svgHtml.trim();
  let fullSvg: string;
  if (trimmedSvg.startsWith('<svg')) {
    fullSvg = trimmedSvg;
  } else {
    // The 200x200 viewBox lets badges and drop shadows overlap adjacent squares without clipping.
    const transform = isAppleGraphic ? '' : ' transform="translate(0, 84)"';
    fullSvg = `<svg xmlns="${SVG_NAMESPACE}" viewBox="-50 -50 200 200" width="512" height="512" style="overflow: visible"><g${transform}>${svgHtml}</g></svg>`;
  }
  if (isAppleGraphic) {
    fullSvg = centerAppleGraphic(fullSvg);
  }

  const blob = new Blob([fullSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  img.onload = () => {
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      texture.needsUpdate = true;
    }
    URL.revokeObjectURL(url);
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
  };

  img.src = url;

  return mesh;
}
