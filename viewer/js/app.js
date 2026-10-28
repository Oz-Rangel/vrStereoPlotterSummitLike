import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { DATASETS, DATASET_CYCLE, PLANE_BASE_SIZE, hasCustomPair, setCustomPair } from './datasets.js';
import * as StereoMath from './stereo-math.js';

/* ==========================================================================
   Photogrammetric Stereoplotter Engine (Summit Evolution Architecture)
   
   Core Mechanism:
   1. Central Fixed Stereoscopic Reticle:
      The measuring mark sits centered in the observer's line of sight at (0, 0).
   2. Roaming Imagery (X, Y):
      Left Stick pans the terrain imagery beneath the fixed central reticle.
   3. Dynamic Image Parallax (Z-Index Wheel):
      Right Stick Up/Down shifts the Right Image horizontally relative to the Left Image.
      When conjugate rooftop points align under the central reticle, the roof
      fuses in crisp 3D stereoscopic depth with ZERO eye strain.
   4. Base Parallax Datum:
      Calibrated datum offset (-60px for Vaihingen) eliminates forced eye vergence.
   5. Dynamic Zoom Magnification:
      Right Stick Left/Right zooms the stereo imagery from 0.5x to 3.5x.

   All stereoplotter arithmetic lives in ./stereo-math.js (pure, unit-tested).
   All built-in dataset metadata lives in ./datasets.js.
   ========================================================================== */

// --- Global Application State ---
const state = {
    // Current Dataset ('synth' | 'real' | 'aurrera' | 'custom')
    currentDataset: 'synth',

    // Roaming Ground Coordinates (pixels / meters)
    cursor: {
        x: 512.0,      // Ground Easting (0..widthUnits)
        y: 512.0,      // Ground Northing (0..heightUnits)
        z: 0.0,        // Elevation Z in meters
        totalParallax: 0.0 // Computed total horizontal disparity in pixels
    },

    // Photogrammetric Model & Parallax Parameters
    model: {
        widthUnits: 1024.0,
        heightUnits: 1024.0,
        planeWidth3D: PLANE_BASE_SIZE,
        planeHeight3D: PLANE_BASE_SIZE,
        baseParallax: 0.0,     // 0.0 for synthetic calibration, -60.0 for Vaihingen
        parallaxPerMeter: 0.5, // 0.5px disparity per 1m height
        zoom: 1.0,             // Magnification factor (0.5x to 3.5x)
        flipX: false,          // Mirror left-right on both eye planes
        flipY: false           // Mirror top-bottom on both eye planes
    },

    // Vector Digitizer State
    activeTool: 'LineStringZ', // 'PointZ', 'LineStringZ', 'PolygonZ'
    activeFeature: [],         // Array of [x, y, z] points currently being drawn
    completedFeatures: [],     // Array of finished feature objects
    displayMode: 'mono',       // 'mono', 'sbs'
    isVR: false
};

// Object URLs for custom uploads (revoked on replace)
const customPairState = {
    leftFile: null,
    rightFile: null,
    leftUrl: null,
    rightUrl: null,
    leftName: '',
    rightName: ''
};

// --- Action History Stack (Undo / Redo) ---
const history = {
    undoStack: [],
    redoStack: []
};

// --- Three.js Core Variables ---
let container, scene, camera, renderer, controls;
let workstationGroup; // Master container for station
let stereoWindowFrame;
let leftPlane, rightPlane;
let leftTexture, rightTexture;

// Central Fixed Stereoscopic Reticle
let centralFloatingMark;

// Vector Groups Parented directly to Image Planes
let vectorGroupLeft, vectorGroupRight;
let activeLineMeshLeft = null;
let activeLineMeshRight = null;
const activeVertexMeshesLeft = [];
const activeVertexMeshesRight = [];

// VR HUD Tablet & Interaction
let vrHudMesh, vrHudCanvas, vrHudCtx;
let hoveredHudButton = null;
const hudButtons = [
    { id: 'undo', text: '↶ Undo', x: 15, y: 240, w: 90, h: 52 },
    { id: 'redo', text: '↷ Redo', x: 110, y: 240, w: 90, h: 52 },
    { id: 'dataset', text: '🗺 Dataset', x: 205, y: 240, w: 105, h: 52 },
    { id: 'clear', text: '🗑 Clear', x: 315, y: 240, w: 95, h: 52 },
    { id: 'reset', text: '🎯 Center', x: 415, y: 240, w: 105, h: 52 },
    { id: 'tool', text: 'Tool: LineZ', x: 525, y: 240, w: 100, h: 52 }
];

// WebXR Controllers & Grabbing State
const controllers = [];
const raycaster = new THREE.Raycaster();
const grabState = {
    isGrabbing: false,
    initialWorkstationPos: new THREE.Vector3(),
    initialCtrlPos: new THREE.Vector3()
};

// Button edge detection
const prevButtonState = {
    rightTrigger: false,
    leftTrigger: false,
    buttonA: false,
    buttonB: false,
    buttonX: false,
    buttonY: false,
    leftStickClick: false
};

// --- Initialize Engine ---
init();

function init() {
    container = document.getElementById('canvas-container');

    // 1. Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d14);

    // 2. Camera setup
    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 100);
    camera.position.set(0, 0, 2.6);

    // 3. Renderer with WebXR enabled
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // 4. VR Button
    const vrBtnContainer = document.getElementById('vr-btn-container');
    const vrButton = VRButton.createButton(renderer);
    vrBtnContainer.appendChild(vrButton);

    renderer.xr.addEventListener('sessionstart', () => {
        state.isVR = true;
        document.getElementById('desktop-ui').style.display = 'none';
        setTimeout(resetWorkstationView, 300);
    });

    renderer.xr.addEventListener('sessionend', () => {
        state.isVR = false;
        document.getElementById('desktop-ui').style.display = 'flex';
        resetWorkstationView();
    });

    // 5. OrbitControls for desktop preview
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);

    // 6. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    // 7. Workstation Master Container
    workstationGroup = new THREE.Group();
    scene.add(workstationGroup);

    // 8. Stereo Viewing Aperture Window Frame (Summit Evolution Bezel)
    createStereoWindowFrame();

    // 9. Central Fixed Stereoscopic Reticle
    createCentralFloatingMark();

    // 10. Load Initial Stereo Textures & Build Image Planes (Default: Calibrated Target)
    loadStereoTextures(DATASETS.synth.left, DATASETS.synth.right, {
        baseParallax: DATASETS.synth.baseParallax,
        parallaxPerMeter: 0.5,
        flipX: false,
        flipY: false,
        onLoaded: () => updateDatasetInfoBox(DATASETS.synth)
    });

    // 11. Build In-VR Interactive HUD Tablet
    createVRHud();

    // 12. Setup WebXR Controllers
    setupControllers();

    // 13. Setup Desktop UI & Keyboard listeners
    setupDesktopUI();
    setupKeyboardAndMouse();

    // 14. Window resize
    window.addEventListener('resize', onWindowResize);

    // 15. Start Main Render Loop
    renderer.setAnimationLoop(renderLoop);
}

// --- Stereo Window Frame & Bezel ---
function createStereoWindowFrame() {
    if (stereoWindowFrame) {
        workstationGroup.remove(stereoWindowFrame);
        stereoWindowFrame.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
    }

    stereoWindowFrame = new THREE.Group();
    workstationGroup.add(stereoWindowFrame);

    // Elegant Bezel surrounding the stereo aperture (adapts to image aspect)
    const w = state.model.planeWidth3D;
    const h = state.model.planeHeight3D;
    const thickness = 0.08;
    const depth = 0.02;

    const bezelMat = new THREE.MeshBasicMaterial({ color: 0x141822 });

    const topBar = new THREE.Mesh(new THREE.BoxGeometry(w + thickness * 2, thickness, depth), bezelMat);
    topBar.position.set(0, h / 2 + thickness / 2, 0.005);
    stereoWindowFrame.add(topBar);

    const btmBar = new THREE.Mesh(new THREE.BoxGeometry(w + thickness * 2, thickness, depth), bezelMat);
    btmBar.position.set(0, -h / 2 - thickness / 2, 0.005);
    stereoWindowFrame.add(btmBar);

    const leftBar = new THREE.Mesh(new THREE.BoxGeometry(thickness, h, depth), bezelMat);
    leftBar.position.set(-w / 2 - thickness / 2, 0, 0.005);
    stereoWindowFrame.add(leftBar);

    const rightBar = new THREE.Mesh(new THREE.BoxGeometry(thickness, h, depth), bezelMat);
    rightBar.position.set(w / 2 + thickness / 2, 0, 0.005);
    stereoWindowFrame.add(rightBar);

    if (vrHudMesh) {
        vrHudMesh.position.set(0, -h / 2 - 0.24, 0.12);
    }
}

/** Fit the 3D stereo planes to the loaded image aspect ratio. */
function applyImageDimensions(imgWidth, imgHeight) {
    const dims = StereoMath.computeImageDimensions(imgWidth, imgHeight, PLANE_BASE_SIZE);

    state.model.widthUnits = dims.widthUnits;
    state.model.heightUnits = dims.heightUnits;
    state.model.planeWidth3D = dims.planeWidth3D;
    state.model.planeHeight3D = dims.planeHeight3D;

    state.cursor.x = dims.widthUnits / 2;
    state.cursor.y = dims.heightUnits / 2;
    createStereoWindowFrame();
}

// --- Central Fixed Stereoscopic Reticle ---
// Sits fixed at (0, 0, 0.005) in workstation space.
// Both eyes converge on this mark with ZERO eye fatigue.
function createCentralFloatingMark() {
    centralFloatingMark = new THREE.Group();
    centralFloatingMark.layers.enable(0); // Visible to both eyes

    // Central glowing precision dot
    const dotGeo = new THREE.CircleGeometry(0.005, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, depthTest: false, side: THREE.DoubleSide });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    centralFloatingMark.add(dot);

    // Precision aiming ring
    const ringGeo = new THREE.RingGeometry(0.016, 0.019, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, depthTest: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    centralFloatingMark.add(ring);

    // Crosshairs
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, depthTest: false });
    const linePoints = [
        new THREE.Vector3(-0.035, 0, 0), new THREE.Vector3(-0.01, 0, 0),
        new THREE.Vector3(0.01, 0, 0), new THREE.Vector3(0.035, 0, 0),
        new THREE.Vector3(0, -0.035, 0), new THREE.Vector3(0, -0.01, 0),
        new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0, 0.035, 0)
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    centralFloatingMark.add(lines);

    centralFloatingMark.position.set(0, 0, 0.006);
    centralFloatingMark.renderOrder = 999;
    workstationGroup.add(centralFloatingMark);
}

// --- Texture and Stereo Plane Setup ---
function disposeTexture(tex) {
    if (tex) tex.dispose();
}

function loadStereoTextures(leftUrl, rightUrl, options = {}) {
    const loader = new THREE.TextureLoader();
    loader.load(
        leftUrl,
        (texL) => {
            disposeTexture(leftTexture);
            leftTexture = texL;
            leftTexture.colorSpace = THREE.SRGBColorSpace;
            leftTexture.minFilter = THREE.LinearFilter;
            leftTexture.magFilter = THREE.LinearFilter;

            loader.load(
                rightUrl,
                (texR) => {
                    disposeTexture(rightTexture);
                    rightTexture = texR;
                    rightTexture.colorSpace = THREE.SRGBColorSpace;
                    rightTexture.minFilter = THREE.LinearFilter;
                    rightTexture.magFilter = THREE.LinearFilter;

                    const imgW = texL.image?.naturalWidth || texL.image?.width || 1024;
                    const imgH = texL.image?.naturalHeight || texL.image?.height || 1024;
                    applyImageDimensions(imgW, imgH);

                    if (typeof options.baseParallax === 'number') {
                        state.model.baseParallax = options.baseParallax;
                    }
                    if (typeof options.parallaxPerMeter === 'number') {
                        state.model.parallaxPerMeter = options.parallaxPerMeter;
                    }
                    if (typeof options.flipX === 'boolean') {
                        state.model.flipX = options.flipX;
                    }
                    if (typeof options.flipY === 'boolean') {
                        state.model.flipY = options.flipY;
                    }

                    buildStereoPlanes();
                    updateSummitPositions();
                    syncFlipButtons();
                    if (typeof options.onLoaded === 'function') options.onLoaded();
                },
                undefined,
                (err) => {
                    console.error('Failed to load right stereo image:', err);
                    alert('Could not load the right stereo image. Check the file format (PNG/JPEG/WebP).');
                }
            );
        },
        undefined,
        (err) => {
            console.error('Failed to load left stereo image:', err);
            alert('Could not load the left stereo image. Check the file format (PNG/JPEG/WebP).');
        }
    );
}

function buildStereoPlanes() {
    // Preserve digitized vectors across texture reloads when possible by clearing groups only
    if (leftPlane) {
        workstationGroup.remove(leftPlane);
        if (leftPlane.geometry) leftPlane.geometry.dispose();
        if (leftPlane.material) leftPlane.material.dispose();
    }
    if (rightPlane) {
        workstationGroup.remove(rightPlane);
        if (rightPlane.geometry) rightPlane.geometry.dispose();
        if (rightPlane.material) rightPlane.material.dispose();
    }

    const geo = new THREE.PlaneGeometry(state.model.planeWidth3D, state.model.planeHeight3D);

    // Left Eye Plane (Layer 1)
    const matL = new THREE.MeshBasicMaterial({ map: leftTexture, side: THREE.DoubleSide });
    leftPlane = new THREE.Mesh(geo, matL);
    leftPlane.layers.set(1);
    workstationGroup.add(leftPlane);

    // Parent Left Vector Group directly to Left Plane
    vectorGroupLeft = new THREE.Group();
    vectorGroupLeft.layers.set(1);
    leftPlane.add(vectorGroupLeft);

    // Right Eye Plane (Layer 2)
    const matR = new THREE.MeshBasicMaterial({ map: rightTexture, side: THREE.DoubleSide });
    rightPlane = new THREE.Mesh(geo, matR);
    rightPlane.layers.set(2);
    workstationGroup.add(rightPlane);

    // Parent Right Vector Group directly to Right Plane
    vectorGroupRight = new THREE.Group();
    vectorGroupRight.layers.set(2);
    rightPlane.add(vectorGroupRight);

    applyTextureFlips();
    updateSummitPositions();
}

/** Mirror textures on both eye planes without reloading images. */
function applyTextureFlips() {
    [leftTexture, rightTexture].forEach((tex) => {
        if (!tex) return;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.x = state.model.flipX ? -1 : 1;
        tex.repeat.y = state.model.flipY ? -1 : 1;
        tex.offset.x = state.model.flipX ? 1 : 0;
        tex.offset.y = state.model.flipY ? 1 : 0;
        tex.needsUpdate = true;
    });
}

function syncFlipButtons() {
    const btnX = document.getElementById('btn-flip-x');
    const btnY = document.getElementById('btn-flip-y');
    if (btnX) btnX.classList.toggle('active', !!state.model.flipX);
    if (btnY) btnY.classList.toggle('active', !!state.model.flipY);
}

function toggleFlip(axis) {
    if (axis === 'x') {
        state.model.flipX = !state.model.flipX;
        // Mirroring X reverses elevation disparity sign
        state.model.parallaxPerMeter *= -1;
    } else if (axis === 'y') {
        state.model.flipY = !state.model.flipY;
    }
    applyTextureFlips();
    syncFlipButtons();
    updateSummitPositions();
}

// --- Summit Evolution Engine: Roaming Imagery & Dynamic Image Parallax ---
// Panning moves BOTH images under the central reticle.
// Elevation Z shifts the Right Image in X relative to the Left Image.
function updateSummitPositions() {
    if (!leftPlane || !rightPlane) return;

    // Apply Magnification Scale to Image Planes
    leftPlane.scale.set(state.model.zoom, state.model.zoom, 1);
    rightPlane.scale.set(state.model.zoom, state.model.zoom, 1);

    // Compute Total Parallax: Base Parallax + Elevation Parallax
    state.cursor.totalParallax = StereoMath.computeTotalParallax({
        baseParallax: state.model.baseParallax,
        z: state.cursor.z,
        parallaxPerMeter: state.model.parallaxPerMeter
    });

    // Roaming + Parallax placement (see stereo-math.js for the derivation)
    const placement = StereoMath.computePlanePositions({
        cursorX: state.cursor.x,
        cursorY: state.cursor.y,
        widthUnits: state.model.widthUnits,
        heightUnits: state.model.heightUnits,
        planeWidth3D: state.model.planeWidth3D,
        planeHeight3D: state.model.planeHeight3D,
        zoom: state.model.zoom,
        totalParallax: state.cursor.totalParallax
    });

    // 1. LEFT IMAGE PLANE (Layer 1): ground point sits under the Central Reticle
    leftPlane.position.set(placement.left.x, placement.left.y, placement.left.z);

    // 2. RIGHT IMAGE PLANE (Layer 2): same, shifted by the disparity offset
    //    When conjugate rooftop features align under the central mark,
    //    they fuse into solid 3D depth!
    rightPlane.position.set(placement.right.x, placement.right.y, placement.right.z);

    // Update Telemetry Display
    document.getElementById('val-x').textContent = state.cursor.x.toFixed(2) + ' m';
    document.getElementById('val-y').textContent = state.cursor.y.toFixed(2) + ' m';
    document.getElementById('val-z').textContent = state.cursor.z.toFixed(2) + ' m';
    document.getElementById('val-parallax').textContent = state.cursor.totalParallax.toFixed(1) + ' px';
    document.getElementById('stat-base-parallax').textContent = state.model.baseParallax.toFixed(1) + ' px';
    document.getElementById('stat-zoom-level').textContent = state.model.zoom.toFixed(1) + 'x';

    updateVRHudTexture();
}

// --- In-VR Interactive HUD Tablet ---
function createVRHud() {
    vrHudCanvas = document.createElement('canvas');
    vrHudCanvas.width = 640;
    vrHudCanvas.height = 320;
    vrHudCtx = vrHudCanvas.getContext('2d');

    const texture = new THREE.CanvasTexture(vrHudCanvas);
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(0.72, 0.36);

    vrHudMesh = new THREE.Mesh(geo, mat);
    vrHudMesh.layers.enable(0);
    // Position comfortably directly underneath the stereo viewing aperture
    vrHudMesh.position.set(0, -state.model.planeHeight3D / 2 - 0.24, 0.12);
    vrHudMesh.rotation.x = -Math.PI / 10;
    workstationGroup.add(vrHudMesh);

    updateVRHudTexture();
}

function updateVRHudTexture(laserUV = null) {
    if (!vrHudCtx) return;

    vrHudCtx.clearRect(0, 0, 640, 320);
    vrHudCtx.fillStyle = 'rgba(12, 17, 26, 0.94)';
    vrHudCtx.strokeStyle = '#00d4ff';
    vrHudCtx.lineWidth = 4;
    vrHudCtx.beginPath();
    vrHudCtx.roundRect(10, 10, 620, 300, 18);
    vrHudCtx.fill();
    vrHudCtx.stroke();

    // Header
    vrHudCtx.fillStyle = '#00d4ff';
    vrHudCtx.font = 'bold 19px sans-serif';
    vrHudCtx.fillText('SUMMIT EVOLUTION STEREOPLOTTER HUD', 25, 45);

    // Telemetry Grid
    vrHudCtx.fillStyle = '#8b949e';
    vrHudCtx.font = '15px monospace';
    vrHudCtx.fillText('GROUND X (E):', 25, 80);
    vrHudCtx.fillText('GROUND Y (N):', 25, 110);
    vrHudCtx.fillText('ELEVATION Z :', 25, 140);
    vrHudCtx.fillText('PARALLAX px :', 25, 170);

    vrHudCtx.fillStyle = '#ffffff';
    vrHudCtx.font = 'bold 17px monospace';
    vrHudCtx.fillText(`${state.cursor.x.toFixed(2)} m`, 180, 80);
    vrHudCtx.fillText(`${state.cursor.y.toFixed(2)} m`, 180, 110);
    vrHudCtx.fillStyle = '#33ff99';
    vrHudCtx.fillText(`${state.cursor.z.toFixed(2)} m`, 180, 140);
    vrHudCtx.fillStyle = '#00d4ff';
    vrHudCtx.fillText(`${state.cursor.totalParallax.toFixed(1)} px (Base: ${state.model.baseParallax.toFixed(0)})`, 180, 170);

    // Status Row
    vrHudCtx.fillStyle = '#d29922';
    vrHudCtx.font = '15px sans-serif';
    const datasetLabel = (DATASETS[state.currentDataset] || DATASETS.synth).label;
    vrHudCtx.fillText(`[${datasetLabel} ${state.model.zoom.toFixed(1)}x] Tool: ${state.activeTool} | Pts: ${state.activeFeature.length} | Done: ${state.completedFeatures.length}`, 25, 205);

    // Interactive Buttons Row
    hudButtons.forEach(btn => {
        if (btn.id === 'tool') {
            btn.text = `Tool: ${state.activeTool.replace('Z', '')}`;
        } else if (btn.id === 'dataset') {
            btn.text = (DATASETS[state.currentDataset] || DATASETS.synth).shortLabel;
        }

        const isHovered = (hoveredHudButton === btn.id);

        vrHudCtx.fillStyle = isHovered ? '#00d4ff' : 'rgba(30, 42, 60, 0.85)';
        vrHudCtx.strokeStyle = isHovered ? '#ffffff' : 'rgba(0, 212, 255, 0.4)';
        vrHudCtx.lineWidth = 2;
        vrHudCtx.beginPath();
        vrHudCtx.roundRect(btn.x, btn.y, btn.w, btn.h, 8);
        vrHudCtx.fill();
        vrHudCtx.stroke();

        vrHudCtx.fillStyle = isHovered ? '#050b14' : (btn.id === 'clear' ? '#f85149' : '#ffffff');
        vrHudCtx.font = isHovered ? 'bold 14px sans-serif' : '13px sans-serif';
        vrHudCtx.textAlign = 'center';
        vrHudCtx.fillText(btn.text, btn.x + btn.w / 2, btn.y + btn.h / 2 + 5);
        vrHudCtx.textAlign = 'start';
    });

    // Draw Laser Aiming Dot on HUD
    if (laserUV) {
        vrHudCtx.fillStyle = '#ff0055';
        vrHudCtx.strokeStyle = '#ffffff';
        vrHudCtx.lineWidth = 2;
        vrHudCtx.beginPath();
        vrHudCtx.arc(laserUV.x, laserUV.y, 6, 0, Math.PI * 2);
        vrHudCtx.fill();
        vrHudCtx.stroke();
    }

    if (vrHudMesh && vrHudMesh.material.map) {
        vrHudMesh.material.map.needsUpdate = true;
    }
}

// --- Repositioning / Center Workstation ---
function resetWorkstationView() {
    if (renderer.xr.isPresenting) {
        const xrCamera = renderer.xr.getCamera();
        const headPos = new THREE.Vector3();
        const headDir = new THREE.Vector3();
        xrCamera.getWorldPosition(headPos);
        xrCamera.getWorldDirection(headDir);

        headDir.y = 0;
        headDir.normalize();

        // Place station 2.3 meters in front of head at eye level
        workstationGroup.position.copy(headPos).addScaledVector(headDir, 2.3);
        workstationGroup.position.y = headPos.y - 0.05;
        workstationGroup.scale.set(1, 1, 1);

        workstationGroup.lookAt(headPos.x, workstationGroup.position.y, headPos.z);
        workstationGroup.rotation.z = 0; // ZERO roll: Epipolar lines stay 100% horizontal
    } else {
        workstationGroup.position.set(0, 0, 0);
        workstationGroup.rotation.set(0, 0, 0);
        workstationGroup.scale.set(1, 1, 1);
        camera.position.set(0, 0, 2.6);
        controls.target.set(0, 0, 0);
    }
    updateVRHudTexture();
}

// --- WebXR Controllers Setup ---
function setupControllers() {
    for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        scene.add(controller);
        controllers.push(controller);

        const rayGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -2.5)
        ]);
        const rayMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.5 });
        const ray = new THREE.Line(rayGeo, rayMat);
        ray.name = 'ray';
        controller.add(ray);
    }
}

// --- Process VR Input: Summit Evolution Mechanics ---
function pollVRGamepads(deltaTime) {
    const session = renderer.xr.getSession();
    if (!session) return;

    let leftSource = null;
    let rightSource = null;

    for (const source of session.inputSources) {
        if (!source.gamepad) continue;
        if (source.handedness === 'left') leftSource = source;
        if (source.handedness === 'right') rightSource = source;
    }

    const leftGrip = leftSource && leftSource.gamepad.buttons[1] && leftSource.gamepad.buttons[1].pressed;
    const rightGrip = rightSource && rightSource.gamepad.buttons[1] && rightSource.gamepad.buttons[1].pressed;

    // 1. WORKSTATION REPOSITIONING (Left Grip)
    handleWorkstationDrag(leftSource, leftGrip);

    // 2. HUD INTERACTION via Controller Ray Pointer
    handleHudRaycasting(rightSource || leftSource);

    // 3. SUMMIT CONTROLS: Left Stick Roams Terrain, Right Stick Shifts Parallax
    if (leftSource && leftSource.gamepad) {
        handleLeftController(leftSource.gamepad, deltaTime);
    }
    if (rightSource && rightSource.gamepad) {
        handleRightController(rightSource.gamepad, deltaTime);
    }

    updateSummitPositions();
}

// --- Workstation 3D Dragging ---
function handleWorkstationDrag(source, gripPressed) {
    const ctrl = controllers[0];
    if (!ctrl || !source) return;

    if (gripPressed) {
        if (!grabState.isGrabbing) {
            grabState.isGrabbing = true;
            grabState.initialCtrlPos.copy(ctrl.position);
            grabState.initialWorkstationPos.copy(workstationGroup.position);
        } else {
            const deltaPos = new THREE.Vector3().subVectors(ctrl.position, grabState.initialCtrlPos);
            workstationGroup.position.addVectors(grabState.initialWorkstationPos, deltaPos);

            // Re-orient squarely facing user while maintaining zero roll
            const xrCamera = renderer.xr.getCamera();
            const headPos = new THREE.Vector3();
            xrCamera.getWorldPosition(headPos);
            workstationGroup.lookAt(headPos.x, workstationGroup.position.y, headPos.z);
            workstationGroup.rotation.z = 0;
        }
    } else {
        grabState.isGrabbing = false;
    }
}

// --- In-VR HUD Raycasting ---
function handleHudRaycasting(activeSource) {
    if (!vrHudMesh || !activeSource) return;

    const ctrl = controllers[1] || controllers[0];
    if (!ctrl) return;

    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(ctrl.matrixWorld);
    const rayOrigin = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
    const rayDir = new THREE.Vector3(0, 0, -1).applyMatrix4(tempMatrix).normalize();

    raycaster.set(rayOrigin, rayDir);
    const intersects = raycaster.intersectObject(vrHudMesh);

    if (intersects.length > 0) {
        const uv = intersects[0].uv;
        const px = uv.x * vrHudCanvas.width;
        const py = (1 - uv.y) * vrHudCanvas.height;

        let foundHover = null;
        for (const btn of hudButtons) {
            if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
                foundHover = btn.id;
                break;
            }
        }

        if (hoveredHudButton !== foundHover) {
            hoveredHudButton = foundHover;
            updateVRHudTexture({ x: px, y: py });
        }

        // Trigger click on HUD Button
        const triggerPressed = activeSource.gamepad.buttons[0] && activeSource.gamepad.buttons[0].pressed;
        if (triggerPressed && !prevButtonState.rightTrigger && hoveredHudButton) {
            executeHudAction(hoveredHudButton, activeSource.gamepad);
        }
    } else {
        if (hoveredHudButton !== null) {
            hoveredHudButton = null;
            updateVRHudTexture();
        }
    }
}

function executeHudAction(actionId, gamepad) {
    if (gamepad && gamepad.hapticActuators && gamepad.hapticActuators.length > 0) {
        gamepad.hapticActuators[0].pulse(0.8, 80);
    }

    switch (actionId) {
        case 'undo':
            undoAction();
            break;
        case 'redo':
            redoAction();
            break;
        case 'clear':
            clearAllFeatures();
            break;
        case 'reset':
            resetWorkstationView();
            break;
        case 'tool':
            cycleTool();
            break;
        case 'dataset':
            toggleDataset();
            break;
    }
}

// --- Controller Actions ---
function handleLeftController(gp, deltaTime) {
    const axes = gp.axes;
    const buttons = gp.buttons;

    // LEFT STICK: ROAM TERRAIN BENEATH CENTRAL RETICLE
    const stickX = Math.abs(axes[2] || 0) > 0.15 ? (axes[2] || 0) : 0;
    const stickY = Math.abs(axes[3] || 0) > 0.15 ? (axes[3] || 0) : 0;
    const roamSpeed = (240.0 / state.model.zoom) * deltaTime; // Adaptive speed by zoom

    const panned = StereoMath.panCursor({
        x: state.cursor.x,
        y: state.cursor.y,
        dx: stickX,
        dy: stickY,
        speed: roamSpeed,
        widthUnits: state.model.widthUnits,
        heightUnits: state.model.heightUnits
    });
    state.cursor.x = panned.x;
    state.cursor.y = panned.y;

    // Button X: Undo
    const btnX = buttons[4] && buttons[4].pressed;
    if (btnX && !prevButtonState.buttonX) {
        undoAction();
        if (gp.hapticActuators && gp.hapticActuators.length > 0) gp.hapticActuators[0].pulse(0.5, 40);
    }
    prevButtonState.buttonX = btnX;

    // Button Y: Redo
    const btnY = buttons[5] && buttons[5].pressed;
    if (btnY && !prevButtonState.buttonY) {
        redoAction();
        if (gp.hapticActuators && gp.hapticActuators.length > 0) gp.hapticActuators[0].pulse(0.5, 40);
    }
    prevButtonState.buttonY = btnY;

    // Left Stick Click (Button 3): Center Station
    const stickClick = buttons[3] && buttons[3].pressed;
    if (stickClick && !prevButtonState.leftStickClick) {
        resetWorkstationView();
    }
    prevButtonState.leftStickClick = stickClick;
}

function handleRightController(gp, deltaTime) {
    const axes = gp.axes;
    const buttons = gp.buttons;

    // RIGHT STICK UP/DOWN: SHIFT IMAGE PARALLAX (ELEVATION Z)
    const stickY = Math.abs(axes[3] || 0) > 0.15 ? (axes[3] || 0) : 0;
    if (stickY !== 0) {
        state.cursor.z = StereoMath.applyElevationStep(state.cursor.z, -stickY * 40.0 * deltaTime);
    }

    // RIGHT STICK LEFT/RIGHT: ZOOM IN / OUT
    const stickX = Math.abs(axes[2] || 0) > 0.25 ? (axes[2] || 0) : 0;
    if (stickX !== 0) {
        state.model.zoom = StereoMath.applyZoomStep(state.model.zoom, stickX * deltaTime * 1.5);
    }

    // Right Trigger: Digitize Vertex at Central Reticle
    const trigger = buttons[0] && buttons[0].pressed;
    if (trigger && !prevButtonState.rightTrigger && !hoveredHudButton) {
        digitizeCurrentVertex();
        if (gp.hapticActuators && gp.hapticActuators.length > 0) gp.hapticActuators[0].pulse(0.9, 70);
    }
    prevButtonState.rightTrigger = trigger;

    // Button A: Cycle Tool
    const btnA = buttons[4] && buttons[4].pressed;
    if (btnA && !prevButtonState.buttonA) {
        cycleTool();
    }
    prevButtonState.buttonA = btnA;

    // Button B: Finish Feature
    const btnB = buttons[5] && buttons[5].pressed;
    if (btnB && !prevButtonState.buttonB) {
        finishActiveFeature();
    }
    prevButtonState.buttonB = btnB;
}

// --- Summit Vector Digitizer Engine ---
// Vertices are added to vectorGroupLeft (child of leftPlane) and vectorGroupRight (child of rightPlane).
// When images roam or shift in parallax, the vectors glide with them in 100% lockstep!
function digitizeCurrentVertex() {
    const pt = [state.cursor.x, state.cursor.y, state.cursor.z];
    state.activeFeature.push(pt);

    // Plane-local coordinates on each eye plane (see stereo-math.js)
    const local = StereoMath.computeVertexLocal({
        px: pt[0],
        py: pt[1],
        z: pt[2],
        baseParallax: state.model.baseParallax,
        parallaxPerMeter: state.model.parallaxPerMeter,
        widthUnits: state.model.widthUnits,
        heightUnits: state.model.heightUnits,
        planeWidth3D: state.model.planeWidth3D,
        planeHeight3D: state.model.planeHeight3D
    });

    // Left Vertex Mesh (child of leftPlane)
    const vGeo = new THREE.CircleGeometry(0.008, 16);
    const vMatL = new THREE.MeshBasicMaterial({ color: 0x33ff99, depthTest: false, side: THREE.DoubleSide });
    const vMeshL = new THREE.Mesh(vGeo, vMatL);
    vMeshL.position.set(local.left.x, local.left.y, 0.002);
    vMeshL.layers.set(1);
    vectorGroupLeft.add(vMeshL);
    activeVertexMeshesLeft.push(vMeshL);

    // Right Vertex Mesh (child of rightPlane)
    const vMatR = new THREE.MeshBasicMaterial({ color: 0x33ff99, depthTest: false, side: THREE.DoubleSide });
    const vMeshR = new THREE.Mesh(vGeo, vMatR);
    vMeshR.position.set(local.right.x, local.right.y, 0.002);
    vMeshR.layers.set(2);
    vectorGroupRight.add(vMeshR);
    activeVertexMeshesRight.push(vMeshR);

    // Record action for Undo
    history.undoStack.push({
        type: 'ADD_VERTEX',
        point: pt,
        meshL: vMeshL,
        meshR: vMeshR
    });
    history.redoStack = [];

    updateActiveLineMesh();

    if (state.activeTool === 'PointZ') {
        finishActiveFeature();
    }

    updateStatsDisplay();
}

function updateActiveLineMesh() {
    if (activeLineMeshLeft) {
        vectorGroupLeft.remove(activeLineMeshLeft);
        activeLineMeshLeft.geometry.dispose();
        activeLineMeshLeft = null;
    }
    if (activeLineMeshRight) {
        vectorGroupRight.remove(activeLineMeshRight);
        activeLineMeshRight.geometry.dispose();
        activeLineMeshRight = null;
    }

    if (state.activeFeature.length < 2) return;

    const pointsL = [];
    const pointsR = [];

    state.activeFeature.forEach(pt => {
        const local = StereoMath.computeVertexLocal({
            px: pt[0],
            py: pt[1],
            z: pt[2],
            baseParallax: state.model.baseParallax,
            parallaxPerMeter: state.model.parallaxPerMeter,
            widthUnits: state.model.widthUnits,
            heightUnits: state.model.heightUnits,
            planeWidth3D: state.model.planeWidth3D,
            planeHeight3D: state.model.planeHeight3D
        });

        pointsL.push(new THREE.Vector3(local.left.x, local.left.y, 0.002));
        pointsR.push(new THREE.Vector3(local.right.x, local.right.y, 0.002));
    });

    // Left Eye Line (child of leftPlane)
    const lineGeoL = new THREE.BufferGeometry().setFromPoints(pointsL);
    const lineMatL = new THREE.LineBasicMaterial({ color: 0x00d4ff, linewidth: 2, depthTest: false });
    activeLineMeshLeft = new THREE.Line(lineGeoL, lineMatL);
    activeLineMeshLeft.layers.set(1);
    vectorGroupLeft.add(activeLineMeshLeft);

    // Right Eye Line (child of rightPlane)
    const lineGeoR = new THREE.BufferGeometry().setFromPoints(pointsR);
    const lineMatR = new THREE.LineBasicMaterial({ color: 0x00d4ff, linewidth: 2, depthTest: false });
    activeLineMeshRight = new THREE.Line(lineGeoR, lineMatR);
    activeLineMeshRight.layers.set(2);
    vectorGroupRight.add(activeLineMeshRight);
}

function finishActiveFeature() {
    if (state.activeFeature.length === 0) return;

    const completed = {
        type: state.activeTool,
        coordinates: [...state.activeFeature],
        lineMeshL: activeLineMeshLeft,
        lineMeshR: activeLineMeshRight,
        vertexMeshesL: [...activeVertexMeshesLeft],
        vertexMeshesR: [...activeVertexMeshesRight]
    };

    state.completedFeatures.push(completed);

    history.undoStack.push({
        type: 'FINISH_FEATURE',
        feature: completed
    });
    history.redoStack = [];

    state.activeFeature = [];
    activeVertexMeshesLeft.length = 0;
    activeVertexMeshesRight.length = 0;
    activeLineMeshLeft = null;
    activeLineMeshRight = null;

    updateStatsDisplay();
}

// --- Robust Undo & Redo ---
function undoAction() {
    if (history.undoStack.length === 0) return;

    const action = history.undoStack.pop();

    if (action.type === 'ADD_VERTEX') {
        state.activeFeature.pop();
        if (action.meshL) vectorGroupLeft.remove(action.meshL);
        if (action.meshR) vectorGroupRight.remove(action.meshR);

        const idxL = activeVertexMeshesLeft.indexOf(action.meshL);
        if (idxL !== -1) activeVertexMeshesLeft.splice(idxL, 1);
        const idxR = activeVertexMeshesRight.indexOf(action.meshR);
        if (idxR !== -1) activeVertexMeshesRight.splice(idxR, 1);

        updateActiveLineMesh();
        history.redoStack.push(action);
    } else if (action.type === 'FINISH_FEATURE') {
        state.completedFeatures.pop();
        state.activeFeature = [...action.feature.coordinates];
        activeLineMeshLeft = action.feature.lineMeshL;
        activeLineMeshRight = action.feature.lineMeshR;
        activeVertexMeshesLeft.length = 0;
        activeVertexMeshesRight.length = 0;
        action.feature.vertexMeshesL.forEach(m => activeVertexMeshesLeft.push(m));
        action.feature.vertexMeshesR.forEach(m => activeVertexMeshesRight.push(m));
        history.redoStack.push(action);
    } else if (action.type === 'CLEAR_ALL') {
        state.completedFeatures = [...action.completedFeatures];
        state.activeFeature = [...action.activeFeature];
        action.meshesL.forEach(m => vectorGroupLeft.add(m));
        action.meshesR.forEach(m => vectorGroupRight.add(m));
        history.redoStack.push(action);
    }

    updateStatsDisplay();
}

function redoAction() {
    if (history.redoStack.length === 0) return;

    const action = history.redoStack.pop();

    if (action.type === 'ADD_VERTEX') {
        state.activeFeature.push(action.point);
        if (action.meshL) vectorGroupLeft.add(action.meshL);
        if (action.meshR) vectorGroupRight.add(action.meshR);
        activeVertexMeshesLeft.push(action.meshL);
        activeVertexMeshesRight.push(action.meshR);
        updateActiveLineMesh();
        history.undoStack.push(action);
    } else if (action.type === 'FINISH_FEATURE') {
        state.completedFeatures.push(action.feature);
        state.activeFeature = [];
        activeVertexMeshesLeft.length = 0;
        activeVertexMeshesRight.length = 0;
        activeLineMeshLeft = null;
        activeLineMeshRight = null;
        history.undoStack.push(action);
    } else if (action.type === 'CLEAR_ALL') {
        clearAllFeatures(false);
    }

    updateStatsDisplay();
}

function clearAllFeatures(recordHistory = true) {
    if (state.completedFeatures.length === 0 && state.activeFeature.length === 0) return;

    const meshesL = [...vectorGroupLeft.children];
    const meshesR = [...vectorGroupRight.children];

    if (recordHistory) {
        history.undoStack.push({
            type: 'CLEAR_ALL',
            completedFeatures: [...state.completedFeatures],
            activeFeature: [...state.activeFeature],
            meshesL: meshesL,
            meshesR: meshesR
        });
        history.redoStack = [];
    }

    state.activeFeature = [];
    state.completedFeatures = [];
    activeVertexMeshesLeft.length = 0;
    activeVertexMeshesRight.length = 0;
    activeLineMeshLeft = null;
    activeLineMeshRight = null;

    while (vectorGroupLeft.children.length > 0) vectorGroupLeft.remove(vectorGroupLeft.children[0]);
    while (vectorGroupRight.children.length > 0) vectorGroupRight.remove(vectorGroupRight.children[0]);

    updateStatsDisplay();
}

function cycleTool() {
    const tools = ['PointZ', 'LineStringZ', 'PolygonZ'];
    const nextIdx = (tools.indexOf(state.activeTool) + 1) % tools.length;
    state.activeTool = tools[nextIdx];

    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === state.activeTool);
    });
    document.getElementById('stat-active-tool').textContent = state.activeTool;
    updateVRHudTexture();
}

function syncDatasetButtons(activeId) {
    document.querySelectorAll('#dataset-group .btn-toggle').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.dataset === activeId);
    });
}

function updateDatasetInfoBox(dataset, extraHtml = '') {
    const box = document.getElementById('dataset-info-box');
    if (!box) return;
    const dims = `${Math.round(state.model.widthUnits)} × ${Math.round(state.model.heightUnits)} px`;
    box.innerHTML = `
        ${dataset.infoHtml}
        <div>• <strong>Image Size:</strong> ${dims}</div>
        ${extraHtml}
    `;
}

function revokeCustomUrls() {
    if (customPairState.leftUrl) URL.revokeObjectURL(customPairState.leftUrl);
    if (customPairState.rightUrl) URL.revokeObjectURL(customPairState.rightUrl);
    customPairState.leftUrl = null;
    customPairState.rightUrl = null;
}

/** Switch built-in dataset, or open the custom loader when target is 'custom'. */
function toggleDataset(target = null) {
    let newTarget = target;
    if (!newTarget) {
        // Cycle datasets in VR HUD; skip custom unless a pair was already loaded
        let idx = DATASET_CYCLE.indexOf(state.currentDataset);
        for (let i = 0; i < DATASET_CYCLE.length; i++) {
            idx = (idx + 1) % DATASET_CYCLE.length;
            const candidate = DATASET_CYCLE[idx];
            if (candidate === 'custom' && !hasCustomPair()) {
                continue;
            }
            newTarget = candidate;
            break;
        }
    }

    if (newTarget === 'custom' && !hasCustomPair()) {
        openCustomPairModal();
        return;
    }

    const dataset = DATASETS[newTarget];
    if (!dataset || !dataset.left || !dataset.right) return;
    if (newTarget === state.currentDataset && leftTexture && rightTexture) return;

    state.currentDataset = newTarget;
    state.cursor.z = 0.0;
    state.model.zoom = 1.0;
    syncDatasetButtons(newTarget);

    loadStereoTextures(dataset.left, dataset.right, {
        baseParallax: dataset.baseParallax,
        parallaxPerMeter: typeof dataset.parallaxPerMeter === 'number' ? dataset.parallaxPerMeter : 0.5,
        flipX: !!dataset.flipX,
        flipY: !!dataset.flipY,
        onLoaded: () => {
            if (newTarget === 'custom') {
                updateDatasetInfoBox(dataset, `
                    <div>• <strong>Left:</strong> ${customPairState.leftName || 'custom left'}</div>
                    <div>• <strong>Right:</strong> ${customPairState.rightName || 'custom right'}</div>
                `);
            } else {
                updateDatasetInfoBox(dataset);
            }
        }
    });
}

function openCustomPairModal() {
    const modal = document.getElementById('custom-pair-modal');
    if (!modal) return;
    document.getElementById('custom-base-parallax').value = String(state.model.baseParallax || 0);
    refreshCustomModalStatus();
    modal.hidden = false;
}

function closeCustomPairModal() {
    const modal = document.getElementById('custom-pair-modal');
    if (modal) modal.hidden = true;
}

function refreshCustomModalStatus() {
    const leftName = document.getElementById('custom-left-name');
    const rightName = document.getElementById('custom-right-name');
    const applyBtn = document.getElementById('btn-apply-custom');
    if (leftName) leftName.textContent = customPairState.leftName || 'No file selected';
    if (rightName) rightName.textContent = customPairState.rightName || 'No file selected';
    if (applyBtn) applyBtn.disabled = !(customPairState.leftFile && customPairState.rightFile);
}

function applyCustomStereoPair() {
    if (!customPairState.leftFile || !customPairState.rightFile) return;

    revokeCustomUrls();
    customPairState.leftUrl = URL.createObjectURL(customPairState.leftFile);
    customPairState.rightUrl = URL.createObjectURL(customPairState.rightFile);

    const baseParallax = parseFloat(document.getElementById('custom-base-parallax').value);
    const basePx = Number.isFinite(baseParallax) ? baseParallax : 0.0;

    state.currentDataset = 'custom';
    state.cursor.z = 0.0;
    state.model.zoom = 1.0;

    setCustomPair({
        left: customPairState.leftUrl,
        right: customPairState.rightUrl,
        baseParallax: basePx,
        parallaxPerMeter: 0.5
    });

    syncDatasetButtons('custom');
    closeCustomPairModal();

    loadStereoTextures(customPairState.leftUrl, customPairState.rightUrl, {
        baseParallax: basePx,
        parallaxPerMeter: 0.5,
        flipX: false,
        flipY: false,
        onLoaded: () => {
            updateDatasetInfoBox(DATASETS.custom, `
                <div>• <strong>Left:</strong> ${customPairState.leftName}</div>
                <div>• <strong>Right:</strong> ${customPairState.rightName}</div>
                <div>• <strong>Base Parallax:</strong> ${basePx.toFixed(1)} px</div>
            `);
        }
    });
}

function updateStatsDisplay() {
    document.getElementById('stat-vertex-count').textContent = state.activeFeature.length;
    document.getElementById('stat-feature-count').textContent = state.completedFeatures.length;
    document.getElementById('stat-history-count').textContent = `${history.undoStack.length} / ${history.redoStack.length}`;
    updateVRHudTexture();
}

// --- Desktop Controls ---
function setupKeyboardAndMouse() {
    window.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 12.0 : 3.0;

        switch (e.key.toLowerCase()) {
            case 'arrowleft':
            case 'a':
                state.cursor.x = StereoMath.clamp(state.cursor.x - step, 0, state.model.widthUnits);
                break;
            case 'arrowright':
            case 'd':
                state.cursor.x = StereoMath.clamp(state.cursor.x + step, 0, state.model.widthUnits);
                break;
            case 'arrowup':
            case 'w':
                state.cursor.y = StereoMath.clamp(state.cursor.y + step, 0, state.model.heightUnits);
                break;
            case 'arrowdown':
            case 's':
                state.cursor.y = StereoMath.clamp(state.cursor.y - step, 0, state.model.heightUnits);
                break;
            case 'q':
            case 'pageup':
                state.cursor.z = StereoMath.applyElevationStep(state.cursor.z, 1.0);
                break;
            case 'e':
            case 'pagedown':
                state.cursor.z = StereoMath.applyElevationStep(state.cursor.z, -1.0);
                break;
            case '+':
            case '=':
                state.model.zoom = StereoMath.applyZoomStep(state.model.zoom, 0.1);
                break;
            case '-':
            case '_':
                state.model.zoom = StereoMath.applyZoomStep(state.model.zoom, -0.1);
                break;
            case ' ':
                digitizeCurrentVertex();
                break;
            case 'enter':
                finishActiveFeature();
                break;
            case 'z':
                if (e.shiftKey) redoAction();
                else undoAction();
                break;
            case 'y':
                redoAction();
                break;
            case 'r':
                resetWorkstationView();
                break;
        }
        updateSummitPositions();
    });

    window.addEventListener('wheel', (e) => {
        if (state.isVR) return;
        state.cursor.z = StereoMath.applyElevationStep(state.cursor.z, e.deltaY < 0 ? 1.0 : -1.0);
        updateSummitPositions();
    }, { passive: true });
}

// --- Desktop UI Handlers ---
function setupDesktopUI() {
    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTool = btn.dataset.tool;
            document.getElementById('stat-active-tool').textContent = state.activeTool;
            updateVRHudTexture();
        });
    });

    // Dataset selector (synth / real / aurrera / custom)
    document.querySelectorAll('#dataset-group .btn-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.dataset;
            if (id === 'custom') {
                // Re-open picker even if custom is already active
                openCustomPairModal();
                return;
            }
            toggleDataset(id);
        });
    });

    // Base Parallax Nudge Buttons
    document.getElementById('btn-base-p-minus').addEventListener('click', () => {
        state.model.baseParallax -= 5.0;
        updateSummitPositions();
    });
    document.getElementById('btn-base-p-plus').addEventListener('click', () => {
        state.model.baseParallax += 5.0;
        updateSummitPositions();
    });
    document.getElementById('btn-base-p-zero').addEventListener('click', () => {
        state.model.baseParallax = 0.0;
        updateSummitPositions();
    });

    document.getElementById('btn-flip-x').addEventListener('click', () => toggleFlip('x'));
    document.getElementById('btn-flip-y').addEventListener('click', () => toggleFlip('y'));

    document.getElementById('btn-finish-feature').addEventListener('click', finishActiveFeature);
    document.getElementById('btn-undo-point').addEventListener('click', undoAction);
    document.getElementById('btn-redo-point').addEventListener('click', redoAction);
    document.getElementById('btn-clear-all').addEventListener('click', () => clearAllFeatures(true));
    document.getElementById('btn-reset-view').addEventListener('click', resetWorkstationView);

    // Display modes
    document.querySelectorAll('#display-mode-group .btn-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#display-mode-group .btn-toggle').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.displayMode = btn.dataset.mode;
        });
    });

    // Custom stereo pair modal
    const inputL = document.getElementById('file-left-input');
    const inputR = document.getElementById('file-right-input');
    const modal = document.getElementById('custom-pair-modal');

    document.getElementById('btn-pick-left').addEventListener('click', () => inputL.click());
    document.getElementById('btn-pick-right').addEventListener('click', () => inputR.click());
    document.getElementById('btn-apply-custom').addEventListener('click', applyCustomStereoPair);
    document.getElementById('btn-cancel-custom').addEventListener('click', closeCustomPairModal);
    document.getElementById('btn-close-custom-modal').addEventListener('click', closeCustomPairModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeCustomPairModal();
    });

    inputL.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        customPairState.leftFile = file;
        customPairState.leftName = file.name;
        refreshCustomModalStatus();
    });

    inputR.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        customPairState.rightFile = file;
        customPairState.rightName = file.name;
        refreshCustomModalStatus();
    });

    document.getElementById('btn-export-geojson').addEventListener('click', exportGeoJSON);
}

// --- 3D GeoJSON Exporter ---
function exportGeoJSON() {
    if (state.completedFeatures.length === 0 && state.activeFeature.length === 0) {
        alert('No digitized features to export! Digitize some vertices first.');
        return;
    }

    const geojson = {
        type: "FeatureCollection",
        name: "Summit_Evolution_Digitized_Vectors",
        crs: {
            type: "name",
            properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" }
        },
        features: []
    };

    state.completedFeatures.forEach((feat, idx) => {
        let geomType = feat.type.replace('Z', '');
        let coords = feat.coordinates;

        if (geomType === 'Polygon' && coords.length >= 3) {
            coords = [[...coords, coords[0]]];
        }

        geojson.features.push({
            type: "Feature",
            id: idx + 1,
            properties: {
                id: idx + 1,
                layer_type: feat.type,
                vertex_count: feat.coordinates.length
            },
            geometry: {
                type: geomType,
                coordinates: coords
            }
        });
    });

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `summit_evolution_${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Animation & Render Loop ---
let prevTime = performance.now();

function renderLoop(time, frame) {
    const deltaTime = Math.min((time - prevTime) / 1000, 0.1);
    prevTime = time;

    // 1. Process WebXR Gamepads inside Quest 2
    if (renderer.xr.isPresenting) {
        pollVRGamepads(deltaTime);
        renderer.render(scene, camera);
        return;
    }

    // 2. Desktop Rendering Modes
    controls.update();

    if (state.displayMode === 'sbs') {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setScissorTest(true);

        // Left Eye (Layer 1 + Layer 0)
        camera.layers.set(1);
        camera.layers.enable(0);
        renderer.setViewport(0, 0, w / 2, h);
        renderer.setScissor(0, 0, w / 2, h);
        renderer.render(scene, camera);

        // Right Eye (Layer 2 + Layer 0)
        camera.layers.set(2);
        camera.layers.enable(0);
        renderer.setViewport(w / 2, 0, w / 2, h);
        renderer.setScissor(w / 2, 0, w / 2, h);
        renderer.render(scene, camera);

        renderer.setScissorTest(false);
    } else {
        // Mono Mode (Left Eye + Layer 0)
        camera.layers.set(1);
        camera.layers.enable(0);
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        renderer.render(scene, camera);
    }
}
