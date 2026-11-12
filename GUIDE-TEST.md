# Guide de test — Notation kata

Merci de tester l'application ! Elle sert à noter les compétitions de kata selon le règlement WKF 2026 :
la **table** pilote le combat, les **juges** notent sur tablette, l'**écran public** révèle le résultat.

## 1. Accès

**Lien de l'application :** `https://________.onrender.com`

> La première ouverture peut prendre **environ 1 minute** (le serveur gratuit se met en veille). Ensuite, tout est rapide.

## 2. Identifiants

| Rôle | E-mail | Mot de passe | Écran |
|---|---|---|---|
| Table officielle | `table.3198@demo.local` | `Table1234!` | `/table` |
| Juge 1 | `juge1.3198@demo.local` | `Juge1234!` | `/judge` |
| Juge 2 | `juge2.3198@demo.local` | `Juge1234!` | `/judge` |
| Juge 3 | `juge3.3198@demo.local` | `Juge1234!` | `/judge` |
| Juge 4 | `juge4.3198@demo.local` | `Juge1234!` | `/judge` |
| Juge 5 | `juge5.3198@demo.local` | `Juge1234!` | `/judge` |
| Juge 6 | `juge6.3198@demo.local` | `Juge1234!` | `/judge` |
| Juge 7 | `juge7.3198@demo.local` | `Juge1234!` | `/judge` |

L'écran public (`/display`) ne demande pas de connexion.

Après connexion, chacun arrive directement sur son écran.

> **Un juge = une fenêtre.** La session est gardée par le navigateur : pour être connecté en même temps comme table
> et comme juge, ouvrez chaque compte dans une **fenêtre de navigation privée** différente, un autre navigateur,
> ou un autre appareil (téléphone, tablette).

## 3. Scénario de test (15 minutes)

Ouvrez trois fenêtres : la **table**, l'**écran public** et au moins un **juge**.

### Étape 1 — Préparer le combat (table)

1. Connectez-vous avec le compte **table**.
2. Choisissez la compétition **« Démonstration … »** et la catégorie **« Kata individuel senior hommes »**.
3. Dans la liste de gauche, cliquez sur un combat dont les deux athlètes sont connus (statut **Prévu**).
4. Cliquez sur **Appeler les athlètes**.
5. Annoncez le kata de l'**AKA** (rouge) puis de l'**AO** (bleu) dans les listes déroulantes.
6. Cliquez sur **Tirer le panel** : les juges tirés au sort s'affichent (ex. « J1 Juge 4 »).

### Étape 2 — Le combat (table)

7. **AKA commence son kata** → **AKA a terminé · AO commence** → **AO a terminé · ouvrir la notation**.

### Étape 3 — La notation (juges)

8. Dans une fenêtre juge, connectez-vous avec un juge **qui fait partie du panel** affiché sur la table
   (« Juge 4 » = `juge4.3198@demo.local`).
9. Saisissez une note pour l'AKA puis pour l'AO au pavé numérique : de **5,0 à 10,0**
   (ex. tapez `7` puis `6` pour 7,6 ; `1` `0` `0` pour 10,0), puis envoyez.
10. Sur la table, le compteur **« Notes reçues »** augmente.

> **Pas assez de fenêtres pour tous les juges ?** Notez avec un ou deux juges, puis cliquez sur la table sur
> **« Simuler les notes manquantes (démo) »** : l'application note à la place des juges absents.

### Étape 4 — Résultat

11. Quand tous les juges ont noté, l'**écran public** révèle les notes de chaque juge une à une, les votes et le vainqueur.
12. Sur la table, cliquez sur **Confirmer le résultat** : le vainqueur passe au tour suivant dans la liste.
13. **Combat suivant** et recommencez.

### Pour aller plus loin

- **Kiken** (absence / abandon) : bouton sous le nom d'un athlète, avant la notation.
- **Double disqualification** : pendant la notation ; un combat supplémentaire est créé.
- **Repêchage** : quand les deux **finales de poule** sont terminées, cliquez sur **Générer le repêchage** (en haut à gauche).
- **Règles des katas** : essayez d'annoncer pour un athlète un kata qu'il a déjà présenté : l'application doit le refuser.
- **Modifier ses notes** : un juge peut corriger ses notes tant que tous les juges n'ont pas noté.

## 4. Ce qu'il faut vérifier

- Les juges ne voient **jamais** les notes des autres avant la révélation.
- Un juge ne peut pas donner **la même note** aux deux athlètes, ni une note hors de 5,0–10,0.
- L'écran public et la table se mettent à jour **tout seuls**, sans recharger la page.
- Le vainqueur annoncé correspond à la **majorité des votes** des juges.
- L'affichage reste lisible sur téléphone et tablette.

## 5. Signaler un problème

Pour chaque problème, notez :

1. l'**écran** (table, juge, affichage) et l'**appareil / navigateur** ;
2. ce que vous avez **fait** juste avant ;
3. ce que vous **attendiez** et ce qui s'est **passé** (une capture d'écran aide beaucoup) ;
4. le **message d'erreur** affiché, s'il y en a un.

## 6. Repartir de zéro

Si tous les combats de la démonstration sont déjà joués, demandez à l'organisateur de créer une **nouvelle démonstration**.
Les mots de passe restent les mêmes, mais le **numéro dans les e-mails change** (ex. `juge1.4821@demo.local`) :
l'organisateur vous communiquera les nouveaux identifiants.
