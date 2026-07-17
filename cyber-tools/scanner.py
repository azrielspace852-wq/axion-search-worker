#!/usr/bin/env python3

import socket
import sys
from datetime import datetime

print("=" * 40)
print("    PYTHON PORT SCANNER")
print("=" * 40)

# Input target
target = input("Masukkan IP target: ")
print(f"\n[+] Target: {target}")
print(f"[+] Waktu mulai: {datetime.now()}\n")

try:
    # Scan port 1-1024
    for port in range(1, 1025):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        
        result = sock.connect_ex((target, port))
        
        if result == 0:
            print(f"  [OPEN] Port {port}")
        
        sock.close()
    
    print(f"\n[+] Selesai: {datetime.now()}")
    
except KeyboardInterrupt:
    print("\n[!] Scanning dihentikan user")
    sys.exit()
    
except socket.gaierror:
    print("[!] Hostname tidak valid")
    sys.exit()
    
except socket.error:
    print("[!] Gagal konek ke server")
    sys.exit()

print("=" * 40)