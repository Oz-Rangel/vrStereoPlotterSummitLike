# QGIS VR Photogrammetry Workstation (Meta Quest 2)

An open-source stereoscopic photogrammetric workstation bridging **QGIS** with VR headsets (**Meta Quest 2 / Quest 3**) via **WebXR**, emulating professional digital stereoplotters like **DAT/EM Summit Evolution**.

---

## 🎯 Project Overview & Architecture

Traditional stereoscopic photogrammetry has historically depended on expensive, obsolete hardware (NVIDIA 3D Vision shutter glasses, 120Hz dual-DVI monitors, or $5,000+ Planar StereoMirror beam-splitters). 

This project implements a modern, accessible photogrammetry pipeline:
* **Optical Isolation:** Complete stereoscopic separation (Left eye $\to$ Left photo, Right eye $\to$ Right photo) using Three.js WebXR camera layers (`layers.set(1)` and `layers.set(2)`).
* **Summit Evolution Roaming & Image Parallax Engine:**
  * **Central Floating Mark:** The measuring reticle sits fixed in the center of the display at (0, 0) with zero eye vergence strain.
  * **Dynamic Image Roaming (X, Y):** Left Stick roams the aerial imagery smoothly beneath the central mark.
  * **Relative Image Parallax (Z-Wheel):** Right Stick Up/Down shifts the Right Image horizontally relative to the Left Image. As you spin the Z-wheel, the feature under the crosshair shifts until both eye images fuse into solid 3D depth at the reticle!
  * **Base Parallax Datum Calibration:** Calibrated datum offset (-60px for Vaihingen) eliminates forced eye vergence and image double-overlap.
  * **Zoom Magnification:** Right Stick Left/Right smoothly magnifies the stereo view from 0.5x to 3.5x.
* **Vector Digitizer:** 3D CAD/GIS vectors parented directly to Left and Right image planes with full Undo/Redo/Erase history.
* **QGIS / CAD Integration:** Live synchronization to PyQGIS vector layers and export to 3D GeoJSON and AutoCAD DXF.

---

## 🚀 Phase 1: Standalone WebXR Stereoplotter Engine

Phase 1 provides a clean, fully functional stereoscopic viewer ready to run on the **Meta Quest 2 Browser** or in any desktop web browser.

### Directory Structure
```
vrphotogrammetry/
├── viewer/                       # WebXR Stereoscopic Workstation Client
│   ├── index.html                # Main viewer interface & HUD
│   ├── server.py                 # Multi-threaded HTTPS/HTTP dev server with auto-SSL
│   ├── generate_stereo_pair.py   # Photogrammetric stereo test pair generator
│   ├── css/
│   │   └── style.css             # Dark photogrammetry HUD styling
│   ├── js/
│   │   └── app.js                # Three.js WebXR engine & 3D floating mark
│   └── assets/
│       ├── left.png              # Left eye calibrated aerial photo
│       └── right.png             # Right eye calibrated aerial photo
├── vr_plugin/                    # QGIS Python Plugin (Phase 2 bridge)
│   ├── __init__.py
│   └── vr_plugin.py
└── README.md
```

---

## 🕹️ How to Run and Test (Phase 1)

### 1. Start the Dev Server
Run the included multi-threaded server:
```bash
python3 viewer/server.py
```
* The server automatically generates a local self-signed SSL certificate (`cert.pem`, `key.pem`) required by Meta Quest Browser to grant WebXR permissions (`immersive-vr`).
* It detects your computer's local Wi-Fi IP address (e.g., `192.168.1.6`).

---

### 2. Testing in Meta Quest 2
1. Put on your **Meta Quest 2** (ensure it is connected to the same Wi-Fi network as your computer).
2. Open the built-in **Meta Quest Browser**.
3. In the address bar, type:
   ```
   https://<YOUR_PC_IP>:8000
   ```
   *(Example: `https://192.168.1.6:8000`)*
4. The Quest Browser will show a certificate notice (*"Your connection is not private"*):
   * Click **Advanced**.
   * Click **Proceed to 192.168.1.x (unsafe)**. *(Only required once for local dev).*
5. Click the glowing **[ENTER VR]** button at the bottom of the screen.
6. You are now inside the stereoscopic model with the 3D Floating Mark!

#### Meta Quest 2 Controller Controls
| Controller | Action | Description |
| :--- | :--- | :--- |
| **Left or Right Grip** | **Grab & Drag Canvas** | Squeeze grip to grab the workstation in 3D and drag it anywhere (push further away, pull closer, raise, lower, tilt). |
| **Both Grips (Simultaneous)** | **Two-Handed Pinch Scale** | Squeeze both grips and move hands apart/together to scale & zoom the stereo canvas. |
| **Left Stick Click** | **Reset View** | Re-centers the stereo model directly in front of your head at a comfortable 2.4m distance. |
| **Left Thumbstick** | **Roam X / Y** | Move the floating mark across the stereo model (Easting / Northing). |
| **Right Thumbstick (Up / Down)** | **Elevate Z** | Adjust stereoscopic depth / elevation. Raises or lowers the mark to fuse on rooftops/ground. |
| **Right Trigger** | **Digitize Vertex** | Adds a 3D vertex at the current $(X, Y, Z)$ ground coordinate (with haptic click). Also clicks HUD buttons when pointing at the HUD. |
| **Left Button X** | **Undo** | Reverts the last digitized vertex or undone feature. |
| **Left Button Y** | **Redo** | Restores the previously reverted action. |
| **Right Button A** | **Cycle Tool** | Switch digitizer between `PointZ`, `LineStringZ`, and `PolygonZ`. |
| **Right Button B** | **Finish Feature** | Complete the active line/polygon and start a new feature. |
| **Laser Pointer on HUD** | **Touch Tablet** | Aim at the In-VR HUD to click **Undo**, **Redo**, **Clear All**, **Reset View**, or **Tool**. |

---

### 3. Testing on Desktop (Without Headset)
You can also test directly on your PC monitor:
* Open `https://localhost:8000` in Chrome / Edge / Safari.
* **Display Modes:**
  * **Mono:** Standard single-eye view for inspection.
  * **Side-by-Side (SBS):** Split viewport showing both Left and Right views simultaneously.
* **Controls:**
  * **Arrow Keys / WASD:** Pan $X, Y$ coordinates.
  * **Mouse Wheel / Q, E:** Adjust elevation $Z$.
  * **Spacebar / Left Click:** Digitize 3D vertex.
  * **Enter:** Finish active feature.
  * **U:** Undo last vertex.

---

## 🎯 Calibrated Targets in the Test Stereo Pair

The test dataset (`left.png` and `right.png`) contains photogrammetric features with known true elevations and horizontal disparity ($p_x = 0.5 \times Z$):

1. **Yellow Ground Control Points (GCPs):** $Z = 0.0\text{ m}$ ($p_x = 0\text{ px}$).
2. **Terraced Hill (Top Left):** Contours at $Z = 10\text{ m}$, $20\text{ m}$, and $35\text{ m}$.
3. **Building A (Commercial Complex - Top Right):**
   * Roof level: $Z = 45.0\text{ m}$ ($p_x = 22.5\text{ px}$).
   * Rooftop HVAC: $Z = 55.0\text{ m}$ ($p_x = 27.5\text{ px}$).
4. **Building B (High-Rise Tower - Bottom Right):**
   * Main Roof: $Z = 80.0\text{ m}$ ($p_x = 40.0\text{ px}$).
   * Spire Needle: $Z = 110.0\text{ m}$ ($p_x = 55.0\text{ px}$).
5. **Excavation Pit (Bottom Left):**
   * Upper bench: $Z = -25.0\text{ m}$.
   * Pit floor: $Z = -40.0\text{ m}$.

---

## 🗺️ Project Roadmap

- [x] **Phase 1: WebXR Stereoscopic Workstation Engine (Complete)**
  - Three.js WebXR stereo layers (`layers.set(1)`, `layers.set(2)`).
  - 3D Floating Mark with analog depth/elevation control.
  - In-VR floating HUD and desktop telemetry.
  - Multi-feature 3D digitizer (`PointZ`, `LineStringZ`, `PolygonZ`).
  - Auto-SSL dev server for Meta Quest Browser.
  - 3D GeoJSON export.
- [ ] **Phase 2: PyQGIS Plugin & Qt Signal WebSocket Bridge**
  - Live bidirectional socket connection between Quest 2 and QGIS Desktop.
  - Safe UI-thread feature injection via `pyqtSignal`.
  - Layer synchronization (active QGIS layer auto-populates in VR).
- [ ] **Phase 3: Epipolar Tiling & High-Res BigTIFF Streaming**
  - Python GDAL dynamic tile generator to stream multi-gigabyte aerial orthos/stereopairs without overloading Quest memory.
- [ ] **Phase 4: Photogrammetric Collinearity & Bundle Adjustment Engine**
  - Interior Orientation (IO) and Exterior Orientation (EO) parameter support.
  - Real-world UTM / MSL coordinate transformation.
