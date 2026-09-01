# Pi PaaS — v1

PaaS auto-hébergé minimal pour Raspberry Pi 3B : importe un projet GitHub, le déploie,
et le met à jour/redéploie automatiquement (polling).

## Installation sur le Pi

```bash
# Sur le Pi, après git clone du repo pi-paas
cd pi-paas
sudo apt update
sudo apt install -y python3-pip git nodejs npm   # nodejs/npm seulement si tu déploies des projets Node
pip3 install --break-system-packages -r requirements.txt
```

## Lancer le serveur

```bash
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

L'API est accessible sur `http://<ip-du-pi>:8000`. La doc interactive Swagger
est disponible sur `http://<ip-du-pi>:8000/docs`.

## Lancer au démarrage (systemd)

Crée `/etc/systemd/system/pi-paas.service` :

```ini
[Unit]
Description=Pi PaaS
After=network.target

[Service]
WorkingDirectory=/home/pi/pi-paas
ExecStart=/usr/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

Puis :
```bash
sudo systemctl enable --now pi-paas
```

## Utilisation (via l'API, avant l'interface web)

**Ajouter un projet**
```bash
curl -X POST http://<ip-du-pi>:8000/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mon-site",
    "repo_url": "https://github.com/user/repo.git",
    "branch": "main",
    "start_command": "python3 main.py",
    "port": 8001,
    "autoupdate": true
  }'
```

**Déployer (première fois ou manuellement)**
```bash
curl -X POST http://<ip-du-pi>:8000/projects/1/deploy
```

**Voir les logs**
```bash
curl http://<ip-du-pi>:8000/projects/1/logs
```

**Arrêter**
```bash
curl -X POST http://<ip-du-pi>:8000/projects/1/stop
```

**Supprimer**
```bash
curl -X DELETE http://<ip-du-pi>:8000/projects/1
```

**Gérer les variables d'environnement**
```bash
# Voir les variables actuelles
curl http://<ip-du-pi>:8000/projects/1/env

# Remplacer toutes les variables (envoie l'ensemble complet à chaque fois)
curl -X PUT http://<ip-du-pi>:8000/projects/1/env \
  -H "Content-Type: application/json" \
  -d '{"env_vars": {"API_KEY": "abc123", "DEBUG": "false"}}'
```
Les variables sont injectées au process au moment du lancement (`deploy` manuel ou
redéploiement automatique) — pense à redéployer après une modification pour
qu'elles prennent effet.

## Comment fonctionne l'auto-update

Toutes les `PI_PAAS_POLL_INTERVAL` secondes (60 par défaut), le serveur compare le
dernier commit distant du repo au dernier commit connu localement. S'il y a une
différence : arrêt du process, `git pull`, réinstallation des dépendances si besoin,
relance automatique.

## Limites de cette v1 (à améliorer ensuite)

- Pas d'authentification sur l'API (à ajouter avant d'exposer le Pi publiquement)
- Pas d'interface web (prochaine étape)
- Détection des dépendances basique (requirements.txt ou package.json seulement)
- Pas de gestion des repos privés (nécessitera un token GitHub dans l'URL ou SSH)
- Pas de reverse proxy (chaque projet reste sur son port, ex: `<ip-du-pi>:8001`)
