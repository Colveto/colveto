#!/usr/bin/env bash
# ===================================================================
# Vet Clinic Server - VPS deployment script
# Tested on Ubuntu 22.04 LTS and 24.04 LTS
#
# Usage (run as root or with sudo, FROM the directory containing this
# script and the other deploy files):
#
#   chmod +x deploy.sh
#   sudo DOMAIN=rdv.moncabinet.lu ./deploy.sh
#
# DOMAIN = le nom de domaine qui pointera vers ce serveur (HTTPS automatique).
# Avant de lancer : « npm install && npm run build » à la racine du projet,
# puis copier le dossier dist/ obtenu dans server-deploy/dist/.
# ===================================================================

set -e

if [ "$EUID" -ne 0 ]; then
  echo "Ce script doit être exécuté en root (sudo ./deploy.sh)"
  exit 1
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [ -z "$DOMAIN" ]; then
  echo "Indiquez le nom de domaine : sudo DOMAIN=rdv.moncabinet.lu ./deploy.sh"
  exit 1
fi
if [ ! -f "$SCRIPT_DIR/dist/index.html" ]; then
  echo "Interface introuvable : lancez « npm run build » à la racine du projet,"
  echo "puis copiez le dossier dist/ dans server-deploy/dist/."
  exit 1
fi
APP_DIR=/opt/vet-clinic
DATA_DIR=/var/lib/vet-clinic
LOG_DIR=/var/log/vet-clinic
APP_USER=vetapp

echo "===================================="
echo "  Vet Clinic Server — Installation"
echo "===================================="

# ----- 1. System update -----
echo ""
echo "[1/8] Mise à jour du système..."
apt-get update -qq
apt-get upgrade -y -qq

# ----- 2. Install Node.js 22 LTS via NodeSource -----
echo ""
echo "[2/8] Installation de Node.js 22 LTS..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js: $(node -v)"
echo "npm:     $(npm -v)"

# ----- 3. Install build tools (for better-sqlite3 native compilation if needed) -----
echo ""
echo "[3/8] Installation des outils de compilation..."
apt-get install -y -qq build-essential python3 ufw

# ----- 4. Install Caddy (automatic HTTPS reverse proxy) -----
echo ""
echo "[4/8] Installation de Caddy..."
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
    gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
    tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
fi

# ----- 5. Create app user & directories -----
echo ""
echo "[5/8] Création de l'utilisateur applicatif et des dossiers..."
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$APP_DIR" "$DATA_DIR" "$LOG_DIR" /var/log/caddy

# ----- 6. Copy application files -----
echo ""
echo "[6/8] Copie des fichiers de l'application vers $APP_DIR..."
cp "$SCRIPT_DIR"/*.js "$APP_DIR/"
cp "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/package-lock.json" "$APP_DIR/"
rm -rf "$APP_DIR/public" "$APP_DIR/dist"
cp -R "$SCRIPT_DIR/public" "$SCRIPT_DIR/dist" "$APP_DIR/"

cd "$APP_DIR"
echo "Installation des dépendances Node.js..."
sudo -u "$APP_USER" -H npm install --omit=dev --no-audit --no-fund

chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR" "$LOG_DIR"

# ----- 7. Install systemd service -----
echo ""
echo "[7/8] Configuration du service systemd..."
cp "$SCRIPT_DIR/vet-clinic.service" /etc/systemd/system/vet-clinic.service
systemctl daemon-reload
systemctl enable vet-clinic
systemctl restart vet-clinic
sleep 2
systemctl status vet-clinic --no-pager -l | head -15

# ----- 8. Configure Caddy reverse proxy -----
echo ""
echo "[8/8] Configuration de Caddy (HTTPS automatique)..."
sed -E "s#^[a-z0-9.-]+ \{#${DOMAIN} {#; s#/var/log/caddy/[^ ]+\.log#/var/log/caddy/${DOMAIN}.log#" \
  "$SCRIPT_DIR/Caddyfile" > /etc/caddy/Caddyfile
systemctl restart caddy
sleep 2
systemctl status caddy --no-pager -l | head -10

# ----- Firewall -----
echo ""
echo "Configuration du pare-feu..."
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Let'"'"'s Encrypt + redirect)'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

echo ""
echo "===================================="
echo "  ✓ Installation terminée"
echo "===================================="
echo ""
echo "Vérifiez :"
echo "  - L'API tourne : curl http://localhost:3737/api/ping"
echo "  - Logs serveur : journalctl -u vet-clinic -f"
echo "  - Logs Caddy   : journalctl -u caddy -f"
echo ""
echo "Étapes suivantes :"
echo "  1. Configurez le DNS : $DOMAIN A <IP-de-ce-VPS>"
echo "  2. Attendez ~5 min de propagation DNS"
echo "  3. Testez : https://$DOMAIN/api/ping"
echo "  5. Ouvrez https://$DOMAIN/app/ pour créer le compte administrateur"
if [ -f "$DATA_DIR/setup-code.txt" ]; then
  echo ""
  echo "  🔑 Code d'installation (demandé à la création du compte administrateur) :"
  echo "        $(cat "$DATA_DIR/setup-code.txt")"
  echo "     (à retrouver plus tard avec : cat $DATA_DIR/setup-code.txt)"
fi
echo "  4. Caddy obtiendra automatiquement le certificat HTTPS Let's Encrypt"
echo ""
echo "Pour migrer une base existante :"
echo "  scp votre-fichier.db root@<IP-VPS>:$DATA_DIR/vet-clinic.db"
echo "  systemctl restart vet-clinic"
echo "  chown $APP_USER:$APP_USER $DATA_DIR/vet-clinic.db"
echo ""
