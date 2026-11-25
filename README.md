# RouteStop public

Pages publiques officielles de RouteStop :

- politique de confidentialité ;
- support et contact.
- back-office sécurisé : `https://routestop.fr/admin/`.

Le code de l’application et ses configurations privées restent dans un dépôt
séparé.

## Collecte automatique des services OSM

- Le workflow `.github/workflows/osm-centre.yml` tourne sur un serveur
  GitHub standard `ubuntu-24.04-arm`, sans ordinateur personnel.
  Les serveurs standard des dépôts publics sont
  [gratuits](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
  Aucun serveur payant, cache ni stockage d’artefacts n’est ajouté.
- Deux passages quotidiens sont prévus à 01:37 et 11:17 UTC. GitHub peut
  retarder les tâches planifiées. Le workflow « OSM France - collecte des 16
  secteurs » vérifie d’abord la version réellement proposée par le fournisseur.
  Si les 16 fichiers correspondent déjà à cette version récente, le
  téléchargement national est évité, même lors d’un lancement manuel.
- `python3 scripts/osm-download.py --check` vérifie l’accès sans télécharger
  le fichier national. Les anciens et nouveaux chemins datés officiels sont
  acceptés. Un renvoi HTTP du fournisseur est converti en HTTPS avant tout
  accès, uniquement pour ces chemins officiels. Aucune requête HTTP n’est
  envoyée ; les domaines inattendus, boucles et certificats invalides bloquent
  la collecte sans remplacer les données précédentes.
- Le téléchargement reprend uniquement le même fichier daté. Son empreinte MD5
  officielle est vérifiée avant analyse, en complément de HTTPS. En cas de
  problème de connexion, deux résolveurs DNS publics sont essayés. Aucun refus
  HTTP 403/429 ni erreur de certificat n’est contourné.
- L’analyse conserve les contrôles existants : date source de moins de 72 h,
  autoroutes présentes, volumes cohérents et refus d’une régression importante.
  Centre est enregistré dès validation, avant les autres régions. Seuls les
  petits extraits validés sont enregistrés ; les fichiers nationaux temporaires
  sont nettoyés à la fin de la tâche.
- Supabase importe ensuite ces fichiers avec ses tâches déjà planifiées.
  Une fiche dont l’identité reste incertaine conserve ses données précédentes ;
  elle ne bloque pas les autres fiches.

### Lire les messages de l’administration

« Données du » indique la date du fichier source, et « Dernier contrôle » celle
de son examen par le serveur. Une nouvelle lecture du même fichier ne rajeunit
pas les données. « Fiches à vérifier » ne signifie pas que le téléchargement
a échoué. Quand seuls ces cas restent à traiter sur un fichier récent, une
relance inutile n’est plus proposée. Un fichier ancien reste signalé comme tel.

En cas de retard, contrôler d’abord le workflow GitHub, puis la date
`source.dataAsOf` de `data/osm/centre.json`, puis la date source effectivement
enregistrée par Supabase. Une exécution manuelle réussie ne démontre pas à elle
seule la régularité des prochaines nuits.

### Réponses APRR incomplètes

Une liste de services vide ne prouve pas l’absence de station-service. Les
fiches concernées restent conservées et sont nommées dans les alertes et
l’administration, avec la raison de la vérification. Une fiche liée à un nouvel
identifiant mais à une autre autoroute n’est pas fusionnée automatiquement.
Les erreurs de téléchargement et les dates anciennes restent signalées
séparément : recevoir des données ne signifie pas avoir validé chaque aire.

## Signature CachiAppsStudio

Les pages publiques d’information (accueil, support, confidentialité et
suppression du compte) affichent le logo officiel CachiAppsStudio dans leur
pied de page. Le logo RouteStop et les textes légaux sont conservés.

Le PNG est repris sans modification du master du studio (SHA-256
`928a21d052bb5729f0164b7a8c79a706e5c832222eb2b3c95aabed351d4d59fb`).
Une plaque blanche en garantit la lisibilité, quel que soit le thème. La
signature s’adapte aux petits écrans. Conserver cette signature lors des
prochaines mises à jour et réutiliser le logo officiel sur les futurs sites.
