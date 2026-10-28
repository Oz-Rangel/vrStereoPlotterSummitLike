// viewer/js/scene.js — proposed public surface

export function createScene({ state, bridge, onImageDimensions, onHudDirty }) { /* ... */ }

// returned object:
//   addToScene(workstationGroup)         — frame + reticle wiring
//   rebuildStereoPlanes()                — current buildStereoPlanes
//   loadStereoTextures(leftUrl, rightUrl, opts)  — current loader
//   applyTextureFlips() / toggleFlip(axis)       — current flip helpers
//   syncFlipButtons()                    — delegates to desktopUI if present
//   updateStereoPlanePositions()         — current updateSummitPositions math
//   createVRHud() / updateVRHudTexture(laserUV) — HUD wrapper
//   getPlaneMeshes() / getVectorGroups() — accessors for bridge
//   dispose()
