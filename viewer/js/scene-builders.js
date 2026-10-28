import * as THREE from 'three';

/**
 * Two self-contained, pure Three.js builders. No app state.
 */

export function buildStereoWindowFrame({ w, h, previous, workstationGroup, vrHudMesh }) {
    if (previous) {
        workstationGroup.remove(previous);
        previous.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
    }

    const frame = new THREE.Group();
    workstationGroup.add(frame);

    const thickness = 0.08;
    const depth = 0.02;
    const bezelMat = new THREE.MeshBasicMaterial({ color: 0x141822 });

    const topBar = new THREE.Mesh(new THREE.BoxGeometry(w + thickness * 2, thickness, depth), bezelMat);
    topBar.position.set(0, h / 2 + thickness / 2, 0.005);
    frame.add(topBar);

    const btmBar = new THREE.Mesh(new THREE.BoxGeometry(w + thickness * 2, thickness, depth), bezelMat);
    btmBar.position.set(0, -h / 2 - thickness / 2, 0.005);
    frame.add(btmBar);

    const leftBar = new THREE.Mesh(new THREE.BoxGeometry(thickness, h, depth), bezelMat);
    leftBar.position.set(-w / 2 - thickness / 2, 0, 0.005);
    frame.add(leftBar);

    const rightBar = new THREE.Mesh(new THREE.BoxGeometry(thickness, h, depth), bezelMat);
    rightBar.position.set(w / 2 + thickness / 2, 0, 0.005);
    frame.add(rightBar);

    if (vrHudMesh) {
        vrHudMesh.position.set(0, -(h / 2) - 0.24, 0.12);
    }

    return frame;
}

export function createCentralFloatingMark(workstationGroup) {
    const mark = new THREE.Group();

    const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.005, 16),
        new THREE.MeshBasicMaterial({
            color: 0x00ffff, transparent: true, opacity: 1,
            depthTest: false, depthWrite: false, side: THREE.DoubleSide
        })
    );
    dot.renderOrder = 999;
    mark.add(dot);

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.016, 0.019, 32),
        new THREE.MeshBasicMaterial({
            color: 0x00d4ff, transparent: true, opacity: 1,
            depthTest: false, depthWrite: false, side: THREE.DoubleSide
        })
    );
    ring.renderOrder = 999;
    mark.add(ring);

    const lines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.035, 0, 0), new THREE.Vector3(-0.01, 0, 0),
            new THREE.Vector3(0.01, 0, 0), new THREE.Vector3(0.035, 0, 0),
            new THREE.Vector3(0, -0.035, 0), new THREE.Vector3(0, -0.01, 0),
            new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0, 0.035, 0)
        ]),
        new THREE.LineBasicMaterial({
            color: 0x00d4ff, transparent: true, opacity: 1,
            depthTest: false, depthWrite: false
        })
    );
    lines.renderOrder = 999;
    mark.add(lines);

    mark.position.set(0, 0, 0.03);
    workstationGroup.add(mark);

    return mark;
}
