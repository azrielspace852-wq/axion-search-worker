#!/bin/bash

# =====================================
#    CYBER LEARNER TOOLKIT v2.0
#    Gabungan 3 Tools Port Scanner
#    Untuk Termux
# =====================================

# ⚠️ PERINGATAN PENTING ⚠️
# Tools ini HANYA untuk pembelajaran dan testing di jaringan sendiri!
# Penggunaan tanpa izin pada jaringan orang lain adalah ILEGAL!
# Bertanggung jawablah dalam menggunakan tools ini.

# Warna untuk tampilan
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Fungsi untuk menampilkan banner
show_banner() {
    clear
    echo -e "${RED}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${RED}║${NC} ${CYAN}    CYBER LEARNER TOOLKIT v2.0${NC}        ${RED}║${NC}"
    echo -e "${RED}╠═══════════════════════════════════════════╣${NC}"
    echo -e "${RED}║${NC} ${YELLOW}    Gabungan 3 Tools Port Scanner${NC}      ${RED}║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${RED}⚠️  PERINGATAN ETIS ⚠️${NC}"
    echo -e "${YELLOW}• Tools ini HANYA untuk pembelajaran${NC}"
    echo -e "${YELLOW}• Hanya gunakan di JARINGAN SENDIRI${NC}"
    echo -e "${YELLOW}• Scan tanpa izin adalah TINDAKAN ILEGAL${NC}"
    echo -e "${YELLOW}• Gunakan dengan TANGGUNG JAWAB${NC}"
    echo ""
}

# Fungsi konfirmasi etis sebelum scan
ethical_confirm() {
    local target=$1
    echo -e "${RED}════════════════════════════════════════════${NC}"
    echo -e "${RED}⚠️  KONFIRMASI ETIS ⚠️${NC}"
    echo -e "${YELLOW}Anda akan melakukan scan pada: ${GREEN}$target${NC}"
    echo ""
    echo -e "${YELLOW}Pastikan:${NC}"
    echo "1. Anda memiliki izin untuk melakukan scan"
    echo "2. Ini adalah jaringan/device milik Anda sendiri"
    echo "3. Anda menggunakan untuk tujuan pembelajaran"
    echo ""
    read -p "Apakah Anda yakin ingin melanjutkan? (y/n): " confirm
    
    if [[ "$confirm" != "y" ]] && [[ "$confirm" != "Y" ]]; then
        echo -e "${GREEN}[+] Scan dibatalkan.${NC}"
        return 1
    fi
    return 0
}

# Fungsi Cek IP (dari cekip.sh)
cekip() {
    echo -e "${BLUE}[+] Informasi IP Anda:${NC}"
    echo ""
    echo -e "${GREEN}IP Publik:${NC} $(curl -s ifconfig.me)"
    echo -e "${GREEN}IP Lokal:${NC} $(hostname -I | awk '{print $1}')"
    echo -e "${GREEN}Hostname:${NC} $(hostname)"
    echo ""
    echo -e "${YELLOW}Informasi Network:${NC}"
    ip addr show | grep -E "inet " | grep -v "127.0.0.1"
    echo ""
    read -p "Tekan Enter untuk kembali..."
}

# Fungsi Scan Port dengan Python (dari scanner.py)
scan_python() {
    echo -e "${BLUE}[+] Menggunakan Python Port Scanner${NC}"
    echo ""
    read -p "Masukkan IP target: " target
    
    if [[ -z "$target" ]]; then
        echo -e "${RED}[!] IP tidak boleh kosong!${NC}"
        read -p "Tekan Enter untuk kembali..."
        return
    fi
    
    # Konfirmasi etis
    if ! ethical_confirm "$target"; then
        read -p "Tekan Enter untuk kembali..."
        return
    fi
    
    echo -e "${GREEN}[+] Target: $target${NC}"
    echo -e "${YELLOW}[+] Scanning port 1-1024...${NC}"
    echo ""
    
    # Buat script python temporary
    cat > /tmp/scanner_temp.py << 'EOF'
import socket
import sys
from datetime import datetime

target = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"

print("=" * 40)
print("    PYTHON PORT SCANNER")
print("=" * 40)
print(f"\n[+] Target: {target}")
print(f"[+] Waktu mulai: {datetime.now()}\n")

try:
    open_ports = []
    for port in range(1, 1025):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.5)
        result = sock.connect_ex((target, port))
        if result == 0:
            print(f"  [OPEN] Port {port}")
            open_ports.append(port)
        sock.close()
    
    print(f"\n[+] Total port terbuka: {len(open_ports)}")
    print(f"[+] Selesai: {datetime.now()}")
    
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
EOF
    
    python3 /tmp/scanner_temp.py "$target"
    rm /tmp/scanner_temp.py
    
    echo ""
    echo -e "${YELLOW}[!] Ingat: Scan hanya untuk tujuan pembelajaran!${NC}"
    read -p "Tekan Enter untuk kembali..."
}

# Fungsi Scan Port dengan Bash (dari portscanner.sh)
scan_bash() {
    echo -e "${BLUE}[+] Menggunakan Bash Port Scanner${NC}"
    echo ""
    read -p "Masukkan IP target: " target_ip
    
    if [[ -z "$target_ip" ]]; then
        echo -e "${RED}[!] IP tidak boleh kosong!${NC}"
        read -p "Tekan Enter untuk kembali..."
        return
    fi
    
    # Konfirmasi etis
    if ! ethical_confirm "$target_ip"; then
        read -p "Tekan Enter untuk kembali..."
        return
    fi
    
    read -p "Port awal (default 1): " start_port
    start_port=${start_port:-1}
    
    read -p "Port akhir (default 1024): " end_port
    end_port=${end_port:-1024}
    
    echo ""
    echo -e "${GREEN}[+] Scanning $target_ip dari port $start_port sampai $end_port...${NC}"
    echo ""
    
    # Scan dengan bash
    for port in $(seq $start_port $end_port); do
        timeout 1 bash -c "echo > /dev/tcp/$target_ip/$port" 2>/dev/null && echo -e "${GREEN}  [OPEN] Port $port${NC}" &
    done
    
    wait
    echo ""
    echo -e "${YELLOW}[+] Scan selesai!${NC}"
    echo -e "${YELLOW}[!] Ingat: Scan hanya untuk tujuan pembelajaran!${NC}"
    echo ""
    read -p "Tekan Enter untuk kembali..."
}

# Fungsi Scan dengan Nmap
scan_nmap() {
    echo -e "${BLUE}[+] Menggunakan Nmap Scanner${NC}"
    echo ""
    
    # Cek apakah nmap terinstall
    if ! command -v nmap &> /dev/null; then
        echo -e "${RED}[!] Nmap tidak terinstall!${NC}"
        echo -e "${YELLOW}[+] Install dengan: pkg install nmap${NC}"
        read -p "Tekan Enter untuk kembali..."
        return
    fi
    
    echo "1. Scan Localhost (127.0.0.1) - AMAN"
    echo "2. Scan Custom IP"
    echo "3. Scan dengan port tertentu"
    echo ""
    read -p "Pilih [1-3]: " nmap_choice
    
    case $nmap_choice in
        1)
            echo -e "${GREEN}[+] Scanning localhost (jaringan sendiri)...${NC}"
            nmap 127.0.0.1
            ;;
        2)
            read -p "Masukkan IP: " ip
            if [[ -z "$ip" ]]; then
                echo -e "${RED}[!] IP tidak boleh kosong!${NC}"
            else
                if ethical_confirm "$ip"; then
                    echo -e "${GREEN}[+] Scanning $ip...${NC}"
                    nmap -F $ip
                fi
            fi
            ;;
        3)
            read -p "Masukkan IP: " ip
            read -p "Masukkan port (contoh: 80,443 atau 1-1000): " ports
            if [[ -z "$ip" ]] || [[ -z "$ports" ]]; then
                echo -e "${RED}[!] IP dan port harus diisi!${NC}"
            else
                if ethical_confirm "$ip"; then
                    echo -e "${GREEN}[+] Scanning $ip pada port $ports...${NC}"
                    nmap -p $ports $ip
                fi
            fi
            ;;
        *)
            echo -e "${RED}[!] Pilihan salah!${NC}"
            ;;
    esac
    
    echo ""
    read -p "Tekan Enter untuk kembali..."
}

# Fungsi Info Target (dari cyber-tool.sh)
info_target() {
    echo -e "${BLUE}[+] Informasi Target${NC}"
    echo ""
    echo -e "${YELLOW}[!] Ini hanya informasi publik, bukan scan aktif${NC}"
    echo ""
    read -p "Masukkan IP/Domain: " ip
    
    if [[ -z "$ip" ]]; then
        echo -e "${RED}[!] IP/Domain tidak boleh kosong!${NC}"
        read -p "Tekan Enter untuk kembali..."
        return
    fi
    
    echo -e "${GREEN}[+] Mengambil informasi publik untuk: $ip${NC}"
    echo ""
    
    # Cek apakah curl terinstall
    if ! command -v curl &> /dev/null; then
        echo -e "${RED}[!] Curl tidak terinstall!${NC}"
        echo -e "${YELLOW}[+] Install dengan: pkg install curl${NC}"
        read -p "Tekan Enter untuk kembali..."
        return
    fi
    
    echo -e "${CYAN}Informasi dari ipinfo.io:${NC}"
    curl -s ipinfo.io/$ip | jq '.' 2>/dev/null || curl -s ipinfo.io/$ip
    
    echo ""
    read -p "Tekan Enter untuk kembali..."
}

# Fungsi untuk mengecek dan install dependensi
check_dependencies() {
    local deps=("python3" "curl")
    local missing=()
    
    for dep in "${deps[@]}"; do
        if ! command -v $dep &> /dev/null; then
            missing+=($dep)
        fi
    done
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        echo -e "${YELLOW}[!] Beberapa dependensi belum terinstall:${NC}"
        for dep in "${missing[@]}"; do
            echo -e "  - $dep"
        done
        echo ""
        read -p "Ingin install sekarang? (y/n): " install_choice
        if [[ "$install_choice" == "y" ]] || [[ "$install_choice" == "Y" ]]; then
            pkg update && pkg upgrade -y
            for dep in "${missing[@]}"; do
                pkg install $dep -y
            done
            echo -e "${GREEN}[+] Dependensi berhasil diinstall!${NC}"
        else
            echo -e "${YELLOW}[!] Beberapa fitur mungkin tidak berjalan optimal${NC}"
        fi
        sleep 2
    fi
}

# Fungsi tentang etika
show_ethics() {
    echo -e "${RED}════════════════════════════════════════════${NC}"
    echo -e "${RED}    ETIKA PENGGUNAAN TOOLS KEAMANAN${NC}"
    echo -e "${RED}════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${YELLOW}1. HANYA GUNAKAN DI JARINGAN SENDIRI${NC}"
    echo "   - Localhost (127.0.0.1)"
    echo "   - Jaringan WiFi rumah sendiri"
    echo "   - Server yang Anda kelola"
    echo ""
    echo -e "${YELLOW}2. MINTA IZIN${NC}"
    echo "   - Dapatkan izin tertulis sebelum scan"
    echo "   - Hormati privasi orang lain"
    echo ""
    echo -e "${YELLOW}3. TUJUAN PEMBELAJARAN${NC}"
    echo "   - Gunakan untuk belajar keamanan"
    echo "   - Jangan untuk merusak atau mencuri"
    echo ""
    echo -e "${YELLOW}4. KONSEKUENSI HUKUM${NC}"
    echo -e "${RED}   - Scan tanpa izin = TINDAK PIDANA${NC}"
    echo -e "${RED}   - Dapat dipenjara dan didenda${NC}"
    echo -e "${RED}   - Melanggar UU ITE${NC}"
    echo ""
    echo -e "${GREEN}Ingat: Dengan kekuatan besar, datang tanggung jawab besar!${NC}"
    echo -e "${GREEN}Gunakan tools ini dengan bijak!${NC}"
    echo ""
    read -p "Tekan Enter untuk kembali..."
}

# Menu Utama
main_menu() {
    while true; do
        show_banner
        echo -e "${YELLOW}=== MENU UTAMA ===${NC}"
        echo ""
        echo "1. Cek IP (Informasi Network)"
        echo "2. Scan Port dengan Python (1-1024)"
        echo "3. Scan Port dengan Bash (Custom Range)"
        echo "4. Scan Port dengan Nmap"
        echo "5. Info Target (IP/Domain) - Publik"
        echo "6. Install Dependensi"
        echo "7. 📖 Etika Penggunaan"
        echo "8. Keluar"
        echo ""
        read -p "Pilih [1-8]: " choice
        
        case $choice in
            1)
                cekip
                ;;
            2)
                scan_python
                ;;
            3)
                scan_bash
                ;;
            4)
                scan_nmap
                ;;
            5)
                info_target
                ;;
            6)
                check_dependencies
                ;;
            7)
                show_ethics
                ;;
            8)
                echo -e "${GREEN}════════════════════════════════════════════${NC}"
                echo -e "${GREEN}    Terima kasih telah menggunakan!${NC}"
                echo -e "${GREEN}    Gunakan tools ini dengan bijak!${NC}"
                echo -e "${GREEN}════════════════════════════════════════════${NC}"
                echo "Keluar..."
                exit 0
                ;;
            *)
                echo -e "${RED}[!] Pilihan tidak valid!${NC}"
                sleep 1
                ;;
        esac
    done
}

# Jalankan script
main_menu