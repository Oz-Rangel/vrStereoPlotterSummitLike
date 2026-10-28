import { setCustomPair, hasCustomPair } from './datasets.js';

/**
 * Desktop UI: tool buttons, dataset buttons, base-px, flips, action buttons,
 * display-mode toggles, and the custom stereo pair modal. All app mutations
 * go through `actions`, injected by app.js.
 */
export function createDesktopUI({ state, actions }) {
    const customPairState = {
        leftFile: null, rightFile: null,
        leftUrl: null, rightUrl: null,
        leftName: '', rightName: ''
    };

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

    function refreshCustomModalStatus() {
        const leftName = document.getElementById('custom-left-name');
        const rightName = document.getElementById('custom-right-name');
        const applyBtn = document.getElementById('btn-apply-custom');
        if (leftName) leftName.textContent = customPairState.leftName || 'No file selected';
        if (rightName) rightName.textContent = customPairState.rightName || 'No file selected';
        if (applyBtn) applyBtn.disabled = !(customPairState.leftFile && customPairState.rightFile);
    }

    function openCustomPairModal() {
        const modal = document.getElementById('custom-pair-modal');
        if (!modal) return;
        const baseInput = document.getElementById('custom-base-parallax');
        if (baseInput) baseInput.value = String(state.model.baseParallax || 0);
        refreshCustomModalStatus();
        modal.hidden = false;
    }

    function closeCustomPairModal() {
        const modal = document.getElementById('custom-pair-modal');
        if (modal) modal.hidden = true;
    }

    function applyCustomStereoPair() {
        if (!customPairState.leftFile || !customPairState.rightFile) return;

        revokeCustomUrls();
        customPairState.leftUrl = URL.createObjectURL(customPairState.leftFile);
        customPairState.rightUrl = URL.createObjectURL(customPairState.rightFile);

        const baseInput = document.getElementById('custom-base-parallax');
        const baseParallax = parseFloat(baseInput ? baseInput.value : '0');
        const basePx = Number.isFinite(baseParallax) ? baseParallax : 0.0;

        setCustomPair({
            left: customPairState.leftUrl,
            right: customPairState.rightUrl,
            baseParallax: basePx,
            parallaxPerMeter: 0.5
        });

        closeCustomPairModal();
        actions.toggleDataset('custom');
    }

    function bind() {
        document.querySelectorAll('.tool-btn').forEach((btn) => {
            btn.addEventListener('click', () => actions.setTool(btn.dataset.tool));
        });

        document.querySelectorAll('#dataset-group .btn-toggle').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.dataset;
                if (id === 'custom' && !hasCustomPair()) {
                    openCustomPairModal();
                    return;
                }
                actions.toggleDataset(id);
            });
        });

        const minus = document.getElementById('btn-base-p-minus');
        const plus = document.getElementById('btn-base-p-plus');
        const zero = document.getElementById('btn-base-p-zero');
        if (minus) minus.addEventListener('click', () => { state.model.baseParallax -= 5.0; actions.updateSummitPositions(); });
        if (plus) plus.addEventListener('click', () => { state.model.baseParallax += 5.0; actions.updateSummitPositions(); });
        if (zero) zero.addEventListener('click', () => { state.model.baseParallax = 0.0; actions.updateSummitPositions(); });

        const flipX = document.getElementById('btn-flip-x');
        const flipY = document.getElementById('btn-flip-y');
        if (flipX) flipX.addEventListener('click', () => {
            actions.toggleFlip('x');
            flipX.classList.toggle('active', state.flipX);
        });
        if (flipY) flipY.addEventListener('click', () => {
            actions.toggleFlip('y');
            flipY.classList.toggle('active', state.flipY);
        });

        const finish = document.getElementById('btn-finish-feature');
        if (finish) finish.addEventListener('click', actions.finishFeature);
        const undo = document.getElementById('btn-undo-point');
        if (undo) undo.addEventListener('click', actions.undo);
        const redo = document.getElementById('btn-redo-point');
        if (redo) redo.addEventListener('click', actions.redo);
        const clear = document.getElementById('btn-clear-all');
        if (clear) clear.addEventListener('click', actions.clearAll);
        const reset = document.getElementById('btn-reset-view');
        if (reset) reset.addEventListener('click', actions.resetView);
        const exp = document.getElementById('btn-export-geojson');
        if (exp) exp.addEventListener('click', actions.exportGeoJSON);

        document.querySelectorAll('#display-mode-group .btn-toggle').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#display-mode-group .btn-toggle').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                state.displayMode = btn.dataset.mode;
            });
        });

        const inputL = document.getElementById('file-left-input');
        const inputR = document.getElementById('file-right-input');
        const modal = document.getElementById('custom-pair-modal');

        const pickL = document.getElementById('btn-pick-left');
        const pickR = document.getElementById('btn-pick-right');
        const apply = document.getElementById('btn-apply-custom');
        const cancel = document.getElementById('btn-cancel-custom');
        const closeBtn = document.getElementById('btn-close-custom-modal');

        if (pickL && inputL) pickL.addEventListener('click', () => inputL.click());
        if (pickR && inputR) pickR.addEventListener('click', () => inputR.click());
        if (apply) apply.addEventListener('click', applyCustomStereoPair);
        if (cancel) cancel.addEventListener('click', closeCustomPairModal);
        if (closeBtn) closeBtn.addEventListener('click', closeCustomPairModal);

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeCustomPairModal();
            });
        }

        if (inputL) inputL.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            customPairState.leftFile = file;
            customPairState.leftName = file.name;
            refreshCustomModalStatus();
        });

        if (inputR) inputR.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            customPairState.rightFile = file;
            customPairState.rightName = file.name;
            refreshCustomModalStatus();
        });
    }

    return {
        bind,
        syncDatasetButtons,
        updateDatasetInfoBox,
        openCustomPairModal,
        closeCustomPairModal,
        refreshCustomModalStatus,
        revokeCustomUrls,
        customPairState
    };
}
