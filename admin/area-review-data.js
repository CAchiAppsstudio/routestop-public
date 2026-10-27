window.RouteStopAreaReviewData = {
  "checkedOn": "2026-10-18",
  "profile": "Voiture : hauteur au plus 2 m, largeur au plus 2 m, longueur au plus 5 m, masse et PTAC au plus 3,5 t. Pas de validation poids lourds, camping-cars ou remorques.",
  "confirmed": [
    {
      "id": "R01",
      "name": "Romorantin",
      "road": "A85"
    },
    {
      "id": "R02",
      "name": "Volcans d’Auvergne",
      "road": "A71"
    },
    {
      "id": "R03",
      "name": "Limagne",
      "road": "A89"
    },
    {
      "id": "R06",
      "name": "Écot",
      "road": "A36"
    },
    {
      "id": "R08",
      "name": "Poulet de Bresse",
      "road": "A39"
    },
    {
      "id": "R09",
      "name": "Jardin des Arbres",
      "road": "A77"
    },
    {
      "id": "R10",
      "name": "Jura",
      "road": "A39"
    },
    {
      "id": "R11",
      "name": "Villeroy",
      "road": "A19"
    },
    {
      "id": "R12",
      "name": "Bonneville",
      "road": "A40"
    },
    {
      "id": "R17",
      "name": "Jardins du Loiret",
      "road": "A19"
    },
    {
      "id": "R19",
      "name": "Urvillers",
      "road": "A26"
    },
    {
      "id": "R20",
      "name": "Sommesous",
      "road": "A26"
    },
    {
      "id": "R23",
      "name": "Baie de Somme",
      "road": "A16"
    },
    {
      "id": "R24",
      "name": "Trémentines",
      "road": "A87"
    }
  ],
  "pending": [
    {
      "id": "R04",
      "name": "Chavanon",
      "road": "A89",
      "reason": "Accès aux pompes Avia et retour dans chaque sens démontrés par les bretelles de l’aire.",
      "next": "Vérifier et fixer la destination précise de guidage avant utilisation dans l’app.",
      "caution": "Les coordonnées gouvernementales de cette station sont décalées d’environ 1,9 km par rapport aux pompes cartographiées. Validation de l’accès uniquement : bloquer toute intégration automatique tant que la destination de guidage n’est pas corrigée et vérifiée.",
      "sources": [
        {
          "label": "VINCI, fermeture du 24 mars 2026",
          "url": "https://www.vinci-autoroutes.com/fr/actualites/travaux/nuit-du-24-mars-2026-fermeture-de-laire-bidirectionnelle-de-chavanon-a89/",
          "note": ""
        },
        {
          "label": "Pompes cartographiées — OpenStreetMap",
          "url": "https://www.openstreetmap.org/node/8071870143"
        }
      ],
      "category": "position",
      "title": "Destination de guidage à vérifier",
      "problem": "Les accès sont documentés, mais les coordonnées officielles sont décalées d’environ 1,9 km des pompes.",
      "recommendation": "Ne pas ajouter l’accès dans les deux sens avant d’avoir vérifié le point de guidage."
    },
    {
      "id": "R05",
      "name": "Centre de la France — Bruère / Farges-Allichamps",
      "road": "A71",
      "reason": "La liaison automobile Bruère–Farges est documentée, mais le parcours complet passant par les pompes Esso puis revenant au sens initial n’est reconstitué que depuis une chaussée. Cela ne prouve pas une interdiction depuis l’autre.",
      "next": "Obtenir un plan actuel ou une confirmation de l’exploitant pour la boucle Bruère → pompes Esso → Bruère. Respecter la limite de 3,5 t du pont.",
      "sources": [
        {
          "label": "Autogrill, brochure consultée le 18/10/2026, p. 6–7",
          "url": "https://www.reservationgroupes-autogrill.fr/data/brochure_2024.pdf",
          "note": "Pages contrôlées visuellement. Le nom du fichier comporte 2024 mais le contenu mentionne aussi 2026 : date de publication non établie."
        },
        {
          "label": "APRR, fiche structurée Bruère",
          "url": "https://voyage.aprr.fr/api/aprr/pois/popin/service_area/3864",
          "note": ""
        },
        {
          "label": "APRR, fiche structurée Farges",
          "url": "https://voyage.aprr.fr/api/aprr/pois/popin/service_area/3867",
          "note": ""
        },
        {
          "label": "Pompes cartographiées — OpenStreetMap",
          "url": "https://www.openstreetmap.org/way/774861327"
        }
      ],
      "category": "access",
      "title": "Retour aux pompes depuis Bruère à confirmer",
      "problem": "Le pont est documenté. Le trajet complet jusqu’aux pompes Esso puis le retour dans le même sens ne sont prouvés que d’un côté.",
      "recommendation": "Conserver les informations confirmées, sans ajouter le second accès."
    },
    {
      "id": "R07",
      "name": "Bourbonnais",
      "road": "A79",
      "reason": "La station Fulli est bien sur l’aire, mais le parcours reconstitué depuis l’un des sens emprunte des voies de la N7. Il ne satisfait pas la règle stricte « sans sortir de l’autoroute ». La station Shell voisine n’est pas une substitution.",
      "next": "Ne pas valider cette exception dans les deux sens sans preuve d’un parcours exclusivement interne à l’aire et à l’A79.",
      "sources": [
        {
          "label": "APRR, présentation de l’aire",
          "url": "https://voyage.aprr.fr/autoroute-info/presentation-de-laire-de-services-du-bourbonnais",
          "note": ""
        },
        {
          "label": "Pompes cartographiées — OpenStreetMap",
          "url": "https://www.openstreetmap.org/way/1228948232"
        }
      ],
      "category": "access",
      "title": "Le trajet trouvé passe par la N7",
      "problem": "La station Fulli est sur l’aire. Un accès étudié utilise la N7 : il ne respecte pas notre règle « sans sortir de l’autoroute ».",
      "recommendation": "Ne pas ajouter ce trajet. Ne pas le remplacer par la station Shell voisine."
    },
    {
      "id": "R13",
      "name": "Val de Cher",
      "road": "A85",
      "reason": "L’accès bidirectionnel à la recharge est documenté. Le parcours carburant trouvé utilise des voies non classées comme internes ; leur statut et le passage précis aux pompes Eni restent à confirmer.",
      "next": "Obtenir un plan des accès carburant et le statut des voies sous l’A85. Ne pas assimiler accès électrique et accès aux pompes.",
      "sources": [
        {
          "label": "VINCI, stations Zunder",
          "url": "https://www.vinci-autoroutes.com/fr/actualites/services-et-aires/stations-recharge-ultra-rapides-zunder/",
          "note": ""
        },
        {
          "label": "Pompes cartographiées — OpenStreetMap",
          "url": "https://www.openstreetmap.org/node/1146884578"
        }
      ],
      "category": "access",
      "title": "Accès électrique ≠ accès aux pompes",
      "problem": "La recharge est accessible depuis les deux sens. Le trajet jusqu’aux pompes Eni et le statut des voies restent à confirmer.",
      "recommendation": "Ne pas étendre aux carburants une validation qui concerne la recharge électrique."
    },
    {
      "id": "R14",
      "name": "Sarthe Touraine",
      "road": "A28",
      "reason": "La circulation interne permet de rejoindre le voisinage de la station Avia puis de repartir dans chaque sens. Le dernier passage aux pompes n’est pas assez détaillé dans la carte pour être validé avec le même niveau de preuve que les autres dossiers.",
      "next": "Confirmer les allées des pompes voitures par un plan de la station ou des vues actuelles. L’absence de détail cartographique n’est pas une preuve d’inaccessibilité.",
      "sources": [
        {
          "label": "VINCI, stations Zunder",
          "url": "https://www.vinci-autoroutes.com/fr/actualites/services-et-aires/stations-recharge-ultra-rapides-zunder/",
          "note": ""
        },
        {
          "label": "Pompes cartographiées — OpenStreetMap",
          "url": "https://www.openstreetmap.org/node/25211450"
        }
      ],
      "category": "access",
      "title": "Derniers mètres jusqu’aux pompes à confirmer",
      "problem": "Les voies internes sont cohérentes, mais le passage exact jusqu’aux pompes Avia manque de détails.",
      "recommendation": "Garder le second accès en attente. Cela ne signifie pas que la station est inaccessible."
    },
    {
      "id": "R15",
      "name": "Garonne",
      "road": "A62",
      "reason": "Aire annoncée bidirectionnelle, mais une seule boucle complète autoroute → pompes Avia → même sens est reconstituée avec les données actuelles.",
      "next": "Confirmer les sens de circulation des deux ouvrages et le raccordement aux pompes depuis l’autre chaussée.",
      "sources": [
        {
          "label": "VINCI, aire Pierre Perret",
          "url": "https://www.vinci-autoroutes.com/fr/actualites/services-et-aires/une-aire-pierre-perret-sur-autoroute/",
          "note": ""
        },
        {
          "label": "Pompes cartographiées — OpenStreetMap",
          "url": "https://www.openstreetmap.org/node/8090628126"
        }
      ],
      "category": "access",
      "title": "Retour dans le bon sens à confirmer",
      "problem": "L’aire est annoncée accessible des deux côtés. Une seule boucle complète par les pompes Avia est documentée.",
      "recommendation": "Ne pas ajouter le second accès sans vérifier l’entrée, les pompes et le retour."
    },
    {
      "id": "R16",
      "name": "Jardin des Causses du Lot",
      "road": "A20",
      "reason": "Le caractère bidirectionnel de l’aire est officiel. En revanche, les pompes Avia attendues ne sont pas identifiées dans l’extrait routier autour des coordonnées du catalogue. La Station U voisine est extérieure et ne doit pas être utilisée.",
      "next": "Confirmer les coordonnées exactes de l’aire et de la station Avia, puis refaire les deux boucles d’accès.",
      "sources": [
        {
          "label": "VINCI, découverte de l’aire",
          "url": "https://www.vinci-autoroutes.com/fr/decouvertes/aires-remarquables/jardin-des-causses-du-lot-A20/",
          "note": ""
        }
      ],
      "category": "position",
      "title": "Emplacement exact des pompes à retrouver",
      "problem": "L’aire est officiellement accessible depuis les deux sens. Les pompes Avia ne sont pas identifiées autour des coordonnées du dossier.",
      "recommendation": "Ne pas utiliser la Station U voisine : elle est hors autoroute."
    },
    {
      "id": "R18",
      "name": "Metz Saint-Privat",
      "road": "A4",
      "reason": "Les accès dans les deux sens sont cohérents, mais l’identité carburant est contradictoire : un objet Shell porte 57124001, un autre Total porte 57855003 avec un avertissement cartographique explicite sur la marque. Seul ce dernier identifiant figure dans le relevé gouvernemental local.",
      "next": "Faire confirmer l’enseigne, les pompes voitures et l’identifiant actuel par l’exploitant. Ne pas fusionner ni copier les prix entre ces identifiants.",
      "sources": [
        {
          "label": "Sanef, Metz Saint-Privat",
          "url": "https://www.autoroutes.sanef.com/index.php/fr/aire/service/metz-saint-privat-autoroute-a4",
          "note": ""
        },
        {
          "label": "Autogrill, brochure consultée le 18/10/2026, p. 6–7",
          "url": "https://www.reservationgroupes-autogrill.fr/data/brochure_2024.pdf",
          "note": "Pages contrôlées visuellement. Le nom du fichier comporte 2024 mais le contenu mentionne aussi 2026 : date de publication non établie."
        },
        {
          "label": "Pompes cartographiées — OpenStreetMap",
          "url": "https://www.openstreetmap.org/way/749650114"
        }
      ],
      "category": "identity",
      "title": "Enseigne et identifiant carburant contradictoires",
      "problem": "Le dossier comporte deux identifiants et des mentions Shell / Total contradictoires. Les accès seuls ne suffisent pas à choisir les bons prix.",
      "recommendation": "Ne pas fusionner les stations ni recopier leurs prix."
    },
    {
      "id": "R21",
      "name": "Bolleville",
      "road": "A29",
      "reason": "Sanef annonce une liaison automobile entre les deux sens, mais le relevé routier ne permet de reconstituer qu’une boucle complète par les pompes Esso.",
      "next": "Vérifier le raccordement et les sens des bretelles de la chaussée opposée avant validation.",
      "sources": [
        {
          "label": "Sanef, Bolleville",
          "url": "https://www.autoroutes.sanef.com/index.php/fr/aire/service/bolleville-autoroute-a29",
          "note": ""
        },
        {
          "label": "Pompes cartographiées — OpenStreetMap",
          "url": "https://www.openstreetmap.org/way/472690778"
        }
      ],
      "category": "access",
      "title": "Une seule boucle complète documentée",
      "problem": "La liaison automobile est annoncée par Sanef, mais le passage par les pompes Esso puis le retour ne sont prouvés que d’un côté.",
      "recommendation": "Garder le second accès en attente jusqu’à confirmation de ses bretelles."
    },
    {
      "id": "R22",
      "name": "Croixrault",
      "road": "A29",
      "reason": "Les deux accès sont démontrés, mais deux ensembles de pompes BP portent deux identifiants (80290008 et 80290003), dont un absent du relevé gouvernemental local. La répartition voitures / poids lourds et l’identité tarifaire doivent être confirmées.",
      "next": "Valider l’identifiant des pompes voitures avant de partager leurs prix entre les deux sens.",
      "sources": [
        {
          "label": "Sanef, Croixrault",
          "url": "https://www.autoroutes.sanef.com/fr/aire/service/croixrault-autoroute-a29",
          "note": ""
        },
        {
          "label": "Pompes cartographiées — OpenStreetMap",
          "url": "https://www.openstreetmap.org/way/290789749"
        }
      ],
      "category": "identity",
      "title": "Pompes voitures ou poids lourds ?",
      "problem": "Deux ensembles de pompes BP portent des identifiants différents. Leur usage et la bonne correspondance tarifaire restent à confirmer.",
      "recommendation": "Ne pas partager les prix entre les deux sens avant d’identifier les pompes voitures."
    }
  ]
};
