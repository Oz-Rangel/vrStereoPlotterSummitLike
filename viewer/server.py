#!/usr/bin/env python3
"""
High-Performance HTTPS & HTTP Development Server for Meta Quest 2 WebXR.

Meta Quest Browser requires HTTPS (Secure Context) to enable WebXR ('Enter VR' button).
This script automatically generates a local self-signed certificate if needed
and starts a multi-threaded server.
"""

import argparse
import http.server
import os
import socket
import ssl
import subprocess
import sys

def get_local_ip():
    """Detects the primary local LAN IP address of this computer."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Doesn't need to be reachable, just used to detect the default outgoing interface
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

def ensure_ssl_certificates(cert_file="cert.pem", key_file="key.pem"):
    """Generates self-signed SSL certificate and private key using openssl if missing."""
    if os.path.exists(cert_file) and os.path.exists(key_file):
        return True

    print("[*] Generating self-signed SSL certificate for WebXR secure context...")
    try:
        cmd = [
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", key_file,
            "-out", cert_file,
            "-days", "365",
            "-nodes",
            "-subj", "/CN=QuestWebXR/O=Photogrammetry/C=US"
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[+] SSL certificate generated: {cert_file}, {key_file}")
        return True
    except Exception as e:
        print(f"[!] Warning: Could not generate SSL certificate ({e}).")
        print("[!] Falling back to plain HTTP. Note: WebXR may require https:// on Quest 2.")
        return False

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Adds CORS and cache-control headers for smooth WebXR asset loading."""
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

def run_server(port=8000, use_https=True):
    # Change working directory to the directory containing index.html
    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)

    # Ensure sample assets exist
    left_img = os.path.join(base_dir, "assets", "left.png")
    right_img = os.path.join(base_dir, "assets", "right.png")
    if not os.path.exists(left_img) or not os.path.exists(right_img):
        print("[*] Generating synthetic stereo pair assets...")
        subprocess.run([sys.executable, os.path.join(base_dir, "generate_stereo_pair.py")])

    local_ip = get_local_ip()
    protocol = "http"

    server_address = ('0.0.0.0', port)
    httpd = http.server.ThreadingHTTPServer(server_address, CORSRequestHandler)

    if use_https:
        cert_file = os.path.join(base_dir, "cert.pem")
        key_file = os.path.join(base_dir, "key.pem")
        if ensure_ssl_certificates(cert_file, key_file):
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certfile=cert_file, keyfile=key_file)
            httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
            protocol = "https"

    print("=" * 64)
    print("  QGIS VR PHOTOGRAMMETRY WORKSTATION - WEBXR DEV SERVER")
    print("=" * 64)
    print(f"  • Local Desktop:   {protocol}://localhost:{port}")
    print(f"  • Meta Quest 2:    {protocol}://{local_ip}:{port}")
    print("=" * 64)
    if protocol == "https":
        print("  INSTRUCTIONS FOR META QUEST 2:")
        print(f"  1. Put on your Quest 2 and open the 'Meta Quest Browser'.")
        print(f"  2. Type in the URL bar:  https://{local_ip}:{port}")
        print(f"  3. You will see a security warning ('Your connection is not private').")
        print(f"     Click 'Advanced' -> 'Proceed to {local_ip} (unsafe)' [Once only].")
        print(f"  4. Click the glowing [ENTER VR] button to step into the stereo model!")
    else:
        print("  NOTE: Plain HTTP mode enabled.")
        print("  If Quest Browser disables WebXR on HTTP, connect Quest via USB and run:")
        print(f"     adb reverse tcp:{port} tcp:{port}")
        print(f"  Then open: http://localhost:{port} on the Quest Browser.")
    print("=" * 64)
    print("Press Ctrl+C to stop the server.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[+] Server stopped.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WebXR Stereoplotter Dev Server")
    parser.add_argument("--port", type=int, default=8000, help="Port to serve on (default: 8000)")
    parser.add_argument("--http", action="store_true", help="Force plain HTTP instead of HTTPS")
    args = parser.parse_args()

    run_server(port=args.port, use_https=not args.http)
