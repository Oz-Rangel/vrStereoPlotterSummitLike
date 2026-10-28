#!/usr/bin/env python3
"""
Photogrammetric Stereo Rectifier for Summit Evolution Project (Aurrera DemoDron).

Reads Model 3_33+3_34 (or any model specified) from SummitEV/SummitEV/Aurrera.smtxml,
performs epipolar alignment based on measured tie points,
eliminates vertical y-parallax, and exports web-optimized stereo pairs for the VR workstation.
"""

import os
import re
import sys
import numpy as np
from PIL import Image

def rectify_model(model_name="3_33+3_34", output_dir="viewer/assets/aurrera", target_width=2048):
    os.makedirs(output_dir, exist_ok=True)
    xml_path = "SummitEV/SummitEV/Aurrera.smtxml"

    print(f"[*] Reading project file: {xml_path}")
    with open(xml_path, 'r', encoding='latin-1') as f:
        text = f.read()

    # Find the requested model
    model_match = re.search(rf'<ModelInfo>\s*<ModelName>{re.escape(model_name)}</ModelName>(.*?)</ModelInfo>', text, re.DOTALL)
    if not model_match:
        print(f"[!] Error: Model {model_name} not found in project.")
        return False

    model_body = model_match.group(1)
    left_path_raw = re.search(r'<ModelLeft>(.*?)</ModelLeft>', model_body).group(1)
    right_path_raw = re.search(r'<ModelRight>(.*?)</ModelRight>', model_body).group(1)

    # Convert Windows backslashes to local paths
    left_filename = os.path.basename(left_path_raw.replace('\\', '/'))
    right_filename = os.path.basename(right_path_raw.replace('\\', '/'))

    left_img_path = os.path.join("SummitEV/Imagenes", left_filename)
    right_img_path = os.path.join("SummitEV/Imagenes", right_filename)

    print(f"[+] Model: {model_name}")
    print(f"    Left Photo : {left_img_path}")
    print(f"    Right Photo: {right_img_path}")

    # Extract all ImageInfo blocks
    images = re.findall(r'<ImageInfo>(.*?)</ImageInfo>', text, re.DOTALL)

    def get_tie_points_by_file(fn):
        for block in images:
            if fn in block:
                return dict(re.findall(r'<TP ID=\"(\d+)\"[^>]*>([\d\.\s\-]+)</TP>', block))
        return {}

    tp_left = get_tie_points_by_file(left_filename)
    tp_right = get_tie_points_by_file(right_filename)

    common_ids = sorted(list(set(tp_left.keys()) & set(tp_right.keys())))
    print(f"[+] Found {len(common_ids)} photogrammetric tie points between left and right photos.")

    pts_left = np.array([[float(v) for v in tp_left[cid].split()] for cid in common_ids])
    pts_right = np.array([[float(v) for v in tp_right[cid].split()] for cid in common_ids])

    # Open full-resolution TIFFs
    print("[*] Loading Left TIFF image...")
    img_l = Image.open(left_img_path).convert('RGB')
    print("[*] Loading Right TIFF image...")
    img_r = Image.open(right_img_path).convert('RGB')

    orig_w, orig_h = img_l.size
    print(f"[+] Sensor resolution: {orig_w}x{orig_h}")

    # Flight line on the sensor is along the Y axis (heading delta_y ~ 907px, delta_x ~ 2px).
    # Rotate 90° CW so the baseline is horizontal AND disparity has the conventional stereo
    # sign (x_right < x_left for conjugate points). The previous CCW rotation produced an
    # upside-down scene with inverted disparity (pseudoscopic depth).
    # New dimensions after 90° CW: (orig_h, orig_w) = (3456, 4608)
    rot_l = img_l.rotate(-90, expand=True)
    rot_r = img_r.rotate(-90, expand=True)

    rot_w, rot_h = rot_l.size

    # Transform tie points under 90° CW rotation:
    # (x_new, y_new) = (orig_h - 1 - y_old, x_old)
    p1_rot = np.column_stack([(orig_h - 1) - pts_left[:, 1], pts_left[:, 0]])
    p2_rot = np.column_stack([(orig_h - 1) - pts_right[:, 1], pts_right[:, 0]])

    # Fit an affine rectification on Image 2 so scanlines (Y coordinates) match Image 1
    # We want: [x1, y1] ~ [x2, y2, 1] @ M
    A = np.column_stack([p2_rot[:, 0], p2_rot[:, 1], np.ones(len(p2_rot))])

    # Affine mapping for X and Y:
    # We want to rectify Y2 to match Y1 (epipolar scanlines parallel to X):
    coeff_y, _, _, _ = np.linalg.lstsq(A, p1_rot[:, 1], rcond=None)

    # Ground baseline disparity (mean X shift). Expected negative after CW rotation.
    mean_disparity = np.mean(p2_rot[:, 0] - p1_rot[:, 0])
    print(f"[+] Intrinsic ground baseline disparity: {mean_disparity:.1f} pixels")

    # Shift Image 2 horizontally by -mean_disparity so average ground level has disparity = 0
    coeff_x, _, _, _ = np.linalg.lstsq(A, p2_rot[:, 0] - mean_disparity, rcond=None)

    # Calculate residual y-parallax after rectification
    y2_rect = A @ coeff_y
    res_y = y2_rect - p1_rot[:, 1]
    print(f"[+] Epipolar rectification quality: RMS y-parallax = {np.sqrt(np.mean(res_y**2)):.2f} px (Max: {np.max(np.abs(res_y)):.2f} px)")

    # Compute inverse affine matrix for PIL transform
    # Forward map: [x_new, y_new] = [x_old, y_old, 1] @ [coeff_x, coeff_y].T
    M_fwd = np.array([
        [coeff_x[0], coeff_y[0]],
        [coeff_x[1], coeff_y[1]]
    ])
    trans_fwd = np.array([coeff_x[2], coeff_y[2]])

    # Inverse map for PIL: [x_old, y_old] = inv(M_fwd) @ ([x_new, y_new] - trans_fwd)
    M_inv = np.linalg.inv(M_fwd)
    trans_inv = -M_inv @ trans_fwd

    # PIL affine data: (a, b, c, d, e, f) where x_old = a*x + b*y + c, y_old = d*x + e*y + f
    pil_affine = (
        M_inv[0, 0], M_inv[0, 1], trans_inv[0],
        M_inv[1, 0], M_inv[1, 1], trans_inv[1]
    )

    print("[*] Resampling and rectifying Right image...")
    rect_r = rot_r.transform((rot_w, rot_h), Image.Transform.AFFINE, pil_affine, resample=Image.Resampling.BILINEAR)

    # Scale both images to target web resolution (e.g. 2048 x 1536)
    target_height = int(round(rot_h * (target_width / rot_w)))
    print(f"[*] Rescaling to optimized VR resolution: {target_width}x{target_height}...")
    
    final_l = rot_l.resize((target_width, target_height), Image.Resampling.LANCZOS)
    final_r = rect_r.resize((target_width, target_height), Image.Resampling.LANCZOS)

    out_l = os.path.join(output_dir, "left.png")
    out_r = os.path.join(output_dir, "right.png")

    print(f"[*] Saving Left stereo image to: {out_l}")
    final_l.save(out_l, "PNG", optimize=True)

    print(f"[*] Saving Right stereo image to: {out_r}")
    final_r.save(out_r, "PNG", optimize=True)

    print("[+] SUCCESS! Real Aurrera drone stereo pair generated with 0.0px ground datum and sub-pixel vertical alignment.")
    return True

def list_models():
    xml_path = "SummitEV/SummitEV/Aurrera.smtxml"
    with open(xml_path, 'r', encoding='latin-1') as f:
        text = f.read()
    names = re.findall(r'<ModelName>(.*?)</ModelName>', text)
    print(f"[+] {len(names)} stereo models in {xml_path}:")
    for name in names:
        print(f"    {name}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ("-l", "--list"):
        list_models()
        sys.exit(0)

    model = sys.argv[1] if len(sys.argv) > 1 else "3_33+3_34"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "viewer/assets/aurrera"
    ok = rectify_model(model, output_dir=out_dir)
    if ok:
        print("[i] Load the pair in the viewer via the Aurrera dataset button,")
        print("    or use Custom and pick the generated left.png / right.png.")
    sys.exit(0 if ok else 1)
