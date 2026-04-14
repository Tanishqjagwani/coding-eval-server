#!/bin/bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────
# Oracle Cloud ARM VM — One-time Setup for Coolify + Docker
# ─────────────────────────────────────────────────────────────────
#
# Prerequisites:
#   1. Oracle Cloud account (Always Free tier)
#   2. ARM VM created: VM.Standard.A1.Flex, 4 OCPU, 24 GB RAM, Ubuntu 22.04
#   3. SSH access to the VM
#   4. Oracle VCN security list: open ports 80, 443, 4001, 8000
#
# Usage:
#   ssh ubuntu@<VM_IP> 'bash -s' < setup-oracle-vm.sh
#
# ─────────────────────────────────────────────────────────────────

echo "══════════════════════════════════════════════════════════"
echo "  CodingEvalServer — Oracle VM Bootstrap"
echo "══════════════════════════════════════════════════════════"

# ── 1. System updates ─────────────────────────────────────────
echo ""
echo "[1/4] Updating system packages..."
sudo apt-get update && sudo apt-get upgrade -y

# ── 2. Install Docker ─────────────────────────────────────────
echo ""
echo "[2/4] Installing Docker..."
if command -v docker &>/dev/null; then
    echo "  Docker already installed: $(docker --version)"
else
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    echo "  Docker installed: $(docker --version)"
fi

sudo systemctl enable docker
sudo systemctl start docker

# ── 3. Open firewall ports (iptables) ─────────────────────────
echo ""
echo "[3/4] Opening firewall ports (80, 443, 4001, 8000)..."
for PORT in 80 443 4001 8000; do
    sudo iptables -I INPUT -p tcp --dport "$PORT" -j ACCEPT
done

# Persist iptables rules across reboots
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save

echo "  Firewall ports opened and persisted."
echo ""
echo "  REMINDER: Also open these ports in Oracle Cloud Console:"
echo "    Networking > Virtual Cloud Networks > your VCN >"
echo "    Security Lists > Default > Add Ingress Rules"
echo "    Ports: 80, 443, 4001, 8000 (TCP, source 0.0.0.0/0)"

# ── 4. Install Coolify ────────────────────────────────────────
echo ""
echo "[4/4] Installing Coolify..."
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Open Coolify UI: http://<VM_IP>:8000"
echo "    2. Create admin account"
echo "    3. Add GitHub repo as a new resource"
echo "    4. Set env vars: CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_MODEL"
echo "    5. Deploy — Coolify builds from root Dockerfile"
echo "    6. Verify: curl http://<VM_IP>:4001/health"
echo "══════════════════════════════════════════════════════════"
