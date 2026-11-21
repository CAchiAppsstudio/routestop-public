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
  retarder les tâches planifiées. Si les 16 fichiers ont déjà une date source
  suffisamment récente, le téléchargement national est évité.
- `python3 scripts/osm-download.py --check` vérifie l’accès sans télécharger
  le fichier national. Les anciens et nouveaux chemins datés officiels sont
  acceptés ; un autre domaine, HTTP ou un fichier non daté est refusé.
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
