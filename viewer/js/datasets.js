/**
 * Built-in stereo dataset table for the Summit-VR stereoplotter.
 *
 * Kept separate from app.js so the registry can be inspected or reused
 * (e.g. by tooling or a future Python-backed dataset manifest) without
 * pulling in THREE.js or touching the DOM.
 */

import { PLANE_BASE_SIZE } from './stereo-math.js';

export { PLANE_BASE_SIZE };

export const DATASETS = {
  synth: {
    id: 'synth',
    label: 'Calibration',
    shortLabel: 'Synth',
    left: 'assets/synthetic/left.png',
    right: 'assets/synthetic/right.png',
    baseParallax: 0.0,
    parallaxPerMeter: 0.5,
    flipX: false,
    flipY: false,
    infoHtml: `
            <div>• <strong>Dataset:</strong> Synthetic Calibrated Stereopair</div>
            <div>• <strong>Base Parallax:</strong> 0.0 px</div>
            <div>• <strong>Targets:</strong> Bldg A: 45m | Tower: 80m | Spire: 110m</div>
            <div>• <strong>Contours:</strong> Terraced Hill: 10m, 20m, 35m</div>
        `
  },
  real: {
    id: 'real',
    label: 'Vaihingen Aerial',
    shortLabel: 'Aerial',
    left: 'assets/real_aerial/left.png',
    right: 'assets/real_aerial/right.png',
    baseParallax: -60.0,
    parallaxPerMeter: 0.5,
    flipX: false,
    flipY: false,
    infoHtml: `
            <div>• <strong>Dataset:</strong> ISPRS Vaihingen Aerial Stereo Pair</div>
            <div>• <strong>Base Parallax:</strong> -60.0 px (Aligned for zero ground strain)</div>
            <div>• <strong>Workflow:</strong> Roam with Left Stick, adjust Z with Right Stick until rooftop fuses at the center crosshair, then pull trigger to digitize!</div>
        `
  },
  aurrera: {
    id: 'aurrera',
    label: 'Aurrera (SummitEV)',
    shortLabel: 'Aurrera',
    left: 'assets/aurrera/left.png',
    right: 'assets/aurrera/right.png',
    baseParallax: 0.0,
    flipX: true,
    parallaxPerMeter: -0.5,
    infoHtml: `
            <div>• <strong>Dataset:</strong> Summit Evolution Aurrera DemoDron (Model 3_33+3_34)</div>
            <div>• <strong>Source:</strong> Epipolar-rectified TIFF pair from SummitEV/Imagenes</div>
            <div>• <strong>Base Parallax:</strong> 0.0 px (ground datum aligned)</div>
            <div>• <strong>Orientation:</strong> Flip H on (toggle if it still looks mirrored)</div>
            <div>• <strong>Tip:</strong> Generate other models with <code>python viewer/process_aurrera_pair.py &lt;ModelName&gt;</code></div>
        `
  },
  custom: {
    id: 'custom',
    label: 'Custom Pair',
    shortLabel: 'Custom',
    left: null,
    right: null,
    baseParallax: 0.0,
    parallaxPerMeter: 0.5,
    flipX: false,
    flipY: false,
    infoHtml: `
            <div>• <strong>Dataset:</strong> Custom user stereo pair</div>
            <div>• <strong>Base Parallax:</strong> adjustable via Base px controls</div>
            <div>• <strong>Formats:</strong> PNG, JPEG, WebP (preprocess SummitEV TIFFs first)</div>
        `
  }
};

/** Datasets reachable by the VR HUD / desktop cycle button, in order. */
export const DATASET_CYCLE = ['synth', 'real', 'aurrera', 'custom'];

/** True once a user-supplied pair has been registered. */
export function hasCustomPair() {
  return Boolean(DATASETS.custom.left && DATASETS.custom.right);
}

/**
 * Register a user-supplied stereo pair in place.
 * Object URLs are not revoked here — the caller owns their lifecycle.
 */
export function setCustomPair({ left, right, baseParallax = 0, parallaxPerMeter = 0.5 }) {
  DATASETS.custom.left = left;
  DATASETS.custom.right = right;
  DATASETS.custom.baseParallax = baseParallax;
  DATASETS.custom.parallaxPerMeter = parallaxPerMeter;
  return DATASETS.custom;
}
