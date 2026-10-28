/**
 * Unit tests for the pure vector-digitizer state machine.
 *
 * Run with:  npm test
 * (Node's built-in test runner — no external dependencies.)
 *
 * These tests intentionally never touch THREE.js or the DOM — that is the
 * whole point of isolating the digitizer state machine into this module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOOLS,
  DEFAULT_TOOL,
  isTool,
  createDigitizerState,
  nextTool,
  setTool,
  pushVertex,
  removeLastVertex,
  finishFeature,
  reopenLastFeature,
  clearAll,
  restore,
  vertexCount,
  featureCount,
  isEmpty,
  featureCoordinates,
  toGeoJSON
} from './digitizer.js';

/** Tiny helper for readability. */
function v(x, y, z) {
  return { x, y, z, refs: null };
}

test('001 - createDigitizerState starts empty with the requested tool', () => {
  const s = createDigitizerState('PointZ');
  assert.equal(s.activeTool, 'PointZ');
  assert.deepEqual(s.activeFeature, []);
  assert.deepEqual(s.completedFeatures, []);
  assert.equal(isEmpty(s), true);
  assert.equal(vertexCount(s), 0);
  assert.equal(featureCount(s), 0);
});

test('002 - createDigitizerState falls back to DEFAULT_TOOL for unknown tools', () => {
  const s = createDigitizerState('definitely-not-a-tool');
  assert.equal(s.activeTool, DEFAULT_TOOL);
});

test('003 - nextTool cycles PointZ -> LineStringZ -> PolygonZ', () => {
  assert.deepEqual(TOOLS, ['PointZ', 'LineStringZ', 'PolygonZ']);
  assert.equal(nextTool('PointZ'), 'LineStringZ');
  assert.equal(nextTool('LineStringZ'), 'PolygonZ');
  assert.equal(nextTool('PolygonZ'), 'PointZ');
});

test('004 - setTool ignores unknown names and returns the effective tool', () => {
  const s = createDigitizerState('LineStringZ');
  assert.equal(setTool(s, 'PolygonZ'), 'PolygonZ');
  assert.equal(s.activeTool, 'PolygonZ');
  assert.equal(setTool(s, 'bogus'), 'PolygonZ');
  assert.equal(isTool('bogus'), false);
});

test('005 - pushVertex appends and fills a default refs slot', () => {
  const s = createDigitizerState();

  const first = pushVertex(s, { x: 1, y: 2, z: 3 });
  assert.equal(first.refs, null); // filled in place
  assert.equal(s.activeFeature.length, 1);

  const incoming = v(4, 5, 6);
  const second = pushVertex(s, incoming);
  assert.equal(second, incoming);       // same object, not a copy
  assert.equal(s.activeFeature[1], incoming);
  assert.equal(vertexCount(s), 2);
});

test('006 - removeLastVertex pops LIFO and returns null when empty', () => {
  const s = createDigitizerState();
  const a = pushVertex(s, v(0, 0, 0));
  const b = pushVertex(s, v(1, 1, 1));

  assert.equal(removeLastVertex(s), b);
  assert.equal(removeLastVertex(s), a);
  assert.equal(removeLastVertex(s), null);
  assert.equal(isEmpty(s), true);
});

test('007 - finishFeature commits the current vertices and clears the buffer', () => {
  const s = createDigitizerState('LineStringZ');
  pushVertex(s, v(0, 0, 0));
  pushVertex(s, v(1, 1, 1));

  const feature = finishFeature(s);
  assert.equal(feature.type, 'LineStringZ');
  assert.equal(feature.vertices.length, 2);
  assert.equal(feature.refs, null);
  assert.equal(s.activeFeature.length, 0);
  assert.equal(featureCount(s), 1);

  // Nothing left to commit.
  assert.equal(finishFeature(s), null);
});

test('008 - finishFeature honours an explicit type for redo', () => {
  const s = createDigitizerState('PolygonZ');
  pushVertex(s, v(0, 0, 0));
  const feature = finishFeature(s, 'LineStringZ');
  assert.equal(feature.type, 'LineStringZ');
});

test('009 - reopenLastFeature moves the most recent feature back into the buffer', () => {
  const s = createDigitizerState();
  pushVertex(s, v(0, 0, 0));
  pushVertex(s, v(1, 1, 1));
  const committed = finishFeature(s);

  const reopened = reopenLastFeature(s);
  assert.equal(reopened, committed);
  assert.equal(s.activeFeature.length, 2);
  assert.equal(featureCount(s), 0);

  // Nothing left to reopen.
  assert.equal(reopenLastFeature(s), null);
});

test('010 - clearAll + restore is a lossless round-trip (Bug B defence)', () => {
  const s = createDigitizerState('PolygonZ');
  pushVertex(s, v(0, 0, 0));
  pushVertex(s, v(1, 0, 0));
  pushVertex(s, v(1, 0, 5));
  finishFeature(s);

  pushVertex(s, v(9, 9, 9)); // in-progress vertex alongside a finished feature

  const snapshot = clearAll(s);
  assert.equal(isEmpty(s), true);
  assert.equal(vertexCount(s), 0);
  assert.equal(featureCount(s), 0);

  restore(s, snapshot);
  assert.equal(s.activeTool, 'PolygonZ');
  assert.equal(featureCount(s), 1);
  assert.equal(vertexCount(s), 1);
  assert.equal(s.completedFeatures[0].vertices.length, 3);
  assert.equal(s.activeFeature[0].z, 9);
});

test('011 - restore is defensive against missing snapshots', () => {
  const s = createDigitizerState();
  pushVertex(s, v(1, 1, 1));
  const before = s.activeFeature.length;

  restore(s, null);
  assert.equal(s.activeFeature.length, before);

  restore(s, undefined);
  assert.equal(s.activeFeature.length, before);
});

test('012 - featureCoordinates unwraps a single PointZ position (Bug C)', () => {
  const point = { type: 'PointZ', vertices: [v(10, 20, 30)], refs: null };
  // GeoJSON Point expects [x, y, z] — NOT [[x, y, z]].
  assert.deepEqual(featureCoordinates(point), [10, 20, 30]);
});

test('013 - featureCoordinates closes a PolygonZ ring', () => {
  const poly = {
    type: 'PolygonZ',
    vertices: [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1)],
    refs: null
  };
  const ring = featureCoordinates(poly);
  assert.equal(ring.length, 1);
  assert.equal(ring[0].length, 4); // three vertices + explicit close
  assert.deepEqual(ring[0][0], [0, 0, 0]);
  assert.deepEqual(ring[0][3], [0, 0, 0]);
});

test('014 - featureCoordinates emits a bare list for LineStringZ', () => {
  const line = {
    type: 'LineStringZ',
    vertices: [v(0, 0, 1), v(2, 2, 3)],
    refs: null
  };
  assert.deepEqual(featureCoordinates(line), [[0, 0, 1], [2, 2, 3]]);
});

test('015 - toGeoJSON builds valid Point/LineString/Polygon geometries', () => {
  const s = createDigitizerState('PointZ');
  pushVertex(s, v(7, 8, 9));
  finishFeature(s);

  setTool(s, 'LineStringZ');
  pushVertex(s, v(0, 0, 0));
  pushVertex(s, v(1, 1, 1));
  finishFeature(s);

  setTool(s, 'PolygonZ');
  pushVertex(s, v(0, 0, 0));
  pushVertex(s, v(2, 0, 0));
  pushVertex(s, v(2, 2, 0));
  finishFeature(s);

  const gj = toGeoJSON(s, { name: 'Fusion' });
  assert.equal(gj.type, 'FeatureCollection');
  assert.equal(gj.name, 'Fusion');
  assert.equal(gj.features.length, 3);

  // Point — the critical regression for QGIS / OGR import.
  assert.equal(gj.features[0].geometry.type, 'Point');
  assert.deepEqual(gj.features[0].geometry.coordinates, [7, 8, 9]);

  // LineString.
  assert.equal(gj.features[1].geometry.type, 'LineString');
  assert.deepEqual(gj.features[1].geometry.coordinates, [[0, 0, 0], [1, 1, 1]]);

  // Polygon — single closed exterior ring.
  assert.equal(gj.features[2].geometry.type, 'Polygon');
  assert.equal(gj.features[2].geometry.coordinates.length, 1);
  assert.equal(gj.features[2].geometry.coordinates[0].length, 4);

  // Properties follow the existing contract.
  assert.equal(gj.features[0].id, 1);
  assert.equal(gj.features[0].properties.layer_type, 'PointZ');
  assert.equal(gj.features[0].properties.vertex_count, 1);
  assert.equal(gj.features[1].properties.layer_type, 'LineStringZ');
  assert.equal(gj.features[1].properties.vertex_count, 2);
  assert.equal(gj.features[2].properties.layer_type, 'PolygonZ');
  assert.equal(gj.features[2].properties.vertex_count, 3);
});

test('016 - toGeoJSON omits the in-progress feature', () => {
  const s = createDigitizerState();
  pushVertex(s, v(0, 0, 0));
  pushVertex(s, v(1, 1, 1));
  const gj = toGeoJSON(s);
  assert.equal(gj.features.length, 0);
});
