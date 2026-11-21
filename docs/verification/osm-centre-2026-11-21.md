# Vérification de la collecte Centre — 21 novembre 2026

## Incident et correction

Deux problèmes distincts ont été constatés :

1. Le fournisseur redirige désormais le fichier national vers
   `/europe/france/france-AAMMJJ.osm.pbf`. L’ancien contrôle n’acceptait que
   `/europe/france-AAMMJJ.osm.pbf`.
2. Le serveur GitHub x86 échouait à se connecter au fournisseur (curl 7),
   y compris avec deux résolveurs DNS de secours. Le serveur standard ARM
   a établi la connexion et terminé la collecte.

Le téléchargement est limité aux chemins datés officiels en HTTPS. Reprise
du même fichier uniquement, vérification de son empreinte officielle,
contrôle de date, de géométrie autoroutière et de volume avant remplacement.
Les contrôles d’identité et les règles de sélection des aires sont inchangés.

## Preuves observées

- [Exécution GitHub complète réussie](https://github.com/CAchiAppsstudio/routestop-public/actions/runs/44935043575),
  déclenchée par publication du correctif, et non par l’horloge.
- Téléchargement terminé à 18:28 UTC ; empreinte vérifiée.
- Centre enregistré à 18:30 UTC ; les 15 autres extraits validés à 18:33 UTC.
- Les 16 fichiers portent la date source **20 novembre 2026 à 21:21:21 UTC**,
  au lieu du 18 novembre à 21:21:02 UTC.
- Import de contrôle Centre par la fonction serveur existante, à 18:31 UTC :
  **38 fiches actualisées sur 39 reliées**. La fiche restante, dont l’identité
  OSM n’est plus confirmée, reste intacte.
- Comparaison de la base avant/après : aucune fiche ajoutée ou supprimée ;
  aucun changement de nom, coordonnées, enseigne, autoroute, sens, kilomètre,
  identifiants sources ou liens carburant. Seules les 38 observations Centre
  concernées ont changé.
- Deuxième import du même fichier : **zéro écriture**, 38 fiches déjà à jour.
  Une nouvelle lecture ne modifie donc pas artificiellement leur date.

## Administration

La date affichée vient du fichier source, même lorsque la collecte est
partielle à cause d’une seule fiche incertaine. La date du contrôle est
présentée séparément. Les fiches à vérifier ne sont plus comptées comme des
tentatives échouées. Le bouton inutile est désactivé lorsque seules ces
vérifications restent à faire sur des données récentes.

- 31 tests admin existants exécutés sur les fichiers publics modifiés : réussis.
- Cas ciblés : collecte partielle récente, 38/39 fiches vérifiées, source ancienne,
  absente ou future, vraie erreur réseau, travail en cours, seuil carburant,
  tableau de bord et relance groupée : réussis.
- Téléchargement : anciens/nouveaux chemins, domaines refusés, reprise datée,
  secours DNS, arrêt sur refus HTTP ou certificat invalide et contrôle
  d’empreinte correcte/incorrecte : réussis.
- Extrait réel : refus des dates anciennes/futures et du fichier vide vérifiés.
- Rendu ordinateur et largeur 390 px contrôlé dans un aperçu isolé, sans
  accès aux données réelles ni actions serveur.
- Fichier JavaScript publié contrôlé par empreinte SHA-256 identique au fichier
  testé ; nouvelle référence de cache présente dans la page publique.

## Limites et exploitation

Le traitement national reste sur un serveur GitHub standard gratuit du dépôt
public ; Supabase importe avec les tâches existantes. Aucun abonnement,
serveur personnel, cache payant, build mobile ni mise à jour des stores ajouté.
Le fichier national de 5,12 Go n’a pas été téléchargé sur le Mac.

Centre conserve ses passages serveur à 03:15, 15:15 et 21:15 UTC. Le workflow
GitHub est prévu à 01:37 et 11:17 UTC, avec retard possible de GitHub.
Le contrôle ci-dessus démontre la collecte distante et l’import réel, pas
encore la régularité de plusieurs nuits après ce correctif.

Le statut technique Centre reste `partial` tant que la fiche incertaine
n’est pas résolue. Il n’a pas été forcé artificiellement à `success`.
Les autres régions disposent de leurs nouveaux fichiers ; leur réception
par chaque import planifié n’est pas assimilée ici au contrôle Centre.
Le code des applications iOS et Android, les carburants et les règles
d’authentification n’ont pas été modifiés.
