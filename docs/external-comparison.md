# Validation externe — Toyota 3S-GTE ST205

## 1. Objet de ce document

Ce document présente la **validation externe disponible** pour le simulateur numérique 0D dynamique inspiré du moteur Toyota **3S-GTE** équipant la **Celica GT-Four ST205**.

L'objectif n'est pas de revendiquer :

- une validation expérimentale complète sur banc moteur instrumenté ;
- une reproduction constructeur Toyota ;
- un jumeau numérique ;
- une précision garantie sur l'ensemble du domaine de fonctionnement ;
- un outil destiné à la calibration ECU ou à une décision d'ingénierie.

La démarche consiste à confronter les résultats globaux du modèle aux **spécifications publiées par Toyota** pour le ST205.

Cette comparaison complète les vérifications internes déjà réalisées :

- tests unitaires des sous-modules ;
- cohérence du cycle 720° ;
- fermeture P-V / IMEP / couple indiqué ;
- répétabilité multi-cycle ;
- convergence angulaire 1° / 0,5° / 0,25° ;
- bilans de masse et d'énergie ;
- campagne multipoint stabilisée ;
- scénarios transitoires automatisés ;
- non-régression déterministe.

La validation présentée ici doit donc être lue comme une **validation externe de premier niveau par données constructeur**.

---

## 2. Référence externe

La référence principale est une fiche technique Toyota pour la Celica GT-Four ST205.

Toyota publie notamment :

| Grandeur | Valeur Toyota |
|---|---:|
| Moteur | 3S-GTE |
| Cylindrée totale | 1 998 cm³ |
| Alésage | 86,0 mm |
| Course | 86,0 mm |
| Rapport volumétrique | 8,5:1 |
| Puissance maximale | 255 PS / 188 kW à 6 000 tr/min |
| Couple maximal | 304 N·m à 4 000 tr/min |
| Suralimentation | Turbo avec intercooler |

Sources Toyota :

- Toyota Japan, fiche Celica GT-Four ST205 :  
  https://toyota.jp/ucar/catalog/brand-TOYOTA/car-CELICA/199712/1008854/
- Toyota Motor Corporation, présentation de la génération ST205 :  
  https://global.toyota/en/detail/7856970

La seconde source confirme notamment que le moteur 2,0 L turbo du nouveau GT-Four développe **255 PS**, avec un turbocompresseur, une admission, un échappement et une distribution modifiés.

---

## 3. Grandeurs géométriques

Les principales grandeurs géométriques du modèle sont directement imposées depuis les caractéristiques publiques du moteur.

| Grandeur | Toyota | Simulation | Écart |
|---|---:|---:|---:|
| Alésage | 86,0 mm | 86,0 mm | 0 % |
| Course | 86,0 mm | 86,0 mm | 0 % |
| Rapport volumétrique | 8,5:1 | 8,5:1 | 0 % |
| Cylindrée totale | 1 998 cm³ | ≈ 1 998,23 cm³ | ≈ +0,01 % |

L'écart très faible sur la cylindrée provient du calcul géométrique effectué à partir de l'alésage et de la course :

```text
Vd = N × π/4 × B² × S
```

avec :

```text
N = 4 cylindres
B = 0,086 m
S = 0,086 m
```

La valeur obtenue est cohérente avec l'arrondi constructeur à 1 998 cm³.

Ces grandeurs ne constituent pas une prédiction du modèle : elles font partie de ses **conditions géométriques imposées**.

---

## 4. Comparaison des performances globales

### 4.1 Résultats actuellement obtenus

Le tir déterministe de référence produit actuellement des ordres de grandeur voisins de :

| Grandeur | Toyota ST205 | Simulation 0D | Écart |
|---|---:|---:|---:|
| Couple maximal | 304 N·m à 4 000 tr/min | ≈ 295 N·m | ≈ −3,0 % |
| Puissance maximale | 255 PS à 6 000 tr/min | ≈ 242 ch | ≈ −5,1 % |

> **Important :** les valeurs simulées ci-dessus correspondent à la campagne de référence utilisée lors de la validation du projet.  
> Après une modification physique ou numérique significative, ce tableau doit être régénéré avec le dernier tir déterministe validé.

### 4.2 Calcul de l'écart

L'écart relatif est calculé par :

```text
écart (%) = (simulation − référence) / référence × 100
```

Pour le couple maximal :

```text
(295 − 304) / 304 × 100
≈ −2,96 %
```

Pour la puissance maximale :

```text
(242 − 255) / 255 × 100
≈ −5,10 %
```

Dans ce document, `ch` et `PS` sont considérés comme équivalents à la précision nécessaire pour cette comparaison qualitative.

---

## 5. Interprétation

Les résultats montrent que le modèle retrouve le **niveau global de performance** du 3S-GTE ST205 avec des écarts de quelques pourcents sur les deux grandeurs constructeur principales disponibles.

Le résultat est considéré comme satisfaisant pour l'objectif du projet car :

1. le couple n'est pas imposé par une table régime → couple ;
2. la puissance n'est pas directement prescrite ;
3. le couple résulte de la pression cylindre et de la géométrie bielle-manivelle ;
4. la pression cylindre résulte du remplissage, de la masse de carburant, de la combustion et des transferts thermodynamiques ;
5. le boost est obtenu à travers une dynamique de turbo, même si sa commande de wastegate est calibrée autour d'une cible ;
6. les pertes mécaniques et le pompage sont calculés séparément avant l'obtention du couple net.

La comparaison constructeur ne démontre donc pas seulement qu'une constante `295 N·m` ou `242 ch` a été inscrite dans le logiciel : elle confronte à une référence externe les sorties d'une chaîne physique complète.

## 6. Limites de la comparaison constructeur

Les données constructeur disponibles sont essentiellement des **points caractéristiques**, et non une courbe complète instrumentée.

La comparaison actuelle ne fournit donc pas directement :

- la courbe de couple complète mesurée ;
- la courbe de puissance complète mesurée ;
- la pression de suralimentation par régime ;
- le débit d'air ;
- l'AFR ;
- la consommation spécifique ;
- la température des gaz d'échappement ;
- le régime du turbocompresseur ;
- la pression cylindre en fonction de l'angle vilebrequin ;
- CA10, CA50 et CA90 expérimentaux.

En conséquence, un bon accord sur `304 N·m` et `255 PS` **ne suffit pas à prouver que tous les états internes du modèle sont exacts**.

Il montre uniquement que la chaîne physique calibrée conduit à des performances globales compatibles avec celles publiées pour le moteur de référence.

---

## 7. Pourquoi aucune courbe de banc Internet non documentée n'est utilisée

De nombreuses courbes de puissance de 3S-GTE sont disponibles sur des forums, vidéos ou sites de préparation.

Elles n'ont pas été utilisées comme référence principale car il est souvent impossible de déterminer avec certitude :

- si le moteur est strictement d'origine ;
- la génération exacte du 3S-GTE ;
- la pression de suralimentation utilisée ;
- les modifications d'admission et d'échappement ;
- le carburant ;
- la température et la pression atmosphérique ;
- la correction SAE, DIN ou autre ;
- si la puissance indiquée correspond au moteur ou aux roues ;
- les pertes de transmission supposées ;
- l'état mécanique du moteur.

Pour ce projet, une donnée constructeur traçable mais limitée est préférable à une courbe plus détaillée dont la provenance ou les conditions d'essai sont inconnues.

---

## 8. Nature des différentes preuves

| Élément | Nature | Niveau de preuve |
|---|---|---|
| Alésage / course / compression | Donnée constructeur imposée | Élevé |
| Cylindrée recalculée | Vérification géométrique | Élevé |
| Fermeture P-V / couple | Vérification interne | Élevé pour la cohérence numérique |
| Convergence angulaire | Vérification numérique | Élevé pour les cas testés |
| Répétabilité | Vérification numérique | Élevé pour les cas testés |
| Conservation masse / énergie | Vérification interne | Dépend du périmètre du bilan |
| Couple max vs 304 N·m | Comparaison externe constructeur | Modéré |
| Puissance max vs 255 PS | Comparaison externe constructeur | Modéré |
| Boost | Paramètre dynamique régulé / calibré | Non validé expérimentalement |
| Pression cylindre | Résultat du modèle | Non validé expérimentalement |
| CA50 | Résultat du modèle avec commande de phasage | Non validé expérimentalement |
| Régime turbo | Résultat du modèle | Non validé expérimentalement |
| Spool | Dynamique interne du modèle | Non validé sur véhicule réel |

---

## 9. Conclusion

Les spécifications Toyota fournissent deux points de référence externes particulièrement utiles :

```text
Couple maximal Toyota       : 304 N·m à 4 000 tr/min
Couple maximal simulation   : ≈ 295 N·m
Écart                       : ≈ −3,0 %

Puissance maximale Toyota   : 255 PS à 6 000 tr/min
Puissance maximale simulation : ≈ 242 ch
Écart                         : ≈ −5,1 %
```

Pour un modèle 0D qualitatif dont le couple et la puissance résultent d'une chaîne thermodynamique et mécanique complète, cet accord est considéré comme **cohérent avec l'objectif pédagogique du projet**.

Il ne constitue pas une preuve que chaque grandeur interne correspond exactement à un véritable 3S-GTE.

La conclusion retenue est donc :

> **Le modèle reproduit de manière qualitative et cohérente les performances globales publiées du 3S-GTE ST205, tout en conservant explicitement les limites liées aux paramètres estimés, aux calibrations et à l'absence de données expérimentales détaillées.**
