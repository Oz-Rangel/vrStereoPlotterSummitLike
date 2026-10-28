import { applyElevationStep, applyZoomStep, clamp } from './stereo-math.js';

/**
 * Desktop keyboard + wheel bindings.
 * Pure cursor/model math here; side-effect actions dispatched via `actions`.
 */
export function setupKeyboardAndMouse({ state, actions }) {
    window.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 12.0 : 3.0;
        let moved = true;

        switch (e.key.toLowerCase()) {
            case 'arrowleft':
            case 'a':
                state.cursor.x = clamp(state.cursor.x - step, 0, state.model.widthUnits);
                break;
            case 'arrowright':
            case 'd':
                state.cursor.x = clamp(state.cursor.x + step, 0, state.model.widthUnits);
                break;
            case 'arrowup':
            case 'w':
                state.cursor.y = clamp(state.cursor.y - step, 0, state.model.heightUnits);
                break;
            case 'arrowdown':
            case 's':
                state.cursor.y = clamp(state.cursor.y + step, 0, state.model.heightUnits);
                break;
            case 'q':
            case 'pageup':
                state.cursor.z = applyElevationStep(state.cursor.z, 1.0);
                break;
            case 'e':
            case 'pagedown':
                state.cursor.z = applyElevationStep(state.cursor.z, -1.0);
                break;
            case '+':
            case '=':
                state.model.zoom = applyZoomStep(state.model.zoom, 0.1);
                break;
            case '-':
            case '_':
                state.model.zoom = applyZoomStep(state.model.zoom, -0.1);
                break;
            case ' ':
                actions.digitizeVertex(); moved = false; break;
            case 'enter':
                actions.finishFeature(); moved = false; break;
            case 'z':
                if (e.shiftKey) actions.redo(); else actions.undo();
                moved = false; break;
            case 'y':
                actions.redo(); moved = false; break;
            case 'r':
                actions.resetView(); moved = false; break;
            default:
                moved = false;
        }

        if (moved) actions.updateSummitPositions();
    });

    window.addEventListener('wheel', (e) => {
        if (state.isVR) return;
        state.cursor.z = applyElevationStep(state.cursor.z, e.deltaY < 0 ? 1.0 : -1.0);
        actions.updateSummitPositions();
    }, { passive: true });
}
