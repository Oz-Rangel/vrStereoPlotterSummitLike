import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

import { DATASETS, DATASET_CYCLE, hasCustomPair } from './datasets.js';
import {
    PLANE_BASE_SIZE,
    applyElevationStep,
    applyZoomStep,
    panCursor
} from './stereo-math.js';
import {
    createDigitizerState,
    nextTool as nextDigitizerTool,
    setTool as setDigitizerTool
} from './digitizer.js';
import { createHistory } from './history.js';
import { createDigitizerBridge } from './digitizer-bridge.js';
import { createScene } from './scene.js';
import { createDesktopUI } from './desktop-ui.js';
import { setupKeyboardAndMouse } from './keyboard-input.js';
import { writeTelemetry } from './telemetry.js';
import { exportGeoJSON as downloadGeoJSON } from './exporter.js';
import { HUD_CANVAS_WIDTH, HUD_CANVAS_HEIGHT, hitTestHudButtons } from './vr-hud.js';

// ============================================================
// Application state — single source of truth for the workstation
// ============================================================
const state = {
    cursor: { x: 512, y: 512, z: 0, totalParallax: 0 },
    model: {
        baseParallax: 0,
        parallaxPerMeter: 0.5,
        zoom: 1,
        widthUnits: 1024,
        heightUnits: 1024,
        planeWidth3D: PLANE_BASE_SIZE,
        planeHeight3D: PLANE_BASE_SIZE
    },
    currentDataset: 'synth',
    displayMode: 'mono',
    isVR: false,
    flipX: false,
    flipY: false
};

// ============================================================
// Digitizer + history + scene + bridge
// ============================================================
const digitizer = createDigitizerState('LineStringZ');
const history = createHistory();

const sceneApi = createScene({
    state,
    getDigitizer: () => digitizer
});

const bridge = createDigitizerBridge({
    digitizer,
    history,
    getModel: () => state.model,
    getVectorGroups: () => sceneApi.getVectorGroups(),
    onStatsChange: () => updateStatsDisplay()
});

// ============================================================
// Desktop UI
// ============================================================
const desktopUI = createDesktopUI({
    state,
    actions: {
        setTool: (tool) => {
            setDigitizerTool(digitizer, tool);
            document.querySelectorAll('.tool-btn').forEach((b) => {
                b.classList.toggle('active', b.dataset.tool === digitizer.activeTool);
            });
            const el = document.getElementById('stat-active-tool');
            if (el) el.textContent = digitizer.activeTool;
            sceneApi.updateVRHudTexture();
        },
        toggleDataset: (id) => toggleDataset(id),
        undo: () => bridge.undoAction(),
        redo: () => bridge.redoAction(),
        clearAll: () => bridge.clearAllFeatures(true),
        finishFeature: () => bridge.finishActiveFeature(),
        resetView: () => resetWorkstationView(),
        toggleFlip: (axis) => { sceneApi.toggleFlip(axis); sceneApi.updateStereoPlanePositions(); },
        exportGeoJSON: () => downloadGeoJSON(digitizer),
        updateSummitPositions: () => updateSummitPositions()
    }
});

// ============================================================
// Three.js core
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.getElementById('canvas-container').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.4, 0.6);
camera.lookAt(0, 1.2, -2.0);
camera.layers.enable(1);              // desktop mono view renders the left-eye plane

scene.add(new THREE.AmbientLight(0xffffff, 1.2));

const workstationGroup = sceneApi.init();
workstationGroup.position.set(0, 1.2, -2.0);
scene.add(workstationGroup);

// ============================================================
// VR controllers + polling
// ============================================================
let controllerLeft = null;
let controllerRight = null;
let controllerGripLeft = null;
let controllerGripRight = null;

const hudRaycaster = new THREE.Raycaster();
const hudTempMatrix = new THREE.Matrix4();

const prevButtons = {
    rightTrigger: false, rightA: false, rightB: false,
    leftX: false, leftY: false
};
const grabState = {
    isGrabbing: false,
    controllerWorld: new THREE.Vector3(),
    stationWorld: new THREE.Vector3()
};

const controllerModelFactory = new XRControllerModelFactory();

function setupControllers() {
    controllerLeft = renderer.xr.getController(0);
    controllerRight = renderer.xr.getController(1);
    scene.add(controllerLeft, controllerRight);

    controllerGripLeft = renderer.xr.getControllerGrip(0);
    controllerGripRight = renderer.xr.getControllerGrip(1);
    controllerGripLeft.add(controllerModelFactory.createControllerModel(controllerGripLeft));
    controllerGripRight.add(controllerModelFactory.createControllerModel(controllerGripRight));
    scene.add(controllerGripLeft, controllerGripRight);

    for (const c of [controllerLeft, controllerRight]) {
        // Three.js does NOT populate userData.inputSource automatically.
        // Without this, readGamepad() returns null and no VR input fires.
        c.addEventListener('connected', (event) => {
            c.userData.inputSource = event.data;
            c.userData.gamepad = event.data?.gamepad || null;
        });
        c.addEventListener('disconnected', () => {
            c.userData.inputSource = null;
            c.userData.gamepad = null;
        });

        const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1)
        ]);
        c.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00d4ff })));
    }
}

function readGamepad(controller) {
    if (!controller) return null;
    const src = controller.userData.inputSource;
    if (src && src.gamepad) return src.gamepad;
    return controller.userData.gamepad || null;
}

function btnPressed(gp, idx) {
    if (!gp) return false;
    const btn = gp.buttons[idx];
    if (!btn) return false;
    return btn.pressed || btn.value > 0.5;
}

function axis(gp, idx) {
    if (!gp) return 0;
    const v = gp.axes[idx];
    return typeof v === 'number' ? v : 0;
}

function handleHudRaycasting(controller) {
    const refs = sceneApi.getRefs();
    if (!refs.vrHudMesh || !controller) {
        sceneApi.setHoveredButton(null);
        // No HUD to aim at — clear any stale laser reticle.
        sceneApi.updateVRHudTexture(null);
        return null;
    }

    hudTempMatrix.identity().extractRotation(controller.matrixWorld);
    hudRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    hudRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(hudTempMatrix);

    const hits = hudRaycaster.intersectObject(refs.vrHudMesh, false);
    if (hits.length === 0) {
        sceneApi.setHoveredButton(null);
        // Ray left the HUD surface — clear the laser so it doesn't freeze
        // at its last-known pixel while the controller points elsewhere.
        sceneApi.updateVRHudTexture(null);
        return null;
    }
    const uv = hits[0].uv;
    if (!uv) {
        sceneApi.updateVRHudTexture(null);
        return null;
    }

    const px = uv.x * HUD_CANVAS_WIDTH;
    const py = (1 - uv.y) * HUD_CANVAS_HEIGHT;
    const id = hitTestHudButtons(px, py);
    sceneApi.setHoveredButton(id);
    sceneApi.updateVRHudTexture({ x: px, y: py });
    return { id, laserUV: { x: px, y: py } };
}

function cycleToolInternal() {
    digitizer.activeTool = nextDigitizerTool(digitizer.activeTool);
    document.querySelectorAll('.tool-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.tool === digitizer.activeTool);
    });
    const el = document.getElementById('stat-active-tool');
    if (el) el.textContent = digitizer.activeTool;
    sceneApi.updateVRHudTexture();
}

function executeHudAction(id) {
    if (!id) return;
    if (id === 'undo') bridge.undoAction();
    else if (id === 'redo') bridge.redoAction();
    else if (id === 'dataset') toggleDataset();
    else if (id === 'clear') bridge.clearAllFeatures(true);
    else if (id === 'reset') resetWorkstationView();
    else if (id === 'tool') cycleToolInternal();
}

function handleRightController(dt) {
    if (!controllerRight) return;
    const gp = readGamepad(controllerRight);
    if (!gp) return;

    const sx = axis(gp, 2);
    const sy = axis(gp, 3);
    const deadzone = 0.15;

    if (Math.abs(sy) > deadzone) {
        state.cursor.z = applyElevationStep(state.cursor.z, -sy * 60 * dt);
    }
    if (Math.abs(sx) > deadzone) {
        state.model.zoom = applyZoomStep(state.model.zoom, sx * 0.8 * dt);
    }

    const hit = handleHudRaycasting(controllerRight);

    const trig = btnPressed(gp, 0);
    if (trig && !prevButtons.rightTrigger) {
        if (hit && hit.id) executeHudAction(hit.id);
        else bridge.digitizeCurrentVertex(state.cursor);
    }
    prevButtons.rightTrigger = trig;

    const a = btnPressed(gp, 4);
    if (a && !prevButtons.rightA) cycleToolInternal();
    prevButtons.rightA = a;

    const b = btnPressed(gp, 5);
    if (b && !prevButtons.rightB) bridge.finishActiveFeature();
    prevButtons.rightB = b;
}

function handleLeftController(dt) {
    if (!controllerLeft) return;
    const gp = readGamepad(controllerLeft);
    if (!gp) return;

    const sx = axis(gp, 2);
    const sy = axis(gp, 3);
    const deadzone = 0.15;

    if (Math.abs(sx) > deadzone || Math.abs(sy) > deadzone) {
        const pan = panCursor({
            x: state.cursor.x, y: state.cursor.y,
            dx: sx, dy: sy,
            speed: 400 * dt,
            widthUnits: state.model.widthUnits,
            heightUnits: state.model.heightUnits
        });
        state.cursor.x = pan.x;
        state.cursor.y = pan.y;
    }

    const x = btnPressed(gp, 4);
    if (x && !prevButtons.leftX) bridge.undoAction();
    prevButtons.leftX = x;

    const y = btnPressed(gp, 5);
    if (y && !prevButtons.leftY) bridge.redoAction();
    prevButtons.leftY = y;

    const grip = btnPressed(gp, 1);
    if (grip && !grabState.isGrabbing) {
        grabState.isGrabbing = true;
        controllerLeft.getWorldPosition(grabState.controllerWorld);
        workstationGroup.getWorldPosition(grabState.stationWorld);
    } else if (!grip && grabState.isGrabbing) {
        grabState.isGrabbing = false;
    }
    if (grabState.isGrabbing) {
        const now = new THREE.Vector3();
        controllerLeft.getWorldPosition(now);
        const delta = now.clone().sub(grabState.controllerWorld);
        workstationGroup.position.copy(grabState.stationWorld).add(delta);
    }
}

function pollVRGamepads(dt) {
    handleLeftController(dt);
    handleRightController(dt);
    updateSummitPositions();
}

const clock = new THREE.Clock();

let xrNeedsRecenter = false;

function renderLoop() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (renderer.xr.isPresenting) {
        if (xrNeedsRecenter) {
            xrNeedsRecenter = false;
            recenterWorkstationInVR();
        }
        pollVRGamepads(dt);

        // Route each XR eye camera to its matching plane layer.
        // Without this, both eye cameras see both planes and the image
        // ghosts instead of fusing — you get "no 3D".
        const xrCam = renderer.xr.getCamera();
        if (xrCam.cameras.length === 2) {
            xrCam.cameras[0].layers.set(0);
            xrCam.cameras[0].layers.enable(1);   // left eye = left plane
            xrCam.cameras[1].layers.set(0);
            xrCam.cameras[1].layers.enable(2);   // right eye = right plane
        }
    }
    renderer.render(scene, camera);
}

// ============================================================
// Update helpers (called by bridge + UI + VR poll)
// ============================================================
function updateSummitPositions() {
    sceneApi.updateStereoPlanePositions();
    writeTelemetry(state);
    sceneApi.updateVRHudTexture();
}

function updateStatsDisplay() {
    const s = bridge.stats();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stat-vertex-count', s.vertexCount);
    set('stat-feature-count', s.featureCount);
    set('stat-history-count', `${s.undoDepth} / ${s.redoDepth}`);
    set('stat-active-tool', digitizer.activeTool);
    sceneApi.updateVRHudTexture();
}

function toggleDataset(target = null) {
    let newTarget = target;
    if (!newTarget) {
        let idx = DATASET_CYCLE.indexOf(state.currentDataset);
        for (let i = 0; i < DATASET_CYCLE.length; i++) {
            idx = (idx + 1) % DATASET_CYCLE.length;
            const candidate = DATASET_CYCLE[idx];
            if (candidate === 'custom' && !hasCustomPair()) continue;
            newTarget = candidate;
            break;
        }
    }
    if (!newTarget) return;
    if (newTarget === 'custom' && !hasCustomPair()) {
        desktopUI.openCustomPairModal();
        return;
    }

    const dataset = DATASETS[newTarget];
    if (!dataset || !dataset.left || !dataset.right) return;

    state.currentDataset = newTarget;
    state.cursor.z = 0.0;
    state.model.zoom = 1.0;
    bridge.resetOnRebuild();
    desktopUI.syncDatasetButtons(newTarget);

    sceneApi.loadStereoTextures(dataset.left, dataset.right, {
        baseParallax: dataset.baseParallax ?? 0.0,
        parallaxPerMeter: dataset.parallaxPerMeter ?? 0.5,
        flipX: !!dataset.flipX,
        flipY: !!dataset.flipY,
        onLoaded: () => {
            if (newTarget === 'custom') {
                const cps = desktopUI.customPairState;
                desktopUI.updateDatasetInfoBox(dataset, `
                    <div>• <strong>Left:</strong> ${cps.leftName || 'custom left'}</div>
                    <div>• <strong>Right:</strong> ${cps.rightName || 'custom right'}</div>
                `);
            } else {
                desktopUI.updateDatasetInfoBox(dataset);
            }
            updateStatsDisplay();
            updateSummitPositions();
        }
    });
}

function recenterWorkstationInVR() {
    const xrCam = renderer.xr.getCamera();
    if (!xrCam) return;

    const headPos = new THREE.Vector3();
    xrCam.getWorldPosition(headPos);

    const headDir = new THREE.Vector3();
    xrCam.getWorldDirection(headDir);   // head look direction (-Z of the camera)
    headDir.y = 0;
    if (headDir.lengthSq() < 1e-6) return; // looking straight up/down — skip
    headDir.normalize();

    const dist = 2.0;
    workstationGroup.position.set(
        headPos.x + headDir.x * dist,
        headPos.y - 0.3,                 // slightly below eye level
        headPos.z + headDir.z * dist
    );
    // The plane normal is +Z; yaw it so +Z points back at the user.
    const yaw = Math.atan2(-headDir.x, -headDir.z);
    workstationGroup.rotation.set(0, yaw, 0);

    updateSummitPositions();
}

function resetWorkstationView() {
    if (state.isVR) {
        recenterWorkstationInVR();
    } else {
        camera.position.set(0, 1.4, 0.6);
        camera.lookAt(0, 1.2, -2.0);
        workstationGroup.position.set(0, 1.2, -2.0);
        workstationGroup.rotation.set(0, 0, 0);
    }
    updateSummitPositions();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================================
// Boot
// ============================================================
function init() {
    setupControllers();

    const vrBtn = VRButton.createButton(renderer);
    document.getElementById('vr-btn-container').appendChild(vrBtn);

    renderer.xr.addEventListener('sessionstart', () => {
        state.isVR = true;
        xrNeedsRecenter = true;
    });
    renderer.xr.addEventListener('sessionend', () => {
        state.isVR = false;
        xrNeedsRecenter = false;
    });

    desktopUI.bind();
    setupKeyboardAndMouse({
        state,
        actions: {
            digitizeVertex: () => bridge.digitizeCurrentVertex(state.cursor),
            finishFeature: () => bridge.finishActiveFeature(),
            undo: () => bridge.undoAction(),
            redo: () => bridge.redoAction(),
            resetView: () => resetWorkstationView(),
            updateSummitPositions: () => updateSummitPositions()
        }
    });

    window.addEventListener('resize', onWindowResize);

    document.querySelectorAll('.tool-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.tool === digitizer.activeTool);
    });
    const toolLabel = document.getElementById('stat-active-tool');
    if (toolLabel) toolLabel.textContent = digitizer.activeTool;

    toggleDataset(state.currentDataset);
    updateStatsDisplay();

    renderer.setAnimationLoop(renderLoop);
}

init();
