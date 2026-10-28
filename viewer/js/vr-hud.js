/**
 * VR HUD rendering & hit-testing.
 *
 * Design rule (matching ./stereo-math.js): NO THREE imports, NO DOM access,
 * NO module-level mutable state. `renderHud` is a pure function of its
 * arguments; it does not read app state and does not mutate its viewModel.
 * The caller (app.js) is responsible for obtaining a 2D context, building
 * the viewModel, and marking the CanvasTexture dirty afterwards.
 *
 * Extracted from app.js with no behavioral change: same colors, fonts,
 * positions, and button layout as the previous inline implementation.
 */

export const HUD_CANVAS_WIDTH = 640;
export const HUD_CANVAS_HEIGHT = 320;

/**
 * Interactive button layout, in HUD canvas pixels.
 * Frozen data — labels for dynamic buttons are resolved per-frame from the
 * viewModel (see resolveButtonText), so this array is never mutated.
 */
export const HUD_BUTTONS = [
  { id: 'undo', text: '↶ Undo', x: 15, y: 240, w: 90, h: 52 },
  { id: 'redo', text: '↷ Redo', x: 110, y: 240, w: 90, h: 52 },
  { id: 'dataset', text: '🗺 Dataset', x: 205, y: 240, w: 105, h: 52 },
  { id: 'clear', text: '🗑 Clear', x: 315, y: 240, w: 95, h: 52 },
  { id: 'reset', text: '🎯 Center', x: 415, y: 240, w: 105, h: 52 },
  { id: 'tool', text: 'Tool: LineZ', x: 525, y: 240, w: 100, h: 52 }
];

/**
 * Resolve a button's display label. Only `tool` and `dataset` are dynamic;
 * every other button uses its static `text`.
 */
function resolveButtonText(btn, viewModel) {
  if (btn.id === 'tool') {
    return `Tool: ${String(viewModel.activeTool).replace('Z', '')}`;
  }
  if (btn.id === 'dataset') {
    return viewModel.datasetShortLabel;
  }
  return btn.text;
}

/**
 * Draw the full HUD onto `ctx`.
 *
 * @param {CanvasRenderingContext2D} ctx  - 2D context sized HUD_CANVAS_WIDTH x HUD_CANVAS_HEIGHT
 * @param {object} vm
 * @param {number}  vm.cursorX
 * @param {number}  vm.cursorY
 * @param {number}  vm.cursorZ
 * @param {number}  vm.totalParallax
 * @param {number}  vm.baseParallax
 * @param {number}  vm.zoom
 * @param {string}  vm.datasetLabel
 * @param {string}  vm.datasetShortLabel
 * @param {string}  vm.activeTool
 * @param {number}  vm.activeFeatureCount
 * @param {number}  vm.completedFeaturesCount
 * @param {string|null} vm.hoveredButtonId
 * @param {{ x: number, y: number }|null} [vm.laserUV]
 */
export function renderHud(ctx, vm) {
  const laserUV = vm.laserUV || null;

  // Outer tablet background
  ctx.clearRect(0, 0, HUD_CANVAS_WIDTH, HUD_CANVAS_HEIGHT);
  ctx.fillStyle = 'rgba(12, 17, 26, 0.94)';
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(10, 10, 620, 300, 18);
  ctx.fill();
  ctx.stroke();

  // Header
  ctx.fillStyle = '#00d4ff';
  ctx.font = 'bold 19px sans-serif';
  ctx.fillText('SUMMIT EVOLUTION STEREOPLOTTER HUD', 25, 45);

  // Telemetry grid — labels
  ctx.fillStyle = '#8b949e';
  ctx.font = '15px monospace';
  ctx.fillText('GROUND X (E):', 25, 80);
  ctx.fillText('GROUND Y (N):', 25, 110);
  ctx.fillText('ELEVATION Z :', 25, 140);
  ctx.fillText('PARALLAX px :', 25, 170);

  // Telemetry grid — values
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px monospace';
  ctx.fillText(`${vm.cursorX.toFixed(2)} m`, 180, 80);
  ctx.fillText(`${vm.cursorY.toFixed(2)} m`, 180, 110);
  ctx.fillStyle = '#33ff99';
  ctx.fillText(`${vm.cursorZ.toFixed(2)} m`, 180, 140);
  ctx.fillStyle = '#00d4ff';
  ctx.fillText(
    `${vm.totalParallax.toFixed(1)} px (Base: ${vm.baseParallax.toFixed(0)})`,
    180,
    170
  );

  // Status row
  ctx.fillStyle = '#d29922';
  ctx.font = '15px sans-serif';
  ctx.fillText(
    `[${vm.datasetLabel} ${vm.zoom.toFixed(1)}x] Tool: ${vm.activeTool} | ` +
      `Pts: ${vm.activeFeatureCount} | Done: ${vm.completedFeaturesCount}`,
    25,
    205
  );

  // Interactive buttons
  for (const btn of HUD_BUTTONS) {
    const label = resolveButtonText(btn, vm);
    const isHovered = vm.hoveredButtonId === btn.id;

    ctx.fillStyle = isHovered ? '#00d4ff' : 'rgba(30, 42, 60, 0.85)';
    ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(0, 212, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isHovered
      ? '#050b14'
      : btn.id === 'clear'
        ? '#f85149'
        : '#ffffff';
    ctx.font = isHovered ? 'bold 14px sans-serif' : '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 5);
    ctx.textAlign = 'start';
  }

  // Laser aiming dot
  if (laserUV) {
    ctx.fillStyle = '#ff0055';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(laserUV.x, laserUV.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * Return the id of the HUD button at canvas pixel (px, py), or null.
 *
 * Note: px/py are in HUD-canvas pixel space (i.e. already scaled from the
 * hit-test UV), matching the previous inline implementation exactly.
 */
export function hitTestHudButtons(px, py) {
  for (const btn of HUD_BUTTONS) {
    if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
      return btn.id;
    }
  }
  return null;
}
