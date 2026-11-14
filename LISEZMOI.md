# GoatHub

Plateforme de communication complète, inspirée de Discord : serveurs, salons textuels et vocaux, messages privés, appels, partage d'écran, rôles et modération.

- **Interface** : React + Tailwind CSS (Vite)
- **Serveur** : Node.js (Fastify + Socket.IO / WebSockets), TypeScript
- **Base de données** : PostgreSQL
- **Vocal / vidéo / partage d'écran** : WebRTC avec le serveur vocal **LiveKit** (SFU)
- **Mise en ligne** : Docker Compose, avec HTTPS automatique (Caddy) et sauvegardes chiffrées

## Essayer GoatHub sur ton ordinateur (le plus simple)

1. Installe **Docker Desktop** : https://www.docker.com/products/docker-desktop/. Ouvre-le et attends qu'il affiche « Engine running ».
2. Télécharge le code : sur la page GitHub, bouton vert **Code**, puis **Download ZIP**. Décompresse-le.
3. **Windows** : double-clique sur **`lancer.bat`**. **Mac / Linux** : lance `./lancer.sh` dans un terminal.
4. La première fois, patiente quelques minutes. Ensuite, GoatHub s'ouvre tout seul sur **http://localhost:3000**.

Pour l'arrêter : **`arreter.bat`** (Windows), ou `docker compose -f docker-compose.local.yml stop`. Tes comptes et messages sont conservés.

Pour tester à plusieurs sur un seul ordinateur, ouvre une fenêtre de navigation privée et crée un deuxième compte.

## Fonctionnalités

| | |
| --- | --- |
| **Comptes** | Inscription et connexion sécurisées, double authentification (2FA), photo de profil, statut (en ligne, absent, occupé, invisible), statut personnalisé, amis et demandes d'ami, blocage |
| **Serveurs** | Création, icône, liens d'invitation (avec expiration et nombre d'utilisations), rejoindre et quitter, catégories, transfert de propriété |
| **Rôles** | Rôles personnalisés (nom, couleur, 16 permissions), hiérarchie des rôles, affichage séparé dans la liste des membres |
| **Salons textuels** | Messages en temps réel, mise en forme (gras, code, spoiler…), mentions avec suggestions, réponses, réactions, modification, suppression, épingles, photos, vidéos et fichiers (glisser-déposer, coller), historique complet, « est en train d'écrire », non-lus et mentions, mode lent |
| **Salons vocaux** | Audio à plusieurs via LiveKit, micro et casque, volume de chaque personne (jusqu'à 200 %), indicateur lumineux quand quelqu'un parle, choix du micro et des haut-parleurs, test du micro, réduction de bruit, nombre de places limité, permissions (se connecter, parler, partager) |
| **Partage d'écran** | Écran entier, fenêtre ou onglet (avec le son), regarder en grand, caméra |
| **Messages privés** | Conversations à deux et groupes (jusqu'à 10), notifications, fichiers et images, indicateur de saisie |
| **Appels** | Appels entre amis et de groupe, sonnerie, accepter, refuser, raccrocher, durée de l'appel dans la conversation |
| **Modération** | Expulser, bannir (avec suppression des messages récents), exclure temporairement, rendre muet en vocal, déconnecter du vocal, signalements, journal de modération, anti-spam avec exclusion automatique |

## Lancer en local (pour développer)

Il faut **Node.js 22** et **Docker**.

```bash
# 1. Base de données et serveur vocal
docker run -d --name gh-pg -p 5432:5432 -e POSTGRES_USER=goathub -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=goathub postgres:16-alpine
docker run -d --name gh-lk --network host -v "$PWD/dev/livekit.yaml:/livekit.yaml" livekit/livekit-server:v1.9 --config /livekit.yaml

# 2. Dépendances
npm install

# 3. Serveur (dans un terminal) puis interface (dans un autre)
cp .env.dev.example .env.dev   # puis vérifie les valeurs
set -a; . ./.env.dev; set +a; npm run dev:server
npm run dev:client             # ouvre http://localhost:5173
```

Dans `dev/livekit.yaml`, remplace `node_ip` par l'adresse IP de ton ordinateur sur le réseau, sinon le son ne passera pas.

## Mettre en ligne

Le vocal (LiveKit) a besoin de ports UDP. Il faut donc un **serveur loué (VPS)** : la plupart des hébergeurs « simples » comme Render ne les ouvrent pas.

### Option A : un serveur loué (recommandé, tout compris)

**Coût** : environ 5 € par mois pour le serveur (Hetzner CX22, OVH VPS, Scaleway…), plus environ 10 € par an pour le nom de domaine.

1. **Loue un VPS** sous Ubuntu 24.04, avec au moins 2 Go de mémoire.
2. **Achète un nom de domaine** (OVH, Gandi, Namecheap…), puis crée deux enregistrements DNS de type **A** vers l'adresse IP du serveur :
   - `goathub.exemple.fr`
   - `livekit.goathub.exemple.fr`
3. **Connecte-toi au serveur** (`ssh root@ADRESSE_IP`) et installe Docker :
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
4. **Récupère le code** (`git clone` de ton dépôt, ou envoie le dossier avec `scp`), puis :
   ```bash
   cd goathub-web
   ./installer.sh
   ```
   Le script te demande le domaine et ton e-mail (tu deviendras administrateur), puis crée tous les secrets.
5. **Ouvre les ports** du pare-feu (`ufw` ou le panneau de l'hébergeur) : **80, 443** (TCP et UDP), **7881** (TCP), **3478** (UDP) et **50000 à 50100** (UDP).
6. **Démarre** :
   ```bash
   docker compose up -d --build
   ```
   Après une à deux minutes, ton site est en ligne sur `https://goathub.exemple.fr`, avec un certificat HTTPS automatique.

**Mettre à jour** plus tard : `git pull`, puis `docker compose up -d --build`. Les données sont conservées.

**Important** : garde une copie du fichier `.env` en lieu sûr. `APP_SECRET` chiffre les e-mails et les secrets 2FA, et `BACKUP_PASSPHRASE` chiffre les sauvegardes. Sans eux, les données et les sauvegardes deviennent illisibles.

### Option B : sans gérer de serveur (Render + LiveKit Cloud)

- **Vocal** : crée un compte sur https://cloud.livekit.io (offre gratuite pour commencer). Il te donne une adresse `wss://…livekit.cloud`, une clé API et un secret.
- **Site** : sur Render, crée un service **Web (Docker)** à partir de ce dépôt, une base **PostgreSQL**, et un disque monté sur `/data`. Remplis les variables :
  - `DATABASE_URL`
  - `APP_SECRET` (au moins 32 caractères au hasard)
  - `PUBLIC_URL` (l'adresse du site)
  - `LIVEKIT_URL` (`https://…livekit.cloud`)
  - `LIVEKIT_PUBLIC_URL` (`wss://…livekit.cloud`)
  - `LIVEKIT_API_KEY` et `LIVEKIT_API_SECRET`
  - `TRUST_PROXY=1` et `FORCE_HTTPS=1`
- Coût : environ 7 $ pour le site + 7 $ pour la base par mois. Cette option n'a pas été testée chez Render.

## Réglages (variables d'environnement)

| Variable | Rôle |
| --- | --- |
| `SIGNUP_CODE` | Si rempli, ce code est obligatoire pour s'inscrire (site réservé à tes amis) |
| `ADMIN_EMAILS` | E-mails des administrateurs du site (signalements de tout le site) |
| `ALERT_WEBHOOK` | Adresse qui reçoit les alertes de sécurité (webhook Discord, Slack, ou `https://ntfy.sh/ton-sujet-secret` pour ton téléphone) |
| `MAX_UPLOAD_MB` | Taille maximale d'un fichier (25 Mo par défaut) |
| `SIGNUPS_PER_HOUR` | Inscriptions maximum par adresse IP et par heure (5 par défaut) |

## Sauvegardes

Le service `backup` sauvegarde chaque nuit la base et les fichiers dans `backups/`. Les sauvegardes sont chiffrées en AES-256, et celles de plus de 14 jours sont effacées. Pense à copier régulièrement ce dossier ailleurs (sur ton ordinateur, par exemple).

**Restaurer la base**, serveur arrêté (`docker compose stop app`) :

```bash
set -a; . ./.env; set +a
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in backups/goathub-AAAAMMJJ-HHMM.sql.gz.enc \
  | gunzip | docker compose exec -T postgres psql -U goathub -d goathub
```

## Organisation du code

```
server/src/
  index.ts              démarrage (Fastify + Socket.IO)
  config.ts             réglages vérifiés au démarrage
  db/                   PostgreSQL : connexion, migrations (schéma dans migrations/001_init.sql)
  http/                 inscription/connexion/2FA, fichiers, invitations, webhook LiveKit, protections HTTP
  realtime/             temps réel : socket.ts (connexion), registry.ts (validation), handlers/ (toutes les actions)
  services/             permissions, accès aux salons, présence, LiveKit, état vocal
  security/             chiffrement, Argon2id, TOTP, limiteurs, journal de sécurité
client/src/
  App.tsx, components/  interface React (layout, chat, voice, modals, settings)
  lib/                  état (zustand), connexion temps réel, permissions, mise en forme
  voice/voice.ts        moteur vocal LiveKit (micro, casque, volumes, appareils, écran)
```

Rapport de sécurité : voir **SECURITE.md**.
