/**
 * Unit tests for the pure stereoplotter math.
 *
 * Run with:  npm test
 * (Node's built-in test runner — no external dependencies.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLANE_BASE_SIZE,
  Z_MIN,
  Z_MAX,
  ZOOM_MIN,
  ZOOM_MAX,
  clamp,
  computeTotalParallax,
  pixelToNormalized,
  parallaxToPlaneOffset,
  computeImageDimensions,
  computePlanePositions,
  computeVertexLocal,
  panCursor,
  applyZoomStep,
  applyElevationStep
} from './stereo-math.js';

/** Float comparison helper for deterministic-but-imprecise expectations. */
function approx(actual, expected, eps = 1e-9, message = '') {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `${message || 'approx'}: expected ${expected}, got ${actual}`
  );
}

test('001 - computeTotalParallax at ground datum is purely the base offset', () => {
  assert.equal(computeTotalParallax({ baseParallax: 0, z: 0, parallaxPerMeter: 0.5 }), 0);
});

test('002 - computeTotalParallax scales with elevation for the synthetic pair', () => {
  // 45 m rooftop at 0.5 px/m on top of a 0 px ground datum.
  approx(computeTotalParallax({ baseParallax: 0, z: 45, parallaxPerMeter: 0.5 }), 22.5);
});

test('003 - computeTotalParallax composes the Vaihingen base offset', () => {
  // -60 px datum + 45 m * 0.5 px/m == -37.5 px
  approx(computeTotalParallax({ baseParallax: -60, z: 45, parallaxPerMeter: 0.5 }), -37.5);
});

test('004 - pixelToNormalized maps the image centre to the origin', () => {
  const { nx, ny } = pixelToNormalized(512, 512, 1024, 1024);
  approx(nx, 0, 1e-12, 'nx centre');
  approx(ny, 0, 1e-12, 'ny centre');
});

test('005 - pixelToNormalized maps the top-left corner to (-0.5, +0.5)', () => {
  const { nx, ny } = pixelToNormalized(0, 0, 1024, 1024);
  approx(nx, -0.5, 1e-12, 'nx top-left');
  approx(ny, 0.5, 1e-12, 'ny top-left');
});

test('006 - parallaxToPlaneOffset is zero at zero disparity', () => {
  assert.equal(parallaxToPlaneOffset(0, 1024, PLANE_BASE_SIZE), 0);
});

test('007 - parallaxToPlaneOffset converts -60 px into metric plane shift', () => {
  // (-60 / 1024) * 2.2 == -0.12890625 m exactly (power-of-two denominator)
  assert.equal(parallaxToPlaneOffset(-60, 1024, PLANE_BASE_SIZE), -0.12890625);
});

test('008 - computeImageDimensions fits a landscape pair to the base size', () => {
  const dims = computeImageDimensions(2048, 1536);
  assert.equal(dims.widthUnits, 2048);
  assert.equal(dims.heightUnits, 1536);
  approx(dims.planeWidth3D, 2.2, 1e-12, 'landscape width');
  approx(dims.planeHeight3D, 1.65, 1e-12, 'landscape height');
});

test('009 - computeImageDimensions fits a portrait pair by height', () => {
  const dims = computeImageDimensions(1024, 2048);
  approx(dims.planeWidth3D, 1.1, 1e-12, 'portrait width');
  approx(dims.planeHeight3D, 2.2, 1e-12, 'portrait height');
});

test('010 - computePlanePositions parks both planes at the origin at zero parallax', () => {
  const pos = computePlanePositions({
    cursorX: 512,
    cursorY: 512,
    widthUnits: 1024,
    heightUnits: 1024,
    planeWidth3D: 2.2,
    planeHeight3D: 2.2,
    zoom: 1,
    totalParallax: 0
  });

  approx(pos.left.x, 0, 1e-12, 'left x');
  approx(pos.left.y, 0, 1e-12, 'left y');
  approx(pos.right.x, 0, 1e-12, 'right x');
  approx(pos.right.y, 0, 1e-12, 'right y');
});

test('011 - computePlanePositions applies disparity scaled by zoom to the right plane only', () => {
  const pos = computePlanePositions({
    cursorX: 512,
    cursorY: 512,
    widthUnits: 1024,
    heightUnits: 1024,
    planeWidth3D: 2.2,
    planeHeight3D: 2.2,
    zoom: 2,
    totalParallax: -60
  });

  // (-60 / 1024) * (2.2 * 2) == -0.2578125 m
  approx(pos.left.x, 0, 1e-12, 'left x untouched');
  assert.equal(pos.right.x, -0.2578125);
  approx(pos.left.y, 0, 1e-12, 'vertical stays aligned');
  approx(pos.right.y, 0, 1e-12, 'no vertical parallax');
});

test('012 - computeVertexLocal keeps conjugate vertices on one horizontal scanline', () => {
  const atCentre = computeVertexLocal({
    px: 512,
    py: 512,
    z: 0,
    baseParallax: 0,
    parallaxPerMeter: 0.5,
    widthUnits: 1024,
    heightUnits: 1024,
    planeWidth3D: 2.2,
    planeHeight3D: 2.2
  });
  approx(atCentre.left.x, 0, 1e-12, 'centre left x');
  approx(atCentre.right.x, 0, 1e-12, 'centre right x');

  const elevated = computeVertexLocal({
    px: 512,
    py: 512,
    z: 100,
    baseParallax: 0,
    parallaxPerMeter: 0.5,
    widthUnits: 1024,
    heightUnits: 1024,
    planeWidth3D: 2.2,
    planeHeight3D: 2.2
  });

  // 100 m * 0.5 px/m = 50 px -> (50 / 1024) * 2.2 == 0.107421875 m
  approx(elevated.left.y, 0, 1e-12, 'elevated left y');
  approx(elevated.right.y, elevated.left.y, 1e-12, 'elevated right y matches');
  assert.equal(elevated.right.x, -0.107421875);

  // Top-left corner sanity check on the left plane.
  const corner = computeVertexLocal({
    px: 0,
    py: 0,
    z: 0,
    baseParallax: 0,
    parallaxPerMeter: 0.5,
    widthUnits: 1024,
    heightUnits: 1024,
    planeWidth3D: 2.2,
    planeHeight3D: 2.2
  });
  approx(corner.left.x, -1.1, 1e-12, 'corner left x');
  approx(corner.left.y, 1.1, 1e-12, 'corner left y');
});

test('013 - panCursor, clamp and the step helpers respect their ranges', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);

  const panned = panCursor({ x: 10, y: 10, dx: 1, dy: 1, speed: 5, widthUnits: 100, heightUnits: 50 });
  assert.equal(panned.x, 15);
  assert.equal(panned.y, 15);

  const clamped = panCursor({ x: 95, y: 45, dx: 1, dy: 1, speed: 50, widthUnits: 100, heightUnits: 50 });
  assert.equal(clamped.x, 100);
  assert.equal(clamped.y, 50);

  assert.equal(applyZoomStep(ZOOM_MIN, -1), ZOOM_MIN);
  assert.equal(applyZoomStep(ZOOM_MAX, +1), ZOOM_MAX);
  approx(applyZoomStep(1.0, 0.1), 1.1);

  assert.equal(applyElevationStep(Z_MIN, -1), Z_MIN);
  assert.equal(applyElevationStep(Z_MAX, +1), Z_MAX);
  approx(applyElevationStep(0, 1), 1);
});
