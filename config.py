import os

# Dossier où sont clonés tous les projets déployés
APPS_DIR = os.environ.get("PI_PAAS_APPS_DIR", "/opt/pi-paas/apps")

# Dossier où sont stockés les logs de chaque projet
LOGS_DIR = os.environ.get("PI_PAAS_LOGS_DIR", "/opt/pi-paas/logs")

# Fichier base de données SQLite
DB_PATH = os.environ.get("PI_PAAS_DB_PATH", "/opt/pi-paas/pi-paas.db")

# Intervalle entre deux vérifications de mise à jour (en secondes)
POLL_INTERVAL_SECONDS = int(os.environ.get("PI_PAAS_POLL_INTERVAL", "60"))

os.makedirs(APPS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
