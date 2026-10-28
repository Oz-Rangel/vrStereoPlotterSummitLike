/**
 * Pure, side-effect-free stereoplotter math (Summit Evolution architecture).
 *
 * Design rule: NO THREE.js imports, NO DOM access, NO module-level mutable state.
 * Everything here is a deterministic function of its arguments so it can be
 * exercised directly with `node --test` (see stereo-math.test.js).
 *
 * Coordinate conventions
 * ----------------------
 * - Pixel space: origin top-left, x right, y down, 0..widthUnits / 0..heightUnits.
 * - Plane-local space: origin at image centre, x right, y up, metres.
 * - Normalized space: nx = -0.5..+0.5 (left->right), ny = +0.5..-0.5 (top->bottom).
 */

export const PLANE_BASE_SIZE = 2.2; // metres — longest image side maps to this

export const Z_MIN = -150;
export const Z_MAX = 300;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3.5;

/** Clamp a scalar into [min, max]. */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Total horizontal disparity (pixels) for a point at elevation z.
 * totalParallax = baseParallax + z * parallaxPerMeter
 */
export function computeTotalParallax({ baseParallax = 0, z = 0, parallaxPerMeter = 0.5 } = {}) {
  return baseParallax + z * parallaxPerMeter;
}

/** Convert pixel coordinates into the reticle-centred normalized frame. */
export function pixelToNormalized(px, py, widthUnits, heightUnits) {
  return {
    nx: px / widthUnits - 0.5,
    ny: 0.5 - py / heightUnits
  };
}

/** Convert a pixel disparity into a plane-local metric offset. */
export function parallaxToPlaneOffset(parallaxPx, widthUnits, planeWidth) {
  return (parallaxPx / widthUnits) * planeWidth;
}

/**
 * Fit the 3D stereo planes to a loaded image's aspect ratio.
 * The longest side always maps to `baseSize` metres.
 */
export function computeImageDimensions(imgWidth, imgHeight, baseSize = PLANE_BASE_SIZE) {
  const w = Math.max(1, imgWidth || 1024);
  const h = Math.max(1, imgHeight || 1024);

  if (w >= h) {
    return {
      widthUnits: w,
      heightUnits: h,
      planeWidth3D: baseSize,
      planeHeight3D: baseSize * (h / w)
    };
  }

  return {
    widthUnits: w,
    heightUnits: h,
    planeWidth3D: baseSize * (w / h),
    planeHeight3D: baseSize
  };
}

/**
 * Roaming + parallax placement for both eye planes.
 *
 * The left plane is translated so the ground point under the cursor lands
 * exactly beneath the fixed central reticle at (0, 0). The right plane gets
 * the same translation plus the disparity offset, so conjugate features at
 * the cursor's elevation fuse at the reticle with zero eye vergence.
 */
export function computePlanePositions({
  cursorX,
  cursorY,
  widthUnits,
  heightUnits,
  planeWidth3D,
  planeHeight3D,
  zoom = 1,
  totalParallax = 0
}) {
  const { nx, ny } = pixelToNormalized(cursorX, cursorY, widthUnits, heightUnits);

  const currentWidth = planeWidth3D * zoom;
  const currentHeight = planeHeight3D * zoom;
  const disp3D = parallaxToPlaneOffset(totalParallax, widthUnits, currentWidth);

  const baseX = -nx * currentWidth;
  const baseY = -ny * currentHeight;

  return {
    left: { x: baseX, y: baseY, z: 0 },
    right: { x: baseX + disp3D, y: baseY, z: 0 },
    disp3D,
    currentWidth,
    currentHeight
  };
}

/**
 * Plane-local position of a digitized vertex on each eye's plane.
 *
 * Vectors are children of the (scaled) image planes, so these coordinates use
 * the UNZOOMED plane size. The right-eye vertex is shifted left by its own
 * disparity so it stays conjugate to the left-eye vertex while roaming.
 */
export function computeVertexLocal({
  px,
  py,
  z = 0,
  baseParallax = 0,
  parallaxPerMeter = 0.5,
  widthUnits,
  heightUnits,
  planeWidth3D,
  planeHeight3D
}) {
  const { nx, ny } = pixelToNormalized(px, py, widthUnits, heightUnits);

  const leftX = nx * planeWidth3D;
  const leftY = ny * planeHeight3D;

  const disparity = computeTotalParallax({ baseParallax, z, parallaxPerMeter });
  const dispLocal = parallaxToPlaneOffset(disparity, widthUnits, planeWidth3D);

  return {
    left: { x: leftX, y: leftY },
    right: { x: leftX - dispLocal, y: leftY },
    disparity,
    dispLocal
  };
}

/** Advance the roaming cursor (pixels), clamped to the image bounds. */
export function panCursor({ x, y, dx = 0, dy = 0, speed, widthUnits, heightUnits }) {
  return {
    x: clamp(x + dx * speed, 0, widthUnits),
    y: clamp(y + dy * speed, 0, heightUnits)
  };
}

/** Apply a magnification delta, clamped to the supported zoom range. */
export function applyZoomStep(zoom, delta, min = ZOOM_MIN, max = ZOOM_MAX) {
  return clamp(zoom + delta, min, max);
}

/** Apply an elevation delta, clamped to the supported Z range. */
export function applyElevationStep(z, delta, min = Z_MIN, max = Z_MAX) {
  return clamp(z + delta, min, max);
}
