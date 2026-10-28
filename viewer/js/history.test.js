/**
 * Unit tests for the pure undo/redo stack.
 *
 * Run with:  npm test
 * (Node's built-in test runner — no external dependencies.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMANDS,
  createHistory,
  push,
  canUndo,
  canRedo,
  takeUndo,
  takeRedo,
  clear,
  summarize
} from './history.js';

test('001 - a fresh history has empty undo and redo stacks', () => {
  const h = createHistory();
  assert.equal(h.undoStack.length, 0);
  assert.equal(h.redoStack.length, 0);
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
  assert.equal(summarize(h), '0 / 0');
});

test('002 - push appends, and a new push discards the redo branch', () => {
  const h = createHistory();
  push(h, { type: COMMANDS.ADD_VERTEX, n: 1 });
  push(h, { type: COMMANDS.ADD_VERTEX, n: 2 });
  assert.equal(h.undoStack.length, 2);
  assert.equal(summarize(h), '2 / 0');

  // Build a redo branch...
  takeUndo(h);
  assert.equal(canRedo(h), true);
  assert.equal(summarize(h), '1 / 1');

  // ...then a new push must discard it (linear edit history).
  push(h, { type: COMMANDS.ADD_VERTEX, n: 3 });
  assert.equal(summarize(h), '2 / 0');
  assert.equal(h.redoStack.length, 0);
});

test('003 - takeUndo returns commands LIFO and moves them to redo', () => {
  const h = createHistory();
  const a = { type: COMMANDS.ADD_VERTEX, id: 'a' };
  const b = { type: COMMANDS.ADD_VERTEX, id: 'b' };
  push(h, a);
  push(h, b);

  assert.equal(takeUndo(h), b);
  assert.equal(takeUndo(h), a);
  assert.equal(takeUndo(h), null);

  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), true);
  assert.equal(summarize(h), '0 / 2');
});

test('004 - takeRedo replays in the original order and restores undo', () => {
  const h = createHistory();
  const a = { type: COMMANDS.ADD_VERTEX, id: 'a' };
  const b = { type: COMMANDS.ADD_VERTEX, id: 'b' };
  push(h, a);
  push(h, b);
  takeUndo(h); // -> redo: [b]
  takeUndo(h); // -> redo: [b, a]

  assert.equal(takeRedo(h), a);
  assert.equal(takeRedo(h), b);
  assert.equal(takeRedo(h), null);

  assert.equal(canUndo(h), true);
  assert.equal(canRedo(h), false);
  assert.equal(summarize(h), '2 / 0');
});

test('005 - undo/redo round-trip leaves both stacks consistent', () => {
  const h = createHistory();
  const cmd = { type: COMMANDS.FINISH_FEATURE };
  push(h, cmd);

  assert.equal(takeUndo(h), cmd);
  assert.equal(takeRedo(h), cmd);
  assert.equal(h.undoStack[0], cmd);
  assert.equal(h.redoStack.length, 0);
});

test('006 - clear wipes both stacks but preserves object identity', () => {
  const h = createHistory();
  push(h, { type: COMMANDS.ADD_VERTEX });
  push(h, { type: COMMANDS.ADD_VERTEX });
  takeUndo(h);

  const sameRef = h;
  clear(h);
  assert.equal(h, sameRef);
  assert.equal(h.undoStack.length, 0);
  assert.equal(h.redoStack.length, 0);
  assert.equal(summarize(h), '0 / 0');

  // Still usable after clearing.
  push(h, { type: COMMANDS.CLEAR_ALL });
  assert.equal(canUndo(h), true);
});

test('007 - COMMANDS is frozen and exposes the expected tags', () => {
  assert.ok(Object.isFrozen(COMMANDS));
  assert.equal(COMMANDS.ADD_VERTEX, 'ADD_VERTEX');
  assert.equal(COMMANDS.FINISH_FEATURE, 'FINISH_FEATURE');
  assert.equal(COMMANDS.CLEAR_ALL, 'CLEAR_ALL');
});
