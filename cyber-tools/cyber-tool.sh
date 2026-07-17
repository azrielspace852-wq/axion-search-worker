#!/bin/bash

echo "====================================="
echo "    CYBER LEARNER TOOLKIT v1.0"
echo "====================================="
echo ""
echo "1. Cek IP"
echo "2. Scan Port (Localhost)"
echo "3. Scan Port (Custom IP)"
echo "4. Info Target"
echo "5. Keluar"
echo ""
read -p "Pilih [1-5]: " choice

case $choice in
    1)
        ./cekip.sh
        ;;
    2)
        nmap 127.0.0.1
        ;;
    3)
        read -p "Masukkan IP: " ip
        nmap -F $ip
        ;;
    4)
        read -p "Masukkan IP: " ip
        curl ipinfo.io/$ip
        ;;
    5)
        echo "Keluar..."
        exit 0
        ;;
    *)
        echo "Pilihan salah!"
        ;;
esac