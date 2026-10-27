import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ==========================================================================
   Photogrammetric Stereoplotter Engine (Phase 1)
   Architecture: Three.js + WebXR Layers + 3D Floating Mark + Vector Digitizer
   ========================================================================== */

// --- Global Application State ---
const state = {
    // Spatial Photogrammetric Coordinates
    cursor: {
        x: 512.0,      // Ground X (Easting in meters)
        y: 512.0,      // Ground Y (Northing in meters)
        z: 0.0,        // Elevation Z in meters
        parallax: 0.0  // Computed disparity in pixels
    },
    // Model Scale & Parallax Factors
    model: {
        widthMeters: 1024.0,   // Ground extent in meters
        heightMeters: 1024.0,
        planeWidth3D: 2.5,     // Virtual 3D plane dimension in WebXR meters
        planeHeight3D: 2.5,
        parallaxPerMeter: 0.5, // 0.5px disparity per 1m height
        zDepthFactor: 0.0055   // 3D forward/backward displacement per meter of Z
    },
    // Vector Digitizer State
    activeTool: 'LineStringZ', // 'PointZ', 'LineStringZ', 'PolygonZ'
    activeFeature: [],         // Array of [x, y, z] points currently being drawn
    completedFeatures: [],     // Array of finished feature objects
    displayMode: 'mono',       // 'mono', 'sbs', 'anaglyph'
    isVR: false
};

// --- Three.js Core Variables ---
let container, scene, camera, renderer, controls;
let stereoGroup, leftPlane, rightPlane;
let leftTexture, rightTexture;
let floatingMark, conjugateMarkLeft, conjugateMarkRight;
let vrHudMesh, vrHudCanvas, vrHudCtx;
let vectorGroup;
let currentLineMesh = null;

// VR Controller references
const controllers = [];
const controllerGrips = [];
const prevButtonState = {
    rightTrigger: false,
    leftTrigger: false,
    buttonA: false,
    buttonB: false
};

// --- Initialization ---
init();

function init() {
    container = document.getElementById('canvas-container');

    // 1. Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d14);

    // 2. Camera setup
    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 100);
    camera.position.set(0, 0, 2.2);

    // 3. Renderer with WebXR enabled
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // 4. VR Button for Quest Browser
    const vrBtnContainer = document.getElementById('vr-btn-container');
    const vrButton = VRButton.createButton(renderer);
    vrBtnContainer.appendChild(vrButton);

    renderer.xr.addEventListener('sessionstart', () => {
        state.isVR = true;
        document.getElementById('desktop-ui').style.display = 'none';
        if (vrHudMesh) vrHudMesh.visible = true;
        // Position user comfortably in front of stereo model
        camera.position.set(0, 0, 1.8);
    });

    renderer.xr.addEventListener('sessionend', () => {
        state.isVR = false;
        document.getElementById('desktop-ui').style.display = 'flex';
        if (vrHudMesh) vrHudMesh.visible = false;
    });

    // 5. OrbitControls for desktop preview
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);

    // 6. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    // 7. Groups
    stereoGroup = new THREE.Group();
    scene.add(stereoGroup);

    vectorGroup = new THREE.Group();
    scene.add(vectorGroup);

    // 8. Load Initial Stereo Pair
    loadStereoTextures('assets/left.png', 'assets/right.png');

    // 9. Build 3D Floating Mark (Stereo Cursor)
    createFloatingMark();

    // 10. Build In-VR HUD
    createVRHud();

    // 11. Setup WebXR Controllers
    setupControllers();

    // 12. Setup Desktop UI & Keyboard listeners
    setupDesktopUI();
    setupKeyboardAndMouse();

    // 13. Window resize
    window.addEventListener('resize', onWindowResize);

    // 14. Start Main Render Loop
    renderer.setAnimationLoop(renderLoop);
}

// --- Texture and Stereo Plane Setup ---
function loadStereoTextures(leftUrl, rightUrl) {
    const loader = new THREE.TextureLoader();
    
    loader.load(leftUrl, (texL) => {
        leftTexture = texL;
        leftTexture.minFilter = THREE.LinearFilter;
        leftTexture.magFilter = THREE.LinearFilter;

        loader.load(rightUrl, (texR) => {
            rightTexture = texR;
            rightTexture.minFilter = THREE.LinearFilter;
            rightTexture.magFilter = THREE.LinearFilter;
            buildStereoPlanes();
        });
    });
}

function buildStereoPlanes() {
    // Clear existing planes if reloading
    if (leftPlane) stereoGroup.remove(leftPlane);
    if (rightPlane) stereoGroup.remove(rightPlane);

    const geo = new THREE.PlaneGeometry(state.model.planeWidth3D, state.model.planeHeight3D);

    // Left Eye Material & Plane (Assigned to Layer 1)
    const matL = new THREE.MeshBasicMaterial({ map: leftTexture, side: THREE.DoubleSide });
    leftPlane = new THREE.Mesh(geo, matL);
    leftPlane.layers.set(1); // Left eye only in WebXR
    stereoGroup.add(leftPlane);

    // Right Eye Material & Plane (Assigned to Layer 2)
    const matR = new THREE.MeshBasicMaterial({ map: rightTexture, side: THREE.DoubleSide });
    rightPlane = new THREE.Mesh(geo, matR);
    rightPlane.layers.set(2); // Right eye only in WebXR
    stereoGroup.add(rightPlane);

    // Add a neat surrounding workstation bezel frame
    const bezelGeo = new THREE.BoxGeometry(state.model.planeWidth3D + 0.08, state.model.planeHeight3D + 0.08, 0.02);
    const bezelMat = new THREE.MeshBasicMaterial({ color: 0x1f2430, wireframe: false });
    const bezel = new THREE.Mesh(bezelGeo, bezelMat);
    bezel.position.z = -0.015;
    bezel.layers.enable(0);
    stereoGroup.add(bezel);
}

// --- 3D Floating Mark (Stereo Cursor) ---
function createFloatingMark() {
    floatingMark = new THREE.Group();
    floatingMark.layers.enable(0); // Visible to both eyes

    // 1. Central precision crosshair dot
    const dotGeo = new THREE.SphereGeometry(0.008, 16, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, depthTest: false });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    floatingMark.add(dot);

    // 2. High-contrast circular aiming reticle
    const ringGeo = new THREE.RingGeometry(0.025, 0.028, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, side: THREE.DoubleSide, depthTest: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    floatingMark.add(ring);

    // 3. Crosshair hairs
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, depthTest: false });
    const linePoints = [
        new THREE.Vector3(-0.05, 0, 0), new THREE.Vector3(-0.012, 0, 0),
        new THREE.Vector3(0.012, 0, 0), new THREE.Vector3(0.05, 0, 0),
        new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, -0.012, 0),
        new THREE.Vector3(0, 0.012, 0), new THREE.Vector3(0, 0.05, 0)
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    floatingMark.add(lines);

    // Ensure floating mark always renders crisply on top
    floatingMark.renderOrder = 999;
    scene.add(floatingMark);

    updateCursorPosition();
}

// --- Update Cursor Spatial Position & Ground Telemetry ---
function updateCursorPosition() {
    // Map Ground Coordinates (0..1024) to 3D Virtual Coordinates (-1.25..+1.25)
    const normX = (state.cursor.x / state.model.widthMeters) - 0.5;
    const normY = 0.5 - (state.cursor.y / state.model.heightMeters); // Invert Y for screen coords

    const posX = normX * state.model.planeWidth3D;
    const posY = normY * state.model.planeHeight3D;

    // Disparity calculation:
    // In photogrammetry: p = Z * parallax_factor
    state.cursor.parallax = state.cursor.z * state.model.parallaxPerMeter;

    // Floating mark depth in VR:
    // As elevation Z increases, the mark advances toward the user (into positive Z),
    // matching the stereoscopic convergence depth of the elevated feature!
    const posZ = state.cursor.z * state.model.zDepthFactor;

    if (floatingMark) {
        floatingMark.position.set(posX, posY, posZ);
    }

    // Update Desktop Telemetry UI
    document.getElementById('val-x').textContent = state.cursor.x.toFixed(2) + ' m';
    document.getElementById('val-y').textContent = state.cursor.y.toFixed(2) + ' m';
    document.getElementById('val-z').textContent = state.cursor.z.toFixed(2) + ' m';
    document.getElementById('val-parallax').textContent = state.cursor.parallax.toFixed(1) + ' px';

    // Update In-VR HUD Canvas
    updateVRHudTexture();
}

// --- In-VR Heads-Up Display (HUD) ---
function createVRHud() {
    vrHudCanvas = document.createElement('canvas');
    vrHudCanvas.width = 512;
    vrHudCanvas.height = 256;
    vrHudCtx = vrHudCanvas.getContext('2d');

    const texture = new THREE.CanvasTexture(vrHudCanvas);
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.92 });
    const geo = new THREE.PlaneGeometry(0.45, 0.225);

    vrHudMesh = new THREE.Mesh(geo, mat);
    vrHudMesh.layers.enable(0);
    vrHudMesh.position.set(0, -0.65, 1.1); // Positioned slightly below central line of sight
    vrHudMesh.rotation.x = -Math.PI / 8;
    vrHudMesh.visible = false;
    scene.add(vrHudMesh);

    updateVRHudTexture();
}

function updateVRHudTexture() {
    if (!vrHudCtx) return;

    // Draw high-tech HUD background
    vrHudCtx.clearRect(0, 0, 512, 256);
    vrHudCtx.fillStyle = 'rgba(15, 20, 30, 0.9)';
    vrHudCtx.strokeStyle = '#00d4ff';
    vrHudCtx.lineWidth = 4;
    vrHudCtx.beginPath();
    vrHudCtx.roundRect(10, 10, 492, 236, 16);
    vrHudCtx.fill();
    vrHudCtx.stroke();

    // Header
    vrHudCtx.fillStyle = '#00d4ff';
    vrHudCtx.font = 'bold 22px sans-serif';
    vrHudCtx.fillText('STEREOPLOTTER HUD - VR WORKSTATION', 25, 45);

    // Coordinates Grid
    vrHudCtx.fillStyle = '#8b949e';
    vrHudCtx.font = '16px monospace';
    vrHudCtx.fillText('GROUND X (E):', 25, 80);
    vrHudCtx.fillText('GROUND Y (N):', 25, 110);
    vrHudCtx.fillText('ELEVATION Z :', 25, 140);
    vrHudCtx.fillText('DISPARITY px:', 25, 170);

    vrHudCtx.fillStyle = '#ffffff';
    vrHudCtx.font = 'bold 18px monospace';
    vrHudCtx.fillText(`${state.cursor.x.toFixed(2)} m`, 180, 80);
    vrHudCtx.fillText(`${state.cursor.y.toFixed(2)} m`, 180, 110);

    vrHudCtx.fillStyle = '#33ff99';
    vrHudCtx.fillText(`${state.cursor.z.toFixed(2)} m`, 180, 140);

    vrHudCtx.fillStyle = '#00d4ff';
    vrHudCtx.fillText(`${state.cursor.parallax.toFixed(1)} px`, 180, 170);

    // Status / Tool Info
    vrHudCtx.fillStyle = '#d29922';
    vrHudCtx.font = '15px sans-serif';
    vrHudCtx.fillText(`Tool: ${state.activeTool} | Vertices: ${state.activeFeature.length}`, 25, 205);
    vrHudCtx.fillStyle = '#8b949e';
    vrHudCtx.font = '13px sans-serif';
    vrHudCtx.fillText('[R-Trigger] Digitize | [R-Stick Up/Down] Elevate Z', 25, 230);

    if (vrHudMesh && vrHudMesh.material.map) {
        vrHudMesh.material.map.needsUpdate = true;
    }
}

// --- WebXR Controllers Setup ---
function setupControllers() {
    for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        scene.add(controller);
        controllers.push(controller);

        // Controller visual ray
        const rayGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1)
        ]);
        const rayMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.5 });
        const ray = new THREE.Line(rayGeo, rayMat);
        ray.name = 'ray';
        ray.scale.z = 0.5;
        controller.add(ray);
    }
}

// --- Poll WebXR Gamepads (Analog Thumbsticks & Buttons) ---
function pollVRGamepads(deltaTime) {
    const session = renderer.xr.getSession();
    if (!session) return;

    for (const source of session.inputSources) {
        if (!source.gamepad) continue;

        const gp = source.gamepad;
        const handedness = source.handedness;
        const axes = gp.axes; // [x, y, thumbstickX, thumbstickY]
        const buttons = gp.buttons;

        // Thumbstick axes vary by browser; standard WebXR mapping:
        // axes[2] = Thumbstick X (-1 left, +1 right)
        // axes[3] = Thumbstick Y (-1 up, +1 down)
        const stickX = axes[2] || 0;
        const stickY = axes[3] || 0;

        // Deadzone filter
        const deadzone = 0.15;
        const cleanX = Math.abs(stickX) > deadzone ? stickX : 0;
        const cleanY = Math.abs(stickY) > deadzone ? stickY : 0;

        // LEFT CONTROLLER: Roam across stereopair (X, Y Ground Coordinates)
        if (handedness === 'left') {
            const roamSpeed = 260.0 * deltaTime; // meters per second
            state.cursor.x += cleanX * roamSpeed;
            state.cursor.y += cleanY * roamSpeed; // Up moves forward (North)

            // Clamp to photo limits
            state.cursor.x = Math.max(0, Math.min(state.model.widthMeters, state.cursor.x));
            state.cursor.y = Math.max(0, Math.min(state.model.heightMeters, state.cursor.y));
        }

        // RIGHT CONTROLLER: Elevation Z Control & Digitizing
        if (handedness === 'right') {
            // Thumbstick Y elevates or lowers Z
            const zSpeed = 45.0 * deltaTime; // meters of elevation per second
            if (cleanY !== 0) {
                state.cursor.z -= cleanY * zSpeed; // Push forward elevates Z
                state.cursor.z = Math.max(-100, Math.min(250, state.cursor.z));
            }

            // Trigger Button (Digitize Vertex)
            const triggerPressed = buttons[0] && buttons[0].pressed;
            if (triggerPressed && !prevButtonState.rightTrigger) {
                digitizeCurrentVertex();
                // Haptic tactile feedback on Quest controller
                if (gp.hapticActuators && gp.hapticActuators.length > 0) {
                    gp.hapticActuators[0].pulse(0.8, 60);
                }
            }
            prevButtonState.rightTrigger = triggerPressed;

            // Button A (Cycle Active Tool)
            const buttonAPressed = buttons[4] && buttons[4].pressed;
            if (buttonAPressed && !prevButtonState.buttonA) {
                cycleTool();
            }
            prevButtonState.buttonA = buttonAPressed;

            // Button B (Finish Active Feature)
            const buttonBPressed = buttons[5] && buttons[5].pressed;
            if (buttonBPressed && !prevButtonState.buttonB) {
                finishActiveFeature();
            }
            prevButtonState.buttonB = buttonBPressed;
        }
    }

    updateCursorPosition();
}

// --- Vector Digitizing Logic ---
function digitizeCurrentVertex() {
    const pt = [state.cursor.x, state.cursor.y, state.cursor.z];
    state.activeFeature.push(pt);

    // Render 3D Vertex Sphere in Scene
    const normX = (pt[0] / state.model.widthMeters) - 0.5;
    const normY = 0.5 - (pt[1] / state.model.heightMeters);
    const posX = normX * state.model.planeWidth3D;
    const posY = normY * state.model.planeHeight3D;
    const posZ = pt[2] * state.model.zDepthFactor;

    const vGeo = new THREE.SphereGeometry(0.012, 16, 16);
    const vMat = new THREE.MeshBasicMaterial({ color: 0x33ff99, depthTest: false });
    const vMesh = new THREE.Mesh(vGeo, vMat);
    vMesh.position.set(posX, posY, posZ);
    vMesh.layers.enable(0);
    vectorGroup.add(vMesh);

    // Update dynamic line connecting vertices
    updateActiveLineMesh();

    // If tool is PointZ, complete immediately
    if (state.activeTool === 'PointZ') {
        finishActiveFeature();
    }

    // Update UI Stats
    document.getElementById('stat-vertex-count').textContent = state.activeFeature.length;
}

function updateActiveLineMesh() {
    if (state.activeFeature.length < 2) return;

    if (currentLineMesh) {
        vectorGroup.remove(currentLineMesh);
        currentLineMesh.geometry.dispose();
    }

    const points3D = state.activeFeature.map(pt => {
        const normX = (pt[0] / state.model.widthMeters) - 0.5;
        const normY = 0.5 - (pt[1] / state.model.heightMeters);
        return new THREE.Vector3(
            normX * state.model.planeWidth3D,
            normY * state.model.planeHeight3D,
            pt[2] * state.model.zDepthFactor
        );
    });

    const lineGeo = new THREE.BufferGeometry().setFromPoints(points3D);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, linewidth: 2, depthTest: false });
    currentLineMesh = new THREE.Line(lineGeo, lineMat);
    currentLineMesh.layers.enable(0);
    vectorGroup.add(currentLineMesh);
}

function finishActiveFeature() {
    if (state.activeFeature.length === 0) return;

    state.completedFeatures.push({
        type: state.activeTool,
        coordinates: [...state.activeFeature]
    });

    state.activeFeature = [];
    currentLineMesh = null;

    document.getElementById('stat-vertex-count').textContent = '0';
    document.getElementById('stat-feature-count').textContent = state.completedFeatures.length;
    updateVRHudTexture();
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

// --- Desktop Controls (Keyboard & Mouse) ---
function setupKeyboardAndMouse() {
    window.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 10.0 : 2.5;

        switch (e.key.toLowerCase()) {
            case 'arrowleft':
            case 'a':
                state.cursor.x = Math.max(0, state.cursor.x - step);
                break;
            case 'arrowright':
            case 'd':
                state.cursor.x = Math.min(state.model.widthMeters, state.cursor.x + step);
                break;
            case 'arrowup':
            case 'w':
                state.cursor.y = Math.min(state.model.heightMeters, state.cursor.y + step);
                break;
            case 'arrowdown':
            case 's':
                state.cursor.y = Math.max(0, state.cursor.y - step);
                break;
            case 'q':
            case 'pageup':
                state.cursor.z = Math.min(250, state.cursor.z + 1.0);
                break;
            case 'e':
            case 'pagedown':
                state.cursor.z = Math.max(-100, state.cursor.z - 1.0);
                break;
            case ' ':
                digitizeCurrentVertex();
                break;
            case 'enter':
                finishActiveFeature();
                break;
            case 'u':
                undoLastPoint();
                break;
        }
        updateCursorPosition();
    });

    // Mouse wheel elevates Z when hovering canvas
    window.addEventListener('wheel', (e) => {
        if (state.isVR) return;
        state.cursor.z += (e.deltaY < 0 ? 1.0 : -1.0);
        state.cursor.z = Math.max(-100, Math.min(250, state.cursor.z));
        updateCursorPosition();
    }, { passive: true });
}

function undoLastPoint() {
    if (state.activeFeature.length > 0) {
        state.activeFeature.pop();
        // Remove last vertex mesh from group
        const lastChild = vectorGroup.children[vectorGroup.children.length - 1];
        if (lastChild) vectorGroup.remove(lastChild);
        updateActiveLineMesh();
        document.getElementById('stat-vertex-count').textContent = state.activeFeature.length;
        updateVRHudTexture();
    }
}

// --- Desktop UI Button Handlers ---
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

    // Action buttons
    document.getElementById('btn-finish-feature').addEventListener('click', finishActiveFeature);
    document.getElementById('btn-undo-point').addEventListener('click', undoLastPoint);
    document.getElementById('btn-clear-all').addEventListener('click', () => {
        state.activeFeature = [];
        state.completedFeatures = [];
        while (vectorGroup.children.length > 0) {
            vectorGroup.remove(vectorGroup.children[0]);
        }
        document.getElementById('stat-vertex-count').textContent = '0';
        document.getElementById('stat-feature-count').textContent = '0';
        updateVRHudTexture();
    });

    // Display mode buttons (Mono, SBS, Anaglyph)
    document.querySelectorAll('#display-mode-group .btn-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#display-mode-group .btn-toggle').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.displayMode = btn.dataset.mode;
        });
    });

    // Custom Pair file loader
    const btnCustom = document.getElementById('btn-custom-pair');
    const inputL = document.getElementById('file-left-input');
    const inputR = document.getElementById('file-right-input');

    btnCustom.addEventListener('click', () => {
        alert('Please choose the LEFT eye photo first, then the RIGHT eye photo.');
        inputL.click();
    });

    inputL.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const urlL = URL.createObjectURL(e.target.files[0]);
            inputR.onchange = (e2) => {
                if (e2.target.files && e2.target.files[0]) {
                    const urlR = URL.createObjectURL(e2.target.files[0]);
                    loadStereoTextures(urlL, urlR);
                }
            };
            inputR.click();
        }
    });

    // Export GeoJSON
    document.getElementById('btn-export-geojson').addEventListener('click', exportGeoJSON);
}

// --- 3D GeoJSON Exporter ---
function exportGeoJSON() {
    if (state.completedFeatures.length === 0 && state.activeFeature.length === 0) {
        alert('No digitized features to export! Place some points first.');
        return;
    }

    const geojson = {
        type: "FeatureCollection",
        name: "VR_Photogrammetry_Digitized_Vectors",
        crs: {
            type: "name",
            properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" }
        },
        features: []
    };

    // Include completed features
    state.completedFeatures.forEach((feat, idx) => {
        let geomType = feat.type.replace('Z', '');
        let coords = feat.coordinates;

        if (geomType === 'Polygon' && coords.length >= 3) {
            // Close polygon ring
            const closedCoords = [...coords, coords[0]];
            coords = [closedCoords];
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
    a.download = `vr_photogrammetry_${Date.now()}.geojson`;
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

    // 1. Process WebXR Gamepads if inside Quest 2
    if (renderer.xr.isPresenting) {
        pollVRGamepads(deltaTime);
        renderer.render(scene, camera);
        return;
    }

    // 2. Desktop Rendering Modes
    controls.update();

    if (state.displayMode === 'sbs') {
        // Side-by-Side Split Viewport
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setScissorTest(true);

        // Left Eye Viewport (Layer 1 + Layer 0)
        camera.layers.set(1);
        camera.layers.enable(0);
        renderer.setViewport(0, 0, w / 2, h);
        renderer.setScissor(0, 0, w / 2, h);
        renderer.render(scene, camera);

        // Right Eye Viewport (Layer 2 + Layer 0)
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
