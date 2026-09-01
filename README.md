# Pi PaaS — v1

PaaS auto-hébergé minimal pour Raspberry Pi 3B : importe un projet GitHub, le déploie,
et le met à jour/redéploie automatiquement (polling).

## Architecture réseau (important)

Il y a **deux processus séparés**, sur deux ports différents :

| Processus | Port par défaut | Rôle | Exposé à ngrok ? |
|---|---|---|---|
| `app.main` (API + dashboard) | 8000 | Créer/déployer/gérer les projets | **Non — jamais** |
| `app.proxy` (reverse proxy) | 80 | Relaie le trafic public vers le projet actuellement "exposé" | **Oui, c'est le seul port à pointer** |

Le proxy ne fait que passer les octets TCP vers `127.0.0.1:<port>` du projet
marqué comme exposé (un seul à la fois) — c'est totalement indépendant de
l'API d'admin. Ainsi, `ngrok http 80` (ou tout autre tunnel) ne montre jamais
ton dashboard ni les endpoints d'admin aux visiteurs : ils ne voient que le
site du projet exposé. Si aucun projet n'est exposé (ou que celui exposé est
arrêté/planté), le proxy répond simplement 503/502 au lieu de router vers du
vide.

Pour administrer le Pi (dashboard, API), connecte-toi en local sur le réseau
du Pi (`http://<ip-du-pi>:8000`) ou via SSH/VPN — ne mets jamais 8000 derrière
ngrok.

## Installation sur le Pi

```bash
# Sur le Pi, après git clone du repo pi-paas
cd pi-paas
sudo apt update
sudo apt install -y python3-pip git nodejs npm   # nodejs/npm seulement si tu déploies des projets Node
pip3 install --break-system-packages -r requirements.txt
```

## Lancer les deux processus

```bash
# 1. L'API d'admin (à garder sur le réseau local uniquement)
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 2. Le reverse proxy public (nécessite les droits root pour le port 80)
sudo python3 -m app.proxy
```

L'API est accessible sur `http://<ip-du-pi>:8000` (doc Swagger sur
`http://<ip-du-pi>:8000/docs`). Le proxy public écoute sur le port 80 (ou
`PI_PAAS_PROXY_PORT` si tu veux un autre port, ex. pour lancer sans root).

## Lancer au démarrage (systemd)

Crée `/etc/systemd/system/pi-paas.service` (l'API d'admin) :

```ini
[Unit]
Description=Pi PaaS - API admin
After=network.target

[Service]
WorkingDirectory=/home/pi/pi-paas
ExecStart=/usr/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

Puis crée `/etc/systemd/system/pi-paas-proxy.service` (le reverse proxy public,
tourne en root car il bind le port 80) :

```ini
[Unit]
Description=Pi PaaS - Reverse proxy public
After=network.target pi-paas.service
Wants=pi-paas.service

[Service]
WorkingDirectory=/home/pi/pi-paas
ExecStart=/usr/bin/python3 -m app.proxy
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

> Si tu préfères éviter de faire tourner quoi que ce soit en root, donne plutôt
> la capacité de bind sur les ports privilégiés au binaire python :
> `sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which python3))`,
> puis mets `User=pi` dans le service proxy.

Puis :
```bash
sudo systemctl enable --now pi-paas
sudo systemctl enable --now pi-paas-proxy
```

## Configurer ngrok

Pointe ngrok **uniquement** sur le port du proxy, jamais sur celui de l'API :

```bash
ngrok http 80
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

**Exposer publiquement (le rendre accessible via le proxy sur le port 80/ngrok)**
```bash
# Le projet doit être en statut "running" (déployé) pour être exposable.
# Exposer un projet désexpose automatiquement tous les autres.
curl -X POST http://<ip-du-pi>:8000/projects/1/expose
```

**Retirer du proxy public**
```bash
curl -X POST http://<ip-du-pi>:8000/projects/1/unexpose
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

## Comment fonctionne le proxy public

`app.proxy` est un reverse proxy TCP minimal (pas de parsing HTTP, juste un
passthrough d'octets) : à chaque connexion entrante sur le port 80, il regarde
en base quel projet est marqué `exposed = 1` et `status = 'running'`, puis
relaie la connexion vers `127.0.0.1:<port du projet>`. Comme un seul projet est
exposé à la fois, il n'y a pas besoin de routage par nom de domaine/Host —
ngrok pointe vers le port 80, et le port 80 pointe toujours vers le bon projet.
Si le projet exposé s'arrête ou plante, le proxy détecte que `status` n'est
plus `running` et répond 503 au lieu de router vers un port mort.

## Limites de cette v1 (à améliorer ensuite)

- Pas d'authentification sur l'API (à ajouter avant d'exposer le Pi publiquement, même en local)
- Pas d'interface web servie automatiquement (le dashboard `app.html`/`dashboard.jsx` se lance à part)
- Détection des dépendances basique (requirements.txt ou package.json seulement)
- Pas de gestion des repos privés (nécessitera un token GitHub dans l'URL ou SSH)
- Le proxy public ne gère qu'un seul projet exposé à la fois (pas de routage multi-domaine) et lit la base SQLite de façon synchrone à chaque connexion — largement suffisant pour un usage perso sur Pi, mais à revoir si le trafic grossit
