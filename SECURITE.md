# Rapport de sécurité de GoatHub

Audit réalisé le 14 novembre 2026, avec un test de bout en bout de **37 vérifications** dans de vrais navigateurs, sur l'image Docker de production. S'y ajoutent des tests de l'installation complète (HTTPS, PostgreSQL, LiveKit, sauvegardes) et `npm audit` : **0 vulnérabilité connue** dans les dépendances.

## Protections en place

### Contre les attaques
| Menace | Protection |
| --- | --- |
| **Injection SQL** | Toutes les requêtes PostgreSQL utilisent des paramètres (`$1`, `$2`…). Aucune donnée reçue n'est collée dans le SQL. Testé avec `' OR 1=1 --`. |
| **XSS** | React échappe tout le texte. La mise en forme des messages produit des éléments React, jamais du HTML brut. CSP stricte : seuls les scripts du site s'exécutent. Liens limités à `http(s)`. Testé avec `<script>`, `<img onerror>` et `javascript:` : affichés comme du simple texte. |
| **CSRF** | Cookie `SameSite=Strict`, contrôle de l'`Origin` / `Referer` sur chaque action, connexions WebSocket refusées depuis un autre site. |
| **Saturation, DDoS** | 600 requêtes par minute et par IP, 30 connexions temps réel par IP, connexion coupée au-delà de 120 actions en 10 s, taille des données limitée (64 Ko JSON, 100 Ko par message temps réel, 25 Mo par fichier). |
| **Spam** | 5 messages en 5 s, messages répétés bloqués, 10 mentions au maximum, mode lent par salon, exclusion automatique de 10 min après 3 avertissements. |
| **Validation** | Chaque action du serveur valide ses données avec **Zod** (type, longueur, format) avant toute utilisation. Caractères invisibles et inversions d'écriture retirés. |
| **Fichiers piégés** | Nom aléatoire (le nom envoyé est ignoré), contenu des images et vidéos vérifié, fichiers non-médias toujours téléchargés, jamais exécutés (`sandbox`). Un fichier n'est visible que par ceux qui voient le salon. |

### Comptes
- Mots de passe hachés avec **Argon2id** (recommandation OWASP) ; 8 caractères minimum, lettres et chiffres, mots de passe courants refusés.
- **Force brute** : 10 essais par IP en 10 min, 10 par compte en 15 min. Le temps de réponse est identique que le compte existe ou non.
- **Double authentification** TOTP (QR code), 10 codes de secours à usage unique, anti-rejeu des codes, 5 essais maximum.
- **Sessions** : badge de 256 bits dans un cookie `HttpOnly` + `SameSite=Strict` + `Secure`. Seule son empreinte SHA-256 est stockée. Expiration après 30 jours d'inactivité et 90 jours au maximum. Liste des appareils et déconnexion à distance ; changer le mot de passe déconnecte les autres appareils.
- **Connexion inhabituelle** (nouvel appareil ou nouveau réseau) : alerte immédiate dans les autres fenêtres, inscrite dans l'activité du compte.

### Données
- **HTTPS obligatoire** (Caddy + Let's Encrypt), redirection http → https, HSTS.
- **E-mails et secrets 2FA chiffrés** en AES-256-GCM. La base ne garde qu'une empreinte HMAC de l'e-mail pour retrouver le compte. Vérifié : aucun e-mail lisible dans PostgreSQL.
- **Aucun secret côté navigateur** : les clés LiveKit restent sur le serveur, qui délivre des jetons valables 10 minutes avec seulement les droits autorisés.
- **PostgreSQL** n'est pas exposé sur Internet, et l'application utilise son propre compte.
- **Sauvegardes** quotidiennes chiffrées (AES-256), 14 jours conservés ; déchiffrement vérifié.

### Serveur
- En-têtes : CSP, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP/CORP.
- Conteneur sans droits d'administrateur (utilisateur `goathub`), image minimale. Aucun journal des visites (moins de données personnelles).
- **Permissions vérifiées côté serveur pour chaque action**, avec hiérarchie des rôles : on ne peut agir que sur quelqu'un placé en dessous de soi, et on ne peut donner que des permissions qu'on possède. Le propriétaire est intouchable.
- **Journal de sécurité** (`/data/security.log`) et alertes par webhook. **Journal de modération** par serveur.

## Vulnérabilités et limites restantes

1. **Pas de pare-feu applicatif (WAF) ni d'anti-DDoS réseau.** Les limites intégrées arrêtent les petites attaques, pas une grosse saturation. → Mettre **Cloudflare** (gratuit) devant le site.
2. **Les messages ne sont pas chiffrés de bout en bout.** L'hébergeur ou l'administrateur pourrait les lire dans la base. Le son et la vidéo sont chiffrés pendant le transport (DTLS-SRTP), mais le serveur LiveKit les relaie en clair.
3. **Pas de vérification de l'e-mail ni de « mot de passe oublié »** : il faudrait un service d'envoi d'e-mails.
4. **Les limites anti-abus sont en mémoire** : elles repartent à zéro au redémarrage et ne conviennent qu'à un seul serveur. Pour plusieurs serveurs, il faudrait Redis.
5. **Les fichiers ne sont pas analysés par un antivirus.**
6. **La CSP autorise les styles en ligne** (nécessaire pour certaines couleurs dynamiques). Le risque est faible, car aucun script en ligne n'est autorisé.
7. **Les sauvegardes sont sur le même serveur.** → Les copier régulièrement ailleurs.
8. **Non testé en conditions réelles** : un vrai VPS avec un vrai domaine, de vrais micros, des réseaux mobiles. Tous les tests ont tourné sur une seule machine, avec des micros et caméras simulés.
