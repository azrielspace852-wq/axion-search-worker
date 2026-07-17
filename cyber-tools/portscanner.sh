#!/bin/bash

# SIMPLE PORT SCANNER - Buat belajar

echo "================================"
echo "    SIMPLE PORT SCANNER"
echo "================================"
echo ""

# Minta input IP
read -p "Masukkan IP target: " target_ip

# Minta range port
read -p "Port awal (default 1): " start_port
start_port=${start_port:-1}

read -p "Port akhir (default 1024): " end_port
end_port=${end_port:-1024}

echo ""
echo "[+] Scanning $target_ip dari port $start_port sampai $end_port..."
echo ""

# Loop scan
for port in $(seq $start_port $end_port); do
    # Coba konek ke port
    timeout 1 bash -c "echo > /dev/tcp/$target_ip/$port" 2>/dev/null && echo "  [OPEN] Port $port" &
done

wait
echo ""
echo "[+] Scan selesai!"
echo "================================"