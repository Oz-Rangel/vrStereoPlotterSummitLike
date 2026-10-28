import * as THREE from 'three';
import { computeVertexLocal } from './stereo-math.js';
import {
    pushVertex, removeLastVertex, finishFeature, reopenLastFeature,
    clearAll as digitizerClearAll, restore as digitizerRestore,
    isEmpty, vertexCount, featureCount
} from './digitizer.js';
import {
    COMMANDS, push as historyPush, takeUndo, takeRedo, clear as historyClear
} from './history.js';

/**
 * Bridges the pure digitizer state machine to the Three.js scene graph.
 * Owns the "active" line meshes and translates history push/pop into mesh
 * add/remove. Business logic still lives in ./digitizer.js and ./history.js.
 */
export function createDigitizerBridge({
    digitizer,
    history,
    getModel,
    getVectorGroups,
    onStatsChange = () => {}
}) {
    let activeLineMeshLeft = null;
    let activeLineMeshRight = null;

    function localsFor(point) {
        const m = getModel();
        return computeVertexLocal({
            px: point.x, py: point.y, z: point.z,
            baseParallax: m.baseParallax,
            parallaxPerMeter: m.parallaxPerMeter,
            widthUnits: m.widthUnits,
            heightUnits: m.heightUnits,
            planeWidth3D: m.planeWidth3D,
            planeHeight3D: m.planeHeight3D
        });
    }

    function disposeLine(mesh) {
        if (!mesh) return;
        if (mesh.parent) mesh.parent.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
    }

    function syncLineMeshes() {
        const groups = getVectorGroups();
        disposeLine(activeLineMeshLeft);
        disposeLine(activeLineMeshRight);
        activeLineMeshLeft = null;
        activeLineMeshRight = null;

        if (digitizer.activeFeature.length < 2) return;

        const pointsL = [];
        const pointsR = [];
        for (const v of digitizer.activeFeature) {
            const l = localsFor(v);
            pointsL.push(new THREE.Vector3(l.left.x, l.left.y, 0.002));
            pointsR.push(new THREE.Vector3(l.right.x, l.right.y, 0.002));
        }

        const lineL = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pointsL),
            new THREE.LineBasicMaterial({ color: 0x00d4ff, linewidth: 2, depthTest: false })
        );
        lineL.layers.set(1);
        groups.left.add(lineL);
        activeLineMeshLeft = lineL;

        const lineR = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pointsR),
            new THREE.LineBasicMaterial({ color: 0x00d4ff, linewidth: 2, depthTest: false })
        );
        lineR.layers.set(2);
        groups.right.add(lineR);
        activeLineMeshRight = lineR;
    }

    function digitizeCurrentVertex(cursor) {
        const groups = getVectorGroups();
        if (!groups.left || !groups.right) return;

        const vertex = { x: cursor.x, y: cursor.y, z: cursor.z };
        pushVertex(digitizer, vertex);

        const local = localsFor(vertex);
        const geo = new THREE.CircleGeometry(0.008, 16);

        const matL = new THREE.MeshBasicMaterial({ color: 0x33ff99, depthTest: false, side: THREE.DoubleSide });
        const meshL = new THREE.Mesh(geo, matL);
        meshL.position.set(local.left.x, local.left.y, 0.002);
        meshL.layers.set(1);
        groups.left.add(meshL);

        const matR = new THREE.MeshBasicMaterial({ color: 0x33ff99, depthTest: false, side: THREE.DoubleSide });
        const meshR = new THREE.Mesh(geo, matR);
        meshR.position.set(local.right.x, local.right.y, 0.002);
        meshR.layers.set(2);
        groups.right.add(meshR);

        vertex.refs = { meshL, meshR };

        historyPush(history, { type: COMMANDS.ADD_VERTEX, vertex });

        syncLineMeshes();

        if (digitizer.activeTool === 'PointZ') {
            finishActiveFeature();
        }

        onStatsChange();
    }

    function finishActiveFeature() {
        const feature = finishFeature(digitizer);
        if (!feature) return;

        feature.refs = {
            lineMeshL: activeLineMeshLeft,
            lineMeshR: activeLineMeshRight
        };

        historyPush(history, { type: COMMANDS.FINISH_FEATURE, feature });

        // Lines stay attached to their groups; we just stop treating them as "active"
        activeLineMeshLeft = null;
        activeLineMeshRight = null;

        onStatsChange();
    }

    function undoAction() {
        const action = takeUndo(history);
        if (!action) return;

        if (action.type === COMMANDS.ADD_VERTEX) {
            const v = removeLastVertex(digitizer);
            if (v?.refs?.meshL) getVectorGroups().left.remove(v.refs.meshL);
            if (v?.refs?.meshR) getVectorGroups().right.remove(v.refs.meshR);
            syncLineMeshes();
        } else if (action.type === COMMANDS.FINISH_FEATURE) {
            reopenLastFeature(digitizer);
            activeLineMeshLeft = action.feature.refs?.lineMeshL ?? null;
            activeLineMeshRight = action.feature.refs?.lineMeshR ?? null;
        } else if (action.type === COMMANDS.CLEAR_ALL) {
            digitizerRestore(digitizer, action.snapshot);
            activeLineMeshLeft = action.activeLineMeshLeft;
            activeLineMeshRight = action.activeLineMeshRight;
            reattachAllMeshes();
        }

        onStatsChange();
    }

    function redoAction() {
        const action = takeRedo(history);
        if (!action) return;

        if (action.type === COMMANDS.ADD_VERTEX) {
            pushVertex(digitizer, action.vertex);
            if (action.vertex.refs?.meshL) getVectorGroups().left.add(action.vertex.refs.meshL);
            if (action.vertex.refs?.meshR) getVectorGroups().right.add(action.vertex.refs.meshR);
            syncLineMeshes();
        } else if (action.type === COMMANDS.FINISH_FEATURE) {
            digitizer.completedFeatures.push(action.feature);
            digitizer.activeFeature.length = 0;
            activeLineMeshLeft = null;
            activeLineMeshRight = null;
        } else if (action.type === COMMANDS.CLEAR_ALL) {
            digitizerClearAll(digitizer);
            detachAllMeshes();
            activeLineMeshLeft = null;
            activeLineMeshRight = null;
        }

        onStatsChange();
    }

    function clearAllFeatures(recordHistory = true) {
        if (isEmpty(digitizer)) return;

        if (recordHistory) {
            const snapshot = digitizerClearAll(digitizer);
            historyPush(history, {
                type: COMMANDS.CLEAR_ALL,
                snapshot,
                activeLineMeshLeft,
                activeLineMeshRight
            });
        } else {
            digitizerClearAll(digitizer);
        }

        detachAllMeshes();
        activeLineMeshLeft = null;
        activeLineMeshRight = null;

        onStatsChange();
    }

    function detachAllMeshes() {
        const g = getVectorGroups();
        while (g.left && g.left.children.length > 0) g.left.remove(g.left.children[0]);
        while (g.right && g.right.children.length > 0) g.right.remove(g.right.children[0]);
    }

    function reattachAllMeshes() {
        const g = getVectorGroups();

        for (const v of digitizer.activeFeature) {
            if (v.refs?.meshL) g.left.add(v.refs.meshL);
            if (v.refs?.meshR) g.right.add(v.refs.meshR);
        }
        for (const f of digitizer.completedFeatures) {
            for (const v of f.vertices) {
                if (v.refs?.meshL) g.left.add(v.refs.meshL);
                if (v.refs?.meshR) g.right.add(v.refs.meshR);
            }
            if (f.refs?.lineMeshL) g.left.add(f.refs.lineMeshL);
            if (f.refs?.lineMeshR) g.right.add(f.refs.lineMeshR);
        }

        if (activeLineMeshLeft) g.left.add(activeLineMeshLeft);
        if (activeLineMeshRight) g.right.add(activeLineMeshRight);
    }

    /** Bug A fix: called by buildStereoPlanes before it drops the old groups. */
    function resetOnRebuild() {
        digitizerClearAll(digitizer);
        historyClear(history);
        activeLineMeshLeft = null;
        activeLineMeshRight = null;
        onStatsChange();
    }

    function stats() {
        return {
            vertexCount: vertexCount(digitizer),
            featureCount: featureCount(digitizer),
            undoDepth: history.undoStack.length,
            redoDepth: history.redoStack.length
        };
    }

    return {
        digitizeCurrentVertex,
        finishActiveFeature,
        undoAction,
        redoAction,
        clearAllFeatures,
        resetOnRebuild,
        stats
    };
}
