/**
 * Pure linear undo/redo stack.
 * No DOM, no THREE, no state mutation beyond the stack itself.
 * See history.test.js for the full behavioral contract.
 */

export const COMMANDS = Object.freeze({
    ADD_VERTEX: 'ADD_VERTEX',
    FINISH_FEATURE: 'FINISH_FEATURE',
    CLEAR_ALL: 'CLEAR_ALL'
});

export function createHistory() {
    return { undoStack: [], redoStack: [] };
}

export function push(h, cmd) {
    h.undoStack.push(cmd);
    h.redoStack.length = 0;
}

export function canUndo(h) { return h.undoStack.length > 0; }
export function canRedo(h) { return h.redoStack.length > 0; }

export function takeUndo(h) {
    const cmd = h.undoStack.pop();
    if (!cmd) return null;
    h.redoStack.push(cmd);
    return cmd;
}

export function takeRedo(h) {
    const cmd = h.redoStack.pop();
    if (!cmd) return null;
    h.undoStack.push(cmd);
    return cmd;
}

export function clear(h) {
    h.undoStack.length = 0;
    h.redoStack.length = 0;
}

export function summarize(h) {
    return `${h.undoStack.length} / ${h.redoStack.length}`;
}
