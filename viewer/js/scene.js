import * as THREE from 'three';
import {
    PLANE_BASE_SIZE,
    computeImageDimensions,
    computePlanePositions,
    computeTotalParallax
} from './stereo-math.js';
import { renderHud, HUD_CANVAS_WIDTH, HUD_CANVAS_HEIGHT } from './vr-hud.js';
import { buildStereoWindowFrame, createCentralFloatingMark } from './scene-builders.js';
import { DATASETS } from './datasets.js';

/**
 * Owns every Three.js object in the workstation: eye planes, textures,
 * vector groups, bezel, reticle, and the VR HUD canvas mesh. App state
 * is owned by app.js; this module only reads it.
 */
export function createScene({ state, getDigitizer }) {
    const workstationGroup = new THREE.Group();

    let leftPlane = null;
    let rightPlane = null;
    let leftTexture = null;
    let rightTexture = null;

    const vectorGroupLeft = new THREE.Group();
    const vectorGroupRight = new THREE.Group();
    vectorGroupLeft.layers.set(1);
    vectorGroupRight.layers.set(2);
    // NOTE: no workstationGroup.add() here — each group is a child of its eye's plane.
    // buildStereoPlanes() (re)attaches them.

    let stereoWindowFrame = null;
    let centralMark = null;

    let vrHudMesh = null;
    let vrHudCanvas = null;
    let vrHudCtx = null;
    let vrHudTexture = null;
    let hoveredButtonId = null;
    let lastLaserUV = null;
    let lastHudSignature = '';

    function clearGroup(group) {
        while (group.children.length > 0) {
            const child = group.children[0];
            group.remove(child);
            if (child.geometry && typeof child.geometry.dispose === 'function') child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((m) => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        }
    }

    function createVRHud() {
        vrHudCanvas = document.createElement('canvas');
        vrHudCanvas.width = HUD_CANVAS_WIDTH;
        vrHudCanvas.height = HUD_CANVAS_HEIGHT;
        vrHudCtx = vrHudCanvas.getContext('2d');

        vrHudTexture = new THREE.CanvasTexture(vrHudCanvas);
        vrHudTexture.colorSpace = THREE.SRGBColorSpace;

        const aspect = HUD_CANVAS_WIDTH / HUD_CANVAS_HEIGHT;
        const hudW = 0.8;
        const hudH = hudW / aspect;
        const geo = new THREE.PlaneGeometry(hudW, hudH);
        const mat = new THREE.MeshBasicMaterial({
            map: vrHudTexture, transparent: true, depthTest: false
        });
        vrHudMesh = new THREE.Mesh(geo, mat);
        vrHudMesh.position.set(0, -(state.model.planeHeight3D / 2) - 0.24, 0.12);
        vrHudMesh.renderOrder = 1000;
        vrHudMesh.layers.enable(0);
        workstationGroup.add(vrHudMesh);

        updateVRHudTexture();
        return vrHudMesh;
    }

    function updateVRHudTexture(laserUV) {
        // undefined -> keep previous position
        // null      -> explicitly clear stale reticle
        // {x,y}     -> set new position
        if (laserUV === null) lastLaserUV = null;
        else if (laserUV !== undefined) lastLaserUV = laserUV;

        if (!vrHudCtx) return;

        const digitizer = getDigitizer();
        const ds = DATASETS[state.currentDataset] || DATASETS.synth;
        const dsShort = ds.shortLabel || ds.label || state.currentDataset;

        const sig = [
            state.cursor.x.toFixed(2),
            state.cursor.y.toFixed(2),
            state.cursor.z.toFixed(2),
            state.model.baseParallax.toFixed(1),
            state.model.zoom.toFixed(1),
            state.currentDataset,
            digitizer ? digitizer.activeTool : '',
            digitizer ? digitizer.activeFeature.length : 0,
            digitizer ? digitizer.completedFeatures.length : 0,
            hoveredButtonId || '',
            lastLaserUV ? `${lastLaserUV.x.toFixed(1)},${lastLaserUV.y.toFixed(1)}` : ''
        ].join('|');
        if (sig === lastHudSignature) return;
        lastHudSignature = sig;

        renderHud(vrHudCtx, {
            cursorX: state.cursor.x,
            cursorY: state.cursor.y,
            cursorZ: state.cursor.z,
            totalParallax: state.cursor.totalParallax,
            baseParallax: state.model.baseParallax,
            zoom: state.model.zoom,
            datasetLabel: dsShort,
            datasetShortLabel: dsShort,
            activeTool: digitizer ? digitizer.activeTool : 'LineStringZ',
            activeFeatureCount: digitizer ? digitizer.activeFeature.length : 0,
            completedFeaturesCount: digitizer ? digitizer.completedFeatures.length : 0,
            hoveredButtonId,
            laserUV: lastLaserUV
        });
        vrHudTexture.needsUpdate = true;
    }

    function setHoveredButton(id) {
        if (hoveredButtonId === id) return;
        hoveredButtonId = id;
        lastHudSignature = '';
        updateVRHudTexture();
    }

    function applyImageDimensions(imgWidth, imgHeight) {
        const dims = computeImageDimensions(imgWidth, imgHeight, PLANE_BASE_SIZE);
        state.model.widthUnits = dims.widthUnits;
        state.model.heightUnits = dims.heightUnits;
        state.model.planeWidth3D = dims.planeWidth3D;
        state.model.planeHeight3D = dims.planeHeight3D;
        state.cursor.x = dims.widthUnits / 2;
        state.cursor.y = dims.heightUnits / 2;
        buildStereoPlanes();
    }

    function buildStereoPlanes() {
        if (leftPlane) {
            leftPlane.remove(vectorGroupLeft);      // detach before dispose
            workstationGroup.remove(leftPlane);
            leftPlane.geometry.dispose();
            leftPlane.material.dispose();
            leftPlane = null;
        }
        if (rightPlane) {
            rightPlane.remove(vectorGroupRight);    // detach before dispose
            workstationGroup.remove(rightPlane);
            rightPlane.geometry.dispose();
            rightPlane.material.dispose();
            rightPlane = null;
        }

        // Old vector meshes belong to the discarded planes.
        clearGroup(vectorGroupLeft);
        clearGroup(vectorGroupRight);

        const w = state.model.planeWidth3D;
        const h = state.model.planeHeight3D;

        const geo = new THREE.PlaneGeometry(w, h);

        const matL = new THREE.MeshBasicMaterial({
            map: leftTexture, transparent: true, side: THREE.DoubleSide
        });
        leftPlane = new THREE.Mesh(geo, matL);
        leftPlane.layers.set(1);
        leftPlane.add(vectorGroupLeft);             // reattach
        workstationGroup.add(leftPlane);

        const matR = new THREE.MeshBasicMaterial({
            map: rightTexture, transparent: true, side: THREE.DoubleSide
        });
        rightPlane = new THREE.Mesh(geo, matR);
        rightPlane.layers.set(2);
        rightPlane.add(vectorGroupRight);           // reattach
        workstationGroup.add(rightPlane);

        createStereoWindowFrame();
        applyTextureFlips();
        updateStereoPlanePositions();
    }

    function createStereoWindowFrame() {
        stereoWindowFrame = buildStereoWindowFrame({
            w: state.model.planeWidth3D,
            h: state.model.planeHeight3D,
            previous: stereoWindowFrame,
            workstationGroup,
            vrHudMesh
        });
    }

    function updateStereoPlanePositions() {
        if (!leftPlane || !rightPlane) return;

        state.cursor.totalParallax = computeTotalParallax({
            baseParallax: state.model.baseParallax,
            z: state.cursor.z,
            parallaxPerMeter: state.model.parallaxPerMeter
        });

        const pos = computePlanePositions({
            cursorX: state.cursor.x,
            cursorY: state.cursor.y,
            widthUnits: state.model.widthUnits,
            heightUnits: state.model.heightUnits,
            planeWidth3D: state.model.planeWidth3D,
            planeHeight3D: state.model.planeHeight3D,
            zoom: state.model.zoom,
            totalParallax: state.cursor.totalParallax
        });

        leftPlane.position.set(pos.left.x, pos.left.y, pos.left.z);
        rightPlane.position.set(pos.right.x, pos.right.y, pos.right.z);
        leftPlane.scale.setScalar(state.model.zoom);
        rightPlane.scale.setScalar(state.model.zoom);
    }

    function applyTextureFlips() {
        for (const tex of [leftTexture, rightTexture]) {
            if (!tex) continue;
            tex.flipX = !!state.flipX;
            tex.flipY = !!state.flipY;
            tex.needsUpdate = true;
        }
    }

    function toggleFlip(axis) {
        if (axis === 'x') state.flipX = !state.flipX;
        else if (axis === 'y') state.flipY = !state.flipY;
        applyTextureFlips();
    }

    function loadStereoTextures(leftUrl, rightUrl, opts = {}) {
        const loader = new THREE.TextureLoader();
        const {
            baseParallax = 0,
            parallaxPerMeter = 0.5,
            flipX = false,
            flipY = false,
            onLoaded = null
        } = opts;

        Promise.all([
            loader.loadAsync(leftUrl),
            loader.loadAsync(rightUrl)
        ]).then(([texL, texR]) => {
            if (leftTexture) leftTexture.dispose();
            if (rightTexture) rightTexture.dispose();

            leftTexture = texL;
            rightTexture = texR;

            for (const tex of [texL, texR]) {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.minFilter = THREE.LinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.generateMipmaps = false;
            }

            state.model.baseParallax = baseParallax;
            state.model.parallaxPerMeter = parallaxPerMeter;
            state.flipX = !!flipX;
            state.flipY = !!flipY;

            applyImageDimensions(texL.image.width, texL.image.height);

            if (onLoaded) onLoaded();
        }).catch((err) => {
            console.error('Stereo texture load failed:', err);
        });
    }

    function init() {
        createVRHud();
        centralMark = createCentralFloatingMark(workstationGroup);
        return workstationGroup;
    }

    function dispose() {
        if (leftTexture) leftTexture.dispose();
        if (rightTexture) rightTexture.dispose();
        if (vrHudTexture) vrHudTexture.dispose();
    }

    return {
        init,
        loadStereoTextures,
        buildStereoPlanes,
        applyImageDimensions,
        applyTextureFlips,
        toggleFlip,
        updateStereoPlanePositions,
        updateVRHudTexture,
        setHoveredButton,
        createVRHud,
        getRefs: () => ({
            workstationGroup,
            leftPlane, rightPlane,
            vectorGroupLeft, vectorGroupRight,
            vrHudMesh, stereoWindowFrame
        }),
        getVectorGroups: () => ({ left: vectorGroupLeft, right: vectorGroupRight }),
        getPlaneMeshes: () => ({ left: leftPlane, right: rightPlane }),
        dispose
    };
}
