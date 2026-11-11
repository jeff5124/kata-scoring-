# kata-scoring

Moteur de règles et schéma de base de données pour une application de notation de kata,
basés sur les **WKF Kata Competition Rules 2026.0** (traduction française).

## Contenu

| Fichier | Rôle | Articles |
|---|---|---|
| `src/rules/scoring.ts` | notes en dixièmes, vote des juges, majorité, disqualification, Kiken | 5.4, 5.5, 5.11 |
| `src/rules/katas.ts` | liste officielle (1 à 102), répétitions, U14, tour des médailles | 5.1, 5.2, 6.3 |
| `src/rules/groups.ts` | tailles de poules et qualifiés (3 à 32 athlètes) | 3.7.9 |
| `src/rules/standings.ts` | classement d'un groupe, départages, meilleurs 2es/3es entre groupes | 5.11 à 5.13 |
| `db/schema.sql` | schéma PostgreSQL (23 tables) | tout |

## Utilisation

```bash
npm install
npm test          # 55 tests
npm run build
psql -f db/schema.sql
```

## Hypothèses à valider (le règlement est muet ou ambigu)

1. **Notes égales d'un juge** : refusées (`EQUAL_SCORES`), sauf double 0.
2. **Taille du panel** : configurable (`competitions.settings`, `stages.panel_size`) ; 4.1 et 4.4 se contredisent.
3. **Kiken** : le gagnant reçoit 4 votes, quel que soit le panel (`KIKEN_VOTES`).
4. **Répétition consécutive au tour des médailles** : non appliquée par défaut (`consecutiveRuleInMedalRound`).
5. **Égalité à 3 ou plus avec cycle** (A>B>C>A) : la confrontation directe est ignorée, on passe aux votes.
6. **Classement mondial manquant** : l'athlète est considéré comme moins bien classé.
7. **Poule unique (3 à 5 athlètes)** : la règle de qualification renvoie la finale 1er/2e ; le match de bronze reste à définir.

## API (NestJS + Socket.IO)

Démarrage : `DATABASE_URL=postgres://… AUTH_SECRET=<16+ caractères> [ADMIN_EMAIL=… ADMIN_PASSWORD=…] npm run build && npm start` (port `PORT`, 3000 par défaut).
Base : `npm run db:migrate` (schéma + 102 katas). Projet Neon : `odd-poetry-40005988` (PG17, eu-central-1).

Authentification : `POST /auth/login {email,password}` → `{token}` (valable 12 h, en-tête `Authorization: Bearer …`) ·
`GET /auth/me` · `POST /auth/users` (ADMIN : `{email,password,role,officialId?}`). Le premier ADMIN est créé au démarrage
depuis `ADMIN_EMAIL`/`ADMIN_PASSWORD` si la table est vide. Rôles : ADMIN (tout) · TECHNICIAN/TATAMI_MANAGER (pilotent le combat) ·
JUDGE (note, identité prise dans le jeton, jamais dans la requête) · `GET /bouts/:id` public (affichage). WebSocket : jeton dans `auth.token`.

REST : `GET /bouts/:id` · `POST /bouts/:id/{panel,kata,advance,scores,confirm,kiken,double-disqualification}`
Temps réel (namespace `/live`) : `join {boutId}` · `score:submit {boutId, aka, ao}` ;
la salle reçoit `state`, `progress` (compteurs, jamais les notes), `revealed`, `confirmed`.
Erreurs : règle → 422 `{code,message}` ; état/verdict → 409 `{code}`.

Tests d'intégration : `TEST_DATABASE_URL=postgres://… npm test` (ignorés sans cette variable).
Tirage et tableau (rôle TECHNICIAN ; lecture publique) :
`POST /categories/:id/draw` (selon le format de la catégorie, ou `{format}` ; élimination avec repêchage par défaut, 3.3.1 a ; `poolPanelSize` 7) · `GET /categories/:id/standings` ·
`POST /categories/:id/repechage` (élimination avec repêchage : après les deux finales de poule ; `knockoutPanelSize`, `medalPanelSize`) ·
`POST /categories/:id/knockout` (poules + élimination : `knockoutPanelSize` 5, `medalPanelSize` 7, `cutoffWinners` pour départager à la limite de qualification) ·
`GET /categories/:id/bracket`. Erreurs 409 : `ALREADY_DRAWN`, `POOLS_INCOMPLETE`, `TIES_UNRESOLVED` (kata supplémentaire requis),
`CUTOFF_TIE`, `KNOCKOUT_EXISTS`. Erreurs du repêchage : `REPECHAGE_NOT_READY`, `REPECHAGE_EXISTS`, `NOT_ELIMINATION_FORMAT`.
Formats gérés : élimination avec repêchage (3.6, par défaut) et poules puis élimination (3.7) ; les deux bassins (3.8) restent à faire.

Élimination avec repêchage : deux poules (têtes de série 1-2 et 3-4 séparées), chacune en élimination directe (exempts aux mieux classés,
tableau 1-8, 4-5…), finale entre les deux vainqueurs de poule. `POST …/repechage` crée ensuite, pour chaque finaliste, la poule des athlètes qu'il a battus
(éliminés le plus tard = mieux classés), jouée jusqu'aux deux derniers qui se disputent une médaille de bronze (panel de 7) ; un éliminé seul est
médaillé sans combat ; la finale se joue après les tours de repêchage. Hypothèses : tailles de poules à ±1 ; 4 à 128 inscrits ; panel de 5 pour les tours éliminatoires et le repêchage.

Hypothèses du tirage à valider : (a) la ligne « Graine » du tableau 3.7.9 est illisible dans le PDF : têtes de série 1-4 placées aux groupes
ceil(f×g), f = 1, ½, ¼, ¾ (8 groupes : 8, 4, 2, 6 ; 4 groupes : D, B, A, C) ; les tailles de poules reproduisent toutes les lignes lisibles du tableau ;
(b) athlètes d'une même fédération séparés dans les poules quand c'est possible ; (c) tableau : rang 1-8, 4-5, 3-6, 2-7, sans revanche de groupe au 1er tour,
vainqueurs de groupe avant les deuxièmes ; (d) bronze (3.7.6) : le perdant de chaque demi-finale rencontre l'athlète battu par son vainqueur au tour précédent ;
avec 2 groupes (demi-finales directes) aucun combat de bronze, les deux perdants sont médaillés ; 1 groupe : 3e contre 4e ;
(e) panels : 7 en poules, 5 en quarts et demi-finales, 7 pour les médailles (4.1, 4.4).

Administration (lecture : TECHNICIAN/TATAMI_MANAGER ; écriture : ADMIN) : `GET|POST /competitions` · `GET /competitions/:id` (catégories, tatamis, officiels) ·
`POST /competitions/:id/{categories,officials,tatamis}` (un officiel avec `email`/`password` reçoit son compte : JUDGE, TECHNICIAN, TATAMI_MANAGER, RUNNER) ·
`PATCH /officials/:id {isAvailable}` · `GET|POST /federations` · `GET|POST /athletes` · `GET|POST /categories/:id/entries` · `DELETE /entries/:id` (avant tirage) ·
`POST /categories/:id/tatami {tatamiId}` (combats non terminés, TECHNICIAN) · `GET /katas` (public).
Démonstration : `POST /admin/demo` crée une compétition complète (8 athlètes, 7 juges et un compte de table avec identifiants, tatami 1, tirage fait) ;
`POST /admin/bouts/:id/simulate-scores` complète les notes manquantes, uniquement pour une compétition marquée `settings.demo`.

Démarrage simplifié : `npm start` lit `.env` (`DATABASE_URL`, `AUTH_SECRET`) et force l'IPv4 vers Neon.

Non fait : limitation des tentatives de connexion, calendrier par tatami, équipes/Bunkai, protêts, deux bassins (3.8), Docker.


## Application web (Next.js, dossier `web/`)

PWA sans rendu serveur pour les écrans de salle. Démarrage : `cd web && npm install && npm run build && npm start` (port 3001) ;
l'API est jointe sur le même hôte au port 3000, ou via `NEXT_PUBLIC_API_URL`.

- `/login` : connexion (e-mail, mot de passe).
- `/judge` : écran du juge (tablette, paysage ou portrait). Pavé numérique qui n'accepte que 5,0 à 10,0 (51 notes possibles), passage automatique
  d'AKA à AO, bouton « Disqualifier » avec confirmation, envoi par WebSocket puis HTTP en secours, nouvelles tentatives automatiques si le Wi-Fi coupe,
  « Modifier mes notes » tant que la révélation n'a pas eu lieu, écran maintenu allumé. Les notes des autres juges ne sont jamais visibles avant la révélation.
- `/display` : écran public. Combat en cours (ou `?bout=<id>`, `?tatami=<id>`), avancement de la notation, puis révélation simultanée des 7 juges
  (animation séquentielle), décompte des votes et vainqueur. Le dernier résultat reste affiché jusqu'au combat suivant.
- `/admin` : compétitions, catégories, inscriptions (têtes de série), fédérations, athlètes, officiels et leurs comptes, tatamis, tirage et affectation
  au tatami ; bouton « Créer une démonstration ».
- `/table` : table officielle. Choix de la compétition et de la catégorie, liste des combats par phase, puis pilotage du combat : appel, annonce des katas
  (règles de répétition vérifiées par l'API), tirage du panel (noms des juges), passages AKA puis AO, suivi des notes reçues, révélation détaillée,
  confirmation, kiken, double disqualification, combat suivant ; génération du repêchage ou du tableau final.
- Après connexion, chaque rôle arrive sur son écran (ADMIN → `/admin`, TECHNICIAN/TATAMI_MANAGER → `/table`, JUDGE → `/judge`).
- Police Archivo auto-hébergée (aucun accès internet requis dans la salle).

API ajoutée pour ces écrans : `GET /bouts/active` (public, `?tatami=`), `GET /bouts/mine` (juge), salle Socket.IO `watch` (tous les combats).
Non fait : mode kiosque / service worker hors ligne.
