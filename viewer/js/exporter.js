import { toGeoJSON } from './digitizer.js';

/**
 * Trigger a GeoJSON download of the current digitizer state.
 * PointZ / PolygonZ / LineStringZ shapes come from ./digitizer.js toGeoJSON,
 * which correctly unwraps Points and closes Polygon rings for QGIS import.
 */
export function exportGeoJSON(digitizer) {
    if (digitizer.completedFeatures.length === 0 && digitizer.activeFeature.length === 0) {
        alert('No digitized features to export! Digitize some vertices first.');
        return;
    }

    const geojson = toGeoJSON(digitizer, { name: 'Summit_Evolution_Digitized_Vectors' });
    geojson.crs = {
        type: 'name',
        properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' }
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `summit_evolution_${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
}
