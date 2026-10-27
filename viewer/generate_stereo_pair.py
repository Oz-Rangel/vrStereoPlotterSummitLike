#!/usr/bin/env python3
"""
Generates a calibrated synthetic stereoscopic aerial photo pair (left.png and right.png)
with accurate photogrammetric parallax across multiple elevations (Z values).

Elevations & Theoretical Disparities:
- Ground level: Z = 0 m       -> Disparity = 0 px
- Terraced Mound: Z = 20 m    -> Disparity = 10 px
- Building A (Office): Z = 45 m -> Disparity = 22 px
- Building B (Tower): Z = 80 m -> Disparity = 40 px
- Spire / Antenna: Z = 105 m  -> Disparity = 52 px
- Excavation Basin: Z = -25 m -> Disparity = -12 px
"""

import math
import os
import struct
import zlib

WIDTH = 1024
HEIGHT = 1024

def write_png(filename, width, height, rgb_buffer):
    """Writes an RGB image as a standard PNG using zlib without external libraries."""
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    raw = bytearray()
    row_bytes = width * 3
    for y in range(height):
        raw.append(0)  # Filter type 0: None
        start = y * row_bytes
        raw.extend(rgb_buffer[start:start + row_bytes])

    compressed = zlib.compress(bytes(raw), level=6)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)  # 8-bit RGB

    with open(filename, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', compressed))
        f.write(chunk(b'IEND', b''))

def create_stereo_pair(output_dir="viewer/assets"):
    os.makedirs(output_dir, exist_ok=True)
    left_buf = bytearray(WIDTH * HEIGHT * 3)
    right_buf = bytearray(WIDTH * HEIGHT * 3)

    # Elevation scale: 1 meter elevation = 0.5 pixels parallax disparity
    PARALLAX_PER_METER = 0.5

    def set_pixel(buf, x, y, r, g, b):
        if 0 <= x < WIDTH and 0 <= y < HEIGHT:
            idx = (y * WIDTH + x) * 3
            buf[idx] = r
            buf[idx + 1] = g
            buf[idx + 2] = b

    def draw_filled_rect(x1, y1, x2, y2, z, r, g, b, border_rgb=None):
        disp = int(round(z * PARALLAX_PER_METER))
        # Left eye: drawn at baseline position
        # Right eye: conjugate features at height Z are shifted leftward by 'disp' pixels
        for y in range(max(0, y1), min(HEIGHT, y2)):
            for x in range(max(0, x1), min(WIDTH, x2)):
                is_border = border_rgb and (x == x1 or x == x2 - 1 or y == y1 or y == y2 - 1)
                cr, cg, cb = border_rgb if is_border else (r, g, b)
                set_pixel(left_buf, x, y, cr, cg, cb)
                set_pixel(right_buf, x - disp, y, cr, cg, cb)

    def draw_filled_circle(cx, cy, radius, z, r, g, b, border_rgb=None):
        disp = int(round(z * PARALLAX_PER_METER))
        r2 = radius * radius
        for dy in range(-radius, radius + 1):
            y = cy + dy
            if 0 <= y < HEIGHT:
                for dx in range(-radius, radius + 1):
                    d2 = dx * dx + dy * dy
                    if d2 <= r2:
                        x = cx + dx
                        is_border = border_rgb and (d2 >= (radius - 2) * (radius - 2))
                        cr, cg, cb = border_rgb if is_border else (r, g, b)
                        set_pixel(left_buf, x, y, cr, cg, cb)
                        set_pixel(right_buf, x - disp, y, cr, cg, cb)

    def draw_crosshair_gcp(cx, cy, z, label_val=None):
        disp = int(round(z * PARALLAX_PER_METER))
        size = 14
        # Draw white GCP crosshair with black shadow
        for i in range(-size, size + 1):
            # Left eye
            set_pixel(left_buf, cx + i, cy, 255, 255, 0)
            set_pixel(left_buf, cx, cy + i, 255, 255, 0)
            # Right eye (shifted by disparity)
            set_pixel(right_buf, cx + i - disp, cy, 255, 255, 0)
            set_pixel(right_buf, cx - disp, cy + i, 255, 255, 0)

    # 1. Base Terrain Background (Z = 0m, Greenish-gray terrain with grid)
    for y in range(HEIGHT):
        for x in range(WIDTH):
            # Subtle topographic ground texture
            pattern = ((x // 64) + (y // 64)) % 2
            base_val = 55 + (10 if pattern == 0 else 0)
            # Add subtle grid lines every 64 pixels
            is_grid = (x % 64 == 0) or (y % 64 == 0)
            if is_grid:
                r, g, b = 90, 110, 85
            else:
                r, g, b = base_val, base_val + 20, base_val + 5
            set_pixel(left_buf, x, y, r, g, b)
            set_pixel(right_buf, x, y, r, g, b)

    # 2. Concentric Contour Mound (Hill with contour terraces: Z = 10m, 20m, 30m)
    hill_cx, hill_cy = 280, 320
    draw_filled_circle(hill_cx, hill_cy, 180, 10, 80, 120, 75, (110, 150, 100))
    draw_filled_circle(hill_cx, hill_cy, 120, 20, 95, 135, 85, (130, 170, 110))
    draw_filled_circle(hill_cx, hill_cy, 60, 35, 115, 150, 95, (150, 190, 120))
    draw_crosshair_gcp(hill_cx, hill_cy, 35)

    # 3. Excavation Pit (Depression: Z = -25m)
    pit_x1, pit_y1 = 150, 700
    draw_filled_rect(pit_x1, pit_y1, pit_x1 + 220, pit_y1 + 180, -25, 40, 45, 50, (30, 35, 40))
    # Pit bottom bench
    draw_filled_rect(pit_x1 + 40, pit_y1 + 35, pit_x1 + 180, pit_y1 + 145, -40, 25, 30, 35, (20, 25, 30))
    draw_crosshair_gcp(pit_x1 + 110, pit_y1 + 90, -40)

    # 4. Building A (Commercial Complex: Z = 45m, with HVAC at Z = 52m)
    bld_a_x1, bld_a_y1 = 620, 200
    draw_filled_rect(bld_a_x1, bld_a_y1, bld_a_x1 + 260, bld_a_y1 + 200, 45, 190, 185, 175, (230, 225, 215))
    # Rooftop details (helipad circle and markings)
    draw_filled_circle(bld_a_x1 + 80, bld_a_y1 + 100, 45, 45, 160, 160, 160, (255, 215, 0))
    draw_crosshair_gcp(bld_a_x1 + 80, bld_a_y1 + 100, 45)
    # Rooftop HVAC penthouse (Z = 55m)
    draw_filled_rect(bld_a_x1 + 170, bld_a_y1 + 40, bld_a_x1 + 230, bld_a_y1 + 110, 55, 120, 130, 140, (160, 175, 190))
    draw_crosshair_gcp(bld_a_x1 + 200, bld_a_y1 + 75, 55)

    # 5. Building B (High-Rise Tower: Z = 80m, Spire at Z = 110m)
    tower_cx, tower_cy = 720, 720
    draw_filled_circle(tower_cx, tower_cy, 90, 80, 170, 195, 210, (220, 240, 255))
    # Tower inner ring
    draw_filled_circle(tower_cx, tower_cy, 50, 90, 190, 215, 230, (240, 255, 255))
    # Spire needle tip (Z = 110m)
    draw_filled_circle(tower_cx, tower_cy, 8, 110, 255, 50, 50, (255, 255, 255))
    draw_crosshair_gcp(tower_cx, tower_cy, 110)

    # 6. Ground Control Points (GCPs at Z = 0 on ground)
    draw_crosshair_gcp(100, 100, 0)
    draw_crosshair_gcp(924, 100, 0)
    draw_crosshair_gcp(100, 924, 0)
    draw_crosshair_gcp(924, 924, 0)
    draw_crosshair_gcp(512, 512, 0)

    # 7. Fiducial corner marks
    for fcx, fcy in [(20, 20), (WIDTH - 20, 20), (20, HEIGHT - 20), (WIDTH - 20, HEIGHT - 20)]:
        draw_crosshair_gcp(fcx, fcy, 0)

    left_path = os.path.join(output_dir, "left.png")
    right_path = os.path.join(output_dir, "right.png")

    print(f"Generating calibrated stereo pair ({WIDTH}x{HEIGHT})...")
    write_png(left_path, WIDTH, HEIGHT, left_buf)
    write_png(right_path, WIDTH, HEIGHT, right_buf)
    print(f"  [OK] Left image  -> {left_path}")
    print(f"  [OK] Right image -> {right_path}")

if __name__ == "__main__":
    create_stereo_pair()
