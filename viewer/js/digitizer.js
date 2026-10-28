/**
 * Pure vector-digitizer state machine.
 * No THREE, no DOM, no module-level state — safe to import in Node.
 * See digitizer.test.js for the full behavioral contract.
 *
 * `vertex.refs` and `feature.refs` are open slots reserved for the caller
 * (see digitizer-bridge.js) to hang Three.js mesh references on.
 */

export const TOOLS = ['PointZ', 'LineStringZ', 'PolygonZ'];
export const DEFAULT_TOOL = TOOLS[0];

export function isTool(name) {
    return TOOLS.includes(name);
}

export function createDigitizerState(tool = DEFAULT_TOOL) {
    return {
        activeTool: isTool(tool) ? tool : DEFAULT_TOOL,
        activeFeature: [],
        completedFeatures: []
    };
}

export function nextTool(current) {
    const idx = TOOLS.indexOf(current);
    return TOOLS[(idx + 1) % TOOLS.length];
}

export function setTool(s, name) {
    if (isTool(name)) s.activeTool = name;
    return s.activeTool;
}

export function pushVertex(s, vertex) {
    if (vertex.refs === undefined) vertex.refs = null;
    s.activeFeature.push(vertex);
    return vertex;
}

export function removeLastVertex(s) {
    return s.activeFeature.pop() ?? null;
}

export function finishFeature(s, explicitType = null) {
    if (s.activeFeature.length === 0) return null;
    const feature = {
        type: explicitType || s.activeTool,
        vertices: s.activeFeature.slice(),
        refs: null
    };
    s.completedFeatures.push(feature);
    s.activeFeature.length = 0;
    return feature;
}

export function reopenLastFeature(s) {
    const feature = s.completedFeatures.pop();
    if (!feature) return null;
    for (const v of feature.vertices) s.activeFeature.push(v);
    return feature;
}

export function clearAll(s) {
    const snapshot = {
        activeTool: s.activeTool,
        activeFeature: s.activeFeature.slice(),
        completedFeatures: s.completedFeatures.slice()
    };
    s.activeFeature.length = 0;
    s.completedFeatures.length = 0;
    return snapshot;
}

export function restore(s, snapshot) {
    if (!snapshot) return;
    if (isTool(snapshot.activeTool)) s.activeTool = snapshot.activeTool;
    s.activeFeature = (snapshot.activeFeature || []).slice();
    s.completedFeatures = (snapshot.completedFeatures || []).slice();
}

export function vertexCount(s) { return s.activeFeature.length; }
export function featureCount(s) { return s.completedFeatures.length; }
export function isEmpty(s) { return s.activeFeature.length === 0 && s.completedFeatures.length === 0; }

/** GeoJSON-ready coordinates for a single feature (Point unwraps, Polygon closes). */
export function featureCoordinates(feature) {
    const coords = feature.vertices.map(v => [v.x, v.y, v.z]);
    const geomType = feature.type.replace('Z', '');
    if (geomType === 'Point') return coords[0];
    if (geomType === 'Polygon') {
        if (coords.length === 0) return [[]];
        return [[...coords, coords[0]]];
    }
    return coords;
}

/** Build a GeoJSON FeatureCollection from completedFeatures only. */
export function toGeoJSON(s, opts = {}) {
    const out = { type: 'FeatureCollection' };
    if (opts.name) out.name = opts.name;
    out.features = s.completedFeatures.map((feat, i) => ({
        type: 'Feature',
        id: i + 1,
        properties: {
            id: i + 1,
            layer_type: feat.type,
            vertex_count: feat.vertices.length
        },
        geometry: {
            type: feat.type.replace('Z', ''),
            coordinates: featureCoordinates(feat)
        }
    }));
    return out;
}
