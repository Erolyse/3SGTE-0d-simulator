# Documentation technique — 3S-GTE 0D Engine Simulator

## 1. Positionnement

Le projet est un simulateur moteur 0D temps réel inspiré du Toyota 3S-GTE ST205.

Il vise à représenter une chaîne physique cohérente depuis les écoulements gazeux jusqu’au couple au vilebrequin :

```text
débits gazeux
→ masse d’air piégée
→ combustion
→ pression cylindre
→ travail P·dV
→ IMEP
→ couple indiqué
→ pompage et pertes mécaniques
→ couple au vilebrequin
→ puissance
```

Il ne s’agit pas :

- d’une table `régime → couple` ;
- d’un modèle constructeur Toyota ;
- d’un jumeau numérique certifié ;
- d’un modèle CFD ;
- d’un modèle 1D de propagation d’ondes ;
- d’un outil de calibration ECU ;
- d’un résultat expérimental.

L’objectif principal est la construction d’un modèle structuré, observable et vérifiable.

---

## 2. Géométrie moteur

| Paramètre | Valeur utilisée |
|---|---:|
| Architecture | 4 cylindres en ligne |
| Cylindrée calculée | environ 1 998,2 cm³ |
| Alésage | 86 mm |
| Course | 86 mm |
| Longueur de bielle | 138 mm |
| Rapport volumétrique | 8,5:1 |
| Cylindrée unitaire | environ 499,6 cm³ |
| Volume mort unitaire | environ 66,6 cm³ |
| Ordre d’allumage | 1-3-4-2 |
| Cycle moteur | 720° vilebrequin |
| Distribution | 16 soupapes |

La position du piston est calculée avec la géométrie bielle-manivelle exacte.

Le volume instantané dépend de l’angle vilebrequin et le couple gazeux utilise le bras de levier analytique `dx/dθ`.

---

## 3. Méthode numérique

### 3.1 API temporelle et sous-pas angulaire

L’API externe reçoit un pas en secondes.

Les sous-pas internes sont choisis selon :

- l’angle vilebrequin ;
- la combustion ;
- les événements de soupapes ;
- une limite temporelle.

Configuration nominale :

| Zone | Pas cible |
|---|---:|
| Cycle général | 0,50° CA |
| Combustion | 0,35° CA |
| Événements de soupapes | 0,20° CA |
| Limite temporelle | 0,1 ms |

Cette stratégie maintient une résolution angulaire comparable lorsque le régime augmente.

### 3.2 Événements visés

Le solveur cherche à tomber au plus près sur :

- ouverture admission ;
- fermeture admission ;
- ouverture échappement ;
- fermeture échappement ;
- début de combustion ;
- fin de combustion ;
- transitions de cycle.

### 3.3 Résolution d’affichage

Les cycles exportés sont rééchantillonnés à pas fixe :

```text
0,0°
0,5°
1,0°
...
720,0°
```

Soit 1 441 points pour un pas de 0,5°.

Le rééchantillonnage sert à l’affichage et à l’export. Les diagnostics de référence doivent, lorsque cela est possible, conserver également les intégrations sur données brutes.

---

## 4. Volumes 0D et stocks conservés

Les éléments suivants sont représentés comme des volumes concentrés :

- collecteur d’admission ;
- volume de suralimentation ;
- intercooler équivalent ;
- quatre cylindres ;
- deux scrolls d’échappement ;
- volumes liés au turbocompresseur.

Chaque volume suit au minimum :

- masse gazeuse ;
- énergie interne ;
- pression ;
- température ;
- flux massiques entrants et sortants ;
- enthalpie transportée.

Les diagnostics de conservation sont passifs : ils mesurent les fermetures sans modifier la physique pour masquer un défaut.

---

## 5. Écoulements compressibles

Les débits sont calculés à partir de :

- pression amont ;
- pression aval ;
- température ;
- section effective ;
- coefficient de décharge ;
- rapport de pression critique.

Le modèle traite :

- écoulement subsonique ;
- écoulement étranglé ;
- inversion de débit ;
- transport d’enthalpie.

Les sections effectives représentent des géométries équivalentes lorsqu’aucune donnée mesurée n’est disponible.

---

## 6. Distribution

Les soupapes disposent de lois de levée dépendant de l’angle.

Le modèle distingue :

- nombre de soupapes ;
- diamètre de soupape ;
- levée ;
- aire de rideau ;
- section de conduit ;
- coefficient de décharge ;
- événements d’ouverture et de fermeture.

Les lois exactes du 3S-GTE n’étant pas intégralement disponibles, certaines grandeurs sont estimées ou calibrées.

Une fermeture géométrique à levée nulle ne constitue pas une preuve d’étanchéité réelle. Un futur modèle de fuite devrait utiliser un débit massique.

---

## 7. Thermodynamique cylindre

### 7.1 Premier principe

Lorsque les soupapes sont fermées :

```text
dU = dQ_combustion - dQ_parois - P dV
```

L’énergie interne et la masse gazeuse sont les états principaux.

Pression et température sont recalculées depuis :

- énergie interne ;
- masse ;
- volume instantané ;
- propriétés thermodynamiques moyennes.

### 7.2 Combustion

La fraction brûlée suit une loi de Wiebe.

Le modèle suit notamment :

- début d’allumage ;
- CA10 ;
- CA50 ;
- CA90 ;
- durée de combustion ;
- dégagement de chaleur ;
- pic de pression ;
- température maximale.

Il ne résout pas :

- chimie détaillée ;
- cliquetis ;
- émissions ;
- front de flamme spatial ;
- hétérogénéités locales ;
- variation cycle à cycle réelle.

### 7.3 Transfert thermique

Le transfert thermique moyen est inspiré de corrélations de type Woschni.

Le modèle distingue des températures de paroi équivalentes pour :

- culasse ;
- piston ;
- chemise.

Ces températures restent des représentations 0D, pas un calcul thermique de structure.

---

## 8. Travail, IMEP et couple

### 8.1 Diagramme P-V

Le diagramme P-V est conservé dans l’ordre du cycle.

Les points ne doivent jamais être triés par volume.

Deux domaines sont distingués :

```text
cycle fermé : IVC → compression → combustion → détente → EVO
pompage : EVO → 720° → 0° → IVC
```

Le travail est intégré par trapèzes :

```text
W = ∮ P dV
```

Puis :

```text
IMEP = W / cylindrée unitaire
```

Pour quatre cylindres et un moteur quatre temps :

```text
couple indiqué =
travail par cylindre × 4 / 4π
```

### 8.2 Couple instantané

La force gazeuse est obtenue depuis la pression cylindre relative à la pression de référence.

Le couple instantané est séparé en :

- couple du cycle fermé ;
- couple de pompage signé ;
- frottements ;
- accessoires ;
- couple net au vilebrequin.

La fermeture mécanique vérifie :

```text
couple cycle fermé
+ pompage signé
= couple indiqué
```

La fermeture IMEP vérifie :

```text
IMEP cycle fermé
+ PMEP signé
= IMEP net
```

### 8.3 Comparaison indépendante

Le couple issu du diagramme P-V est comparé au couple obtenu depuis les efforts sur le vilebrequin.

Cette comparaison vérifie notamment :

- géométrie ;
- convention de signe ;
- intégration ;
- cohérence pression-volume ;
- moyenne angulaire ;
- fermeture du cycle.

À la résolution nominale, l’écart actuel reste voisin de 0,6 %, ce qui déclenche un avertissement interne si la cible est fixée à 0,5 %.

---

## 9. Pertes mécaniques

Les pertes sont séparées en :

- pompage ;
- frottements ;
- accessoires.

Le frottement est représenté par une FMEP dépendant notamment :

- du régime ;
- de la vitesse moyenne du piston ;
- d’un terme quadratique ;
- de la charge ;
- des accessoires.

Les paramètres sont semi-empiriques et doivent idéalement être calibrés sur un essai de motoring indépendant.

---

## 10. Turbocompresseur

### 10.1 Dynamique d’arbre

Le rotor suit :

```text
J · dω/dt =
couple turbine
− couple compresseur
− pertes
```

Le régime turbo n’est pas imposé par le régime moteur.

### 10.2 Turbine

Le modèle twin-entry sépare :

- scroll 1 : cylindres 1 et 4 ;
- scroll 2 : cylindres 2 et 3.

Il représente :

- débit turbine ;
- énergie disponible dans les gaz ;
- puissance mécanique turbine ;
- efficacité dépendant du débit et du régime ;
- wastegate ;
- contre-pression ;
- inertie thermique d’échappement.

### 10.3 Compresseur

Le compresseur utilise un modèle analytique simplifié :

- travail d’Euler équivalent ;
- rapport de pression ;
- débit ;
- rendement ;
- limitation de débit ;
- température de sortie ;
- puissance absorbée.

Le modèle ne repose pas sur une carte CT20B constructeur mesurée.

Les dégradations hors zone optimale doivent rester progressives et conserver un bilan de puissance cohérent.

### 10.4 Intercooler et volume de charge

Le système suit :

- pression avant papillon ;
- pression collecteur ;
- température après intercooler ;
- efficacité intercooler ;
- masse et énergie du volume de charge ;
- bypass compresseur.

---

## 11. Banc moteur

Modes disponibles :

- inertiel ;
- frein commandé ;
- maintien de régime.

Le modèle tient compte de :

- inertie moteur ;
- transmission ;
- roues ;
- rouleaux ;
- pertes de chaîne ;
- charge routière optionnelle ;
- couplage progressif.

L’inertie affichée est une inertie équivalente ramenée au vilebrequin.

---

## 12. Ordre d’un sous-pas

L’orchestrateur exécute les modules dans un ordre causal :

```text
commande moteur
→ coupure d’injection
→ avancement du vilebrequin
→ géométrie
→ admission
→ échappement
→ turbo
→ thermodynamique cylindre fermé
→ couple vilebrequin
→ banc
→ transitions d’état
→ consommation
→ diagnostics
→ télémétrie
→ enregistrement du cycle
```

Cet ordre fait partie de la définition numérique du modèle.

---

## 13. Provenance des paramètres

### 13.1 Données imposées

Exemples :

- architecture quatre cylindres ;
- alésage ;
- course ;
- rapport volumétrique ;
- ordre d’allumage ;
- culasse 16 soupapes ;
- architecture twin-entry ;
- ordres de grandeur de performance.

Ces valeurs doivent être reliées à des sources bibliographiques.

### 13.2 Valeurs estimées

Exemples :

- longueur de bielle ;
- diamètres et levées de soupapes ;
- sections de conduits ;
- papillon ;
- volumes de collecteurs ;
- volume de charge ;
- dimensions équivalentes du turbo ;
- sections de wastegate ;
- inerties.

Ces valeurs sont des hypothèses remplaçables.

### 13.3 Paramètres calibrés

Exemples :

- coefficients de décharge ;
- rendement de combustion ;
- durée de Wiebe ;
- efficacité turbine à faible débit ;
- inertie turbo ;
- pertes d’arbre ;
- commande de wastegate ;
- conductances thermiques ;
- frottements ;
- accessoires ;
- banc.

La calibration ajuste des paramètres internes aux équations.

Elle ne doit pas devenir une correction directe du type :

```js
torque *= targetCurve[rpm];
```

### 13.4 Gardes numériques

Exemples :

- pressions minimales ;
- températures minimales ;
- limites de transfert par sous-pas ;
- saturations ;
- plafonds de rendement ;
- limites de vitesse ;
- seuils de diagnostic.

Ces constantes doivent être distinguées des paramètres physiques.

---

## 14. Tir de référence déterministe

Le protocole automatique :

1. crée une nouvelle instance moteur ;
2. applique un état initial complet et reproductible ;
3. stabilise le système pendant un temps simulé fixé ;
4. applique une rampe de papillon dépendant du temps simulé ;
5. effectue le tir inertiel ;
6. établit un point régulé ;
7. attend la stabilité ;
8. capture le nombre requis de cycles ;
9. calcule la répétabilité ;
10. relance l’état à plusieurs résolutions ;
11. calcule la convergence ;
12. enregistre la session et le rapport.

Le protocole est indépendant de `requestAnimationFrame`.

Un ordinateur plus lent peut prendre plus de temps réel sans modifier la loi de commande imposée au moteur.

### 14.1 État à réinitialiser

La reproductibilité exige de remettre à zéro ou reconstruire :

- cylindres ;
- collecteurs ;
- charge pipe ;
- scrolls ;
- températures ;
- turbo ;
- régulateurs ;
- wastegate ;
- bypass ;
- filtres ;
- banc ;
- compteurs ;
- historique de cycles ;
- accumulateurs de télémétrie.

La création d’une nouvelle instance complète est préférable à une réinitialisation partielle.

---

## 15. Vérification numérique et validation externe

### 15.1 Vérification numérique

Question :

> Les équations implémentées et les bilans internes sont-ils cohérents entre eux ?

Contrôles automatiques :

- couverture 0–720° ;
- résolution ;
- continuité angulaire ;
- absence de valeurs invalides ;
- cohérence géométrique ;
- PMH et PMB ;
- cylindrée reconstruite ;
- ordre des événements de combustion ;
- position du pic de pression ;
- événements de distribution ;
- fermeture du couple ;
- sens du travail thermodynamique ;
- fermeture IMEP ;
- cohérence P-V / vilebrequin ;
- stabilité du point ;
- répétabilité ;
- convergence angulaire ;
- plage de pression ;
- plage de température ;
- conservation masse et énergie.

### 15.2 Statuts

- **Validé** : critère satisfait ;
- **Avertissement** : résultat exploitable mais hors cible nominale ;
- **Échec** : critère bloquant non satisfait ;
- **Non exécuté** : données insuffisantes ou protocole non lancé.

Un contrôle non exécuté ne doit jamais être présenté comme validé.

### 15.3 Répétabilité

Sur plusieurs cycles, calcul de :

- moyenne ;
- écart-type ;
- coefficient de variation ;
- minimum ;
- maximum.

Grandeurs suivies :

- IMEP ;
- travail P-V ;
- couple ;
- pic de pression ;
- CA50 ;
- régime moyen.

### 15.4 Convergence angulaire

Résolutions :

```text
1,00°
0,50°
0,25°
```

Grandeurs comparées :

- travail P-V ;
- IMEP ;
- couple indiqué ;
- pic de pression ;
- angle du pic ;
- CA50.

Le but est de justifier le compromis coût/précision.

### 15.5 Validation externe

Question :

> Le modèle représente-t-il suffisamment bien le moteur réel ?

Données souhaitables :

- banc moteur mesuré ;
- pression cylindre instrumentée ;
- débit d’air ;
- MAP et EMAP ;
- température d’admission ;
- EGT ;
- régime turbo ;
- position wastegate ;
- données constructeur fiables.

La validation externe reste incomplète.

---


## 16. Campagne multipoint automatique

Une campagne déterministe couvre plusieurs zones de fonctionnement :

- ralenti ;
- charge légère ;
- charge intermédiaire ;
- pleine charge autour de la zone de spool ;
- point pleine charge de référence ;
- zone de puissance ;
- haut régime.

Chaque point suit le même protocole :

```text
mise en régime
→ application de la charge
→ attente de stabilité
→ contrôle régime / boost / turbo
→ capture de plusieurs cycles
→ calcul des métriques
→ vérification P-V
→ conservation
```

### 16.1 Stabilité

Le régime moteur seul ne suffit pas à qualifier un point stabilisé.

Selon le scénario, les critères incluent également :

- variation de régime ;
- variation de boost ;
- dérivée du boost ;
- variation de régime turbo ;
- puissance nette rotor ;
- répétabilité multicyle.

Cette précaution évite par exemple de capturer un moteur stabilisé en régime alors que le turbo continue encore d’accélérer.

### 16.2 Faibles signaux

À faible couple ou faible régime turbo, un pourcentage relatif peut devenir trompeur.

Des critères absolus ou hybrides sont donc utilisés lorsque nécessaire.

Exemple :

```text
écart P-V relatif relativement élevé au ralenti
mais écart absolu en couple très faible
```

---

## 17. Campagne transitoire automatique

Les scénarios dynamiques réutilisent des états déterministes issus de la campagne multipoint.

### 17.1 Montée en charge et spool

Mesures :

- temps commande → boost cible ;
- temps de montée effectif ;
- surpression maximale ;
- régime turbo maximal ;
- résidus masse / énergie.

### 17.2 Wastegate

Mesures :

- ouverture effective ;
- débit dérivé ;
- délai pression → ouverture ;
- boost maximal régulé ;
- régime turbo maximal.

Le test vérifie qu’une commande de wastegate produit effectivement une dérivation de débit.

### 17.3 Lever de pied sous boost

Mesures :

- ouverture du bypass ;
- chute du boost ;
- activation de la coupure d’injection ;
- consommation après coupure ;
- couple de frein moteur ;
- décélération de l’arbre turbo ;
- résidus numériques.

### 17.4 Reprise de charge

Mesures :

- fermeture du bypass ;
- reconstruction du boost ;
- overshoot ;
- régime turbo maximal.

### 17.5 Rupteur

Mesures :

- activation de la coupure ;
- suppression des injections ;
- dépassement maximal ;
- retour sous le seuil de reprise ;
- événement enregistré ;
- hystérésis ;
- résidus numériques.

---

## 18. Référence versionnée et non-régression

Une exécution déterministe complète peut être enregistrée comme référence comportementale.

La référence contient des métriques issues :

- du banc moteur ;
- du cycle de référence ;
- de la répétabilité ;
- de la convergence ;
- de la fermeture P-V ;
- des résidus ;
- de la campagne multipoint ;
- des scénarios transitoires.

### 18.1 Comparaison

Chaque exécution suivante est comparée indicateur par indicateur :

```text
référence
actuel
écart
tolérance
statut
```

Les statuts utilisés sont :

```text
Conforme
Variation
Régression
Non comparé
```

### 18.2 Tolérances

Les tolérances dépendent de la grandeur :

- tr/min ;
- N·m ;
- bar ;
- °CA ;
- temps ;
- pourcentage ;
- résidu.

Pour les métriques où « plus faible est meilleur », la comparaison porte sur la **dégradation** plutôt que sur la simple variation.

### 18.3 Promotion de référence

Une modification du modèle ne remplace jamais automatiquement la baseline.

La promotion d’une nouvelle référence est une action explicite après analyse de la campagne.

La référence représente une version qualifiée du **comportement logiciel** et non une vérité expérimentale.

### 18.4 Limite

Une mauvaise baseline peut être reproduite parfaitement.

La non-régression complète donc la vérification interne et la validation externe, mais ne les remplace pas.

---

## 19. Conservation de masse et d’énergie

Les diagnostics reconstruisent les stocks et flux sur chaque sous-pas.

Domaines couverts :

- cylindres ;
- admission ;
- volume de charge ;
- échappement ;
- parois associées.

Indicateurs recommandés :

- pire résidu instantané ;
- résidu moyen signé ;
- erreur cumulée ;
- seuil d’acceptation ;
- phase stabilisée ou transitoire.

Les corrections numériques explicites doivent rester séparées des résidus.

---

## 20. Interface

### 20.1 Viewer principal

Le viewer présente :

- pistons ;
- bielles ;
- vilebrequin ;
- soupapes ;
- combustion ;
- flux ;
- turbo ;
- instrumentation essentielle.

Le ralenti visuel ne ralentit pas la physique.

Il rejoue un cycle enregistré et interpolé.

### 20.2 Analyse & Validation

Onglets :

- vue d’ensemble ;
- banc moteur ;
- cycle cylindre ;
- diagramme P-V ;
- turbocompresseur ;
- bilans numériques ;
- validation et sensibilité.

La page distingue :

- données imposées ;
- estimations ;
- calibrations ;
- résultats ;
- avertissements ;
- tests de convergence ;
- répétabilité.

---

## 21. Architecture logicielle

```text
assets/numericalTwin/
├── engine/
│   ├── Engine.js
│   └── EngineState.js
├── Geometry/
├── Numerics/
├── Physics/
├── Intake/
├── Exhaust/
├── Valvetrain/
├── Thermodynamics/
├── Crankshaft/
├── Turbo/
├── Fuel/
├── EngineControl/
├── Dyno/
├── Telemetry/
├── Cycle/
├── Diagnostics/
├── Analysis/
├── Three/
├── main.js
└── analysis.js
```

Évolutions recommandées :

- Web Worker ;
- TypeScript ;
- centralisation des unités ;
- tests unitaires ;
- format de session versionné ;
- CI de non-régression.

---

## 22. Technologies

- JavaScript moderne ;
- modules ES ;
- Symfony ;
- Twig ;
- Three.js ;
- Chart.js ;
- CSS personnalisé ;
- WebGL ;
- scripts de test hors interface.

---

## 23. Performances

Optimisations déjà appliquées :

- calcul physique en blocs ;
- budget CPU par frame ;
- télémétrie décimée ;
- réutilisation de tableaux ;
- réduction des allocations ;
- fréquence de rafraîchissement limitée ;
- suspension des graphiques hors écran ;
- résolution Three.js contrôlée ;
- diagnostics coûteux échantillonnés ;
- cycle visuel décimé.

Le déplacement de la physique dans un Web Worker reste une priorité.

---

## 24. Limites

Le modèle ne résout pas :

- propagation d’ondes 1D ;
- champs 3D ;
- chimie détaillée ;
- cliquetis ;
- émissions ;
- films de carburant ;
- blow-by détaillé ;
- variations cycle à cycle réelles ;
- circuit d’huile ;
- refroidissement complet ;
- déformation ;
- contraintes ;
- distribution flexible ;
- carte turbo constructeur exacte ;
- ECU Toyota complète.

Les propriétés thermodynamiques sont moyennées.

Une calibration satisfaisante ne rend pas le jeu de paramètres unique.

---

## 25. Développement technique assisté par IA

Le projet a été développé avec un usage important de ChatGPT comme outil de génération, d’exploration, de refactorisation et de documentation.

### 25.1 Usages

L’assistance a notamment porté sur :

- propositions d’architecture ;
- génération de modules ;
- traduction d’équations en code ;
- interfaces ;
- stratégies de validation ;
- diagnostics ;
- refactorisation ;
- optimisation ;
- documentation.

### 25.2 Risques considérés

Les principaux risques identifiés sont :

- code plausible mais physiquement faux ;
- paramètre inventé ou mal justifié ;
- erreur de signe ;
- incohérence d’unité ;
- double comptage d’un flux ;
- test circulaire ;
- dépendance cachée à l’ordre d’appel ;
- état non réinitialisé ;
- correction artificielle d’une sortie ;
- régression silencieuse.

### 25.3 Principe de travail

Une sortie générée n’est pas considérée comme correcte par défaut.

Elle devient acceptable après combinaison de plusieurs contrôles :

```text
compréhension du rôle du module
+ contrôle des unités
+ bilan physique
+ observation des courbes
+ essai déterministe
+ répétabilité
+ convergence
+ comparaison indépendante
+ non-régression
```

### 25.4 Responsabilité de conception

Le travail de conception, d’intégration et de qualification porte sur :

- les objectifs ;
- les hypothèses ;
- le choix des sous-modèles ;
- l’architecture ;
- la causalité numérique ;
- la provenance des paramètres ;
- les critères d’acceptation ;
- la construction des campagnes automatiques ;
- la détection des comportements non physiques ;
- l’analyse critique ;
- la décision de conserver ou rejeter une correction ;
- la documentation des limites.

L’intérêt du projet n’est donc pas de démontrer que chaque ligne a été écrite manuellement.

Il cherche à montrer qu’un développement technique fortement assisté par IA peut rester **compréhensible, reproductible, falsifiable et contrôlé par des méthodes d’ingénierie**.

---

## 26. Avertissement

Le projet est pédagogique.

Il ne doit pas être utilisé pour :

- régler un moteur réel ;
- dimensionner une pièce ;
- modifier un ECU ;
- prendre une décision de sécurité ;
- annoncer des performances certifiées.

---

## 27. Feuille de route

### Scientifique

- sources bibliographiques ;
- mesures externes ;
- incertitudes ;
- sensibilité ;
- séparation calibration/validation ;
- référence versionnée.

### Logicielle

- Web Worker ;
- TypeScript ;
- tests unitaires ;
- CI ;
- version des sessions ;
- gestion d’erreurs ;
- unités centralisées.

### Visualisation

- soupapes ;
- flux ;
- combustion ;
- température échappement ;
- turbo ;
- wastegate ;
- bypass ;
- replay synchronisé.

---

## 28. Conclusion

La valeur du projet repose sur la démarche :

```text
modéliser
→ observer
→ instrumenter
→ douter
→ tester
→ comparer
→ corriger
→ versionner
→ documenter
```

La vérification interne peut démontrer que l’implémentation est cohérente.

La validation externe reste nécessaire pour conclure sur la fidélité exacte au moteur réel.
