/**
 * Desktop telemetry panel — DOM writes only, no scene access, no mutation.
 */
export function writeTelemetry(state) {
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
    };
    set('val-x', state.cursor.x.toFixed(2) + ' m');
    set('val-y', state.cursor.y.toFixed(2) + ' m');
    set('val-z', state.cursor.z.toFixed(2) + ' m');
    set('val-parallax', state.cursor.totalParallax.toFixed(1) + ' px');
    set('stat-base-parallax', state.model.baseParallax.toFixed(1) + ' px');
    set('stat-zoom-level', state.model.zoom.toFixed(1) + 'x');
}
