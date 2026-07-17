# Calculette Efficity — Suivi technique

PWA de calcul de commission : TTC → HT → rétrocession Efficity → URSSAF → net.
Repo : `ASTRA7225/Calc-efficity-com` · Live : `https://astra7225.github.io/Calc-efficity-com/`

---

## Règles métier encodées (à vérifier chaque année)

| Paramètre | Valeur | Où dans le code |
|---|---|---|
| TVA | 20 % | `const TVA` |
| Cotisations sociales BNC/SSI | 25,6 % | `const URSSAF` |
| CFP (formation pro) | 0,1 % | `const CFP` |
| Versement libératoire IR (BNC) | 2,2 % | `const VLIR` |
| **Total URSSAF avec VL** | **27,9 %** | — |
| Abattement micro-BNC (si pas de VL) | 34 % | `const ABATT` |
| Plafond micro-BNC | 77 700 € HT | `const PLAFOND` |

**Barème de rétrocession Efficity** (`const PALIERS`) — **par tranche** de CA HT cumulé annuel :

| Tranche de CA HT cumulé | Taux reversé |
|---|---|
| 0 → 25 000 € | 70 % |
| 25 000 → 50 000 € | 78 % |
| 50 000 → 150 000 € | 90 % |
| 150 000 € et + | 100 % |

> ⚠️ **Le barème est progressif, pas à seuil.** Une vente qui franchit un seuil est découpée :
> la part de son HT sous le seuil est payée à l'ancien taux, la part au-dessus au nouveau.
> Une seule vente peut donc porter 2, 3 ou 4 taux (`decouper()`).
>
> ⚠️ **À confirmer auprès d'Efficity** : le barème est-il bien progressif par tranche, ou
> à seuil global (tout le CA repayé au nouveau taux une fois le seuil franchi) ? Les deux
> lectures existent chez les réseaux. Le code implémente la progressive.
>
> 📌 **Sens de lecture du barème** : les taux ci-dessus sont la part **reversée à l'agent**.
> La part Efficity est le complément (30 % / 22 % / 10 % / 0 %). Confusion déjà rencontrée —
> `PALIERS[].taux` = ce que touche l'agent, jamais ce que garde le réseau.

---

## Architecture

Aucune dépendance, aucun build :

```
index.html      ← tout : HTML + CSS + JS inline
manifest.json   ← config PWA (nom, icônes, couleurs)
sw.js           ← service worker (cache offline)
test.js         ← suite de tests headless (jsdom)
CHANGELOG.md    ← ce fichier
```

**Modèle de données** : `localStorage`, clé `efficity-calc-v2`.

```json
{
  "report": 20000,
  "ventes": [ { "id": 1784..., "ttc": 30000, "date": "2026-07-17" } ],
  "vlir": true,
  "annee": 2026
}
```

### Principe : une seule source de vérité

Seuls le **TTC** et la **date** d'une vente sont stockés. Tout le reste — HT, TVA, tranches
de palier, rétrocession, cotisations, net — est **dérivé à chaque rendu** par `calcAnnee()`,
qui rejoue les ventes **dans l'ordre** en propageant le cumul :

```
calcAnnee()
  └── pour chaque vente, dans l'ordre :
        calcVente(ttc, cumulAvant)
          ├── ht = ttc / 1,20
          ├── decouper(cumulAvant, ht)  → [{ montant, taux }, …]
          ├── retro = Σ montant × taux
          ├── urssaf = retro × (25,6 % + 0,1 % + 2,2 % si VL)
          └── net = retro − urssaf
        cumul += ht
```

**Conséquence** : éditer la vente n°2 réévalue automatiquement les paliers des ventes n°3+.
Aucun montant n'est figé, aucun cumul n'est stocké.

**L'ordre de la liste détermine les paliers.** Il est manuel (boutons ↑ / ↓), pas
auto-trié par date : la date est informative. `report` est le CA HT antérieur à l'usage
de l'app et sert de cumul de départ.

---

## ⚠️ Piège n°1 : le cache du service worker

`sw.js` met `index.html` en cache. **Toute modification de `index.html` impose de bumper
`const CACHE` dans `sw.js`** (`efficity-v5` → `efficity-v6`), sinon l'app continue de servir
l'ancienne version et le changement semble ne pas avoir été pris en compte.

Les deux fichiers doivent être ré-uploadés ensemble.

Forcer la mise à jour sur iPhone : fermer complètement l'app (sélecteur d'apps), rouvrir.

## ⚠️ Piège n°2 : le re-rendu à chaque frappe

`render()` reconstruit toute la liste à chaque `input`. Le focus et la position du curseur
sont restaurés via l'attribut `data-focuskey`. **Tout nouvel `<input>` dans la liste doit
porter un `data-focuskey` unique**, sinon le champ perd le focus dès la première frappe.

---

## Tests

`node test.js` (nécessite `npm i jsdom`). 72 assertions, 11 groupes :
découpage des tranches · cascade d'une vente · vente à cheval · toggle VL · chaînage annuel ·
report initial · effet de l'ordre · persistance et migration v1→v2 · parsing des montants
(virgules, espaces insécables) · parcours UI complet · cohérence comptable sur 100 tirages
aléatoires (TTC = HT + TVA, HT = rétro + Efficity, rétro = net + URSSAF, Σtranches = HT).

---

## Historique

### v5 — 17/07/2026 — refonte du moteur de calcul

- **Barème progressif par tranche.** Une vente qui franchit un seuil est découpée et porte
  plusieurs taux (`decouper()`). Avant, elle était intégralement payée au palier atteint
  *avant* la vente — sous-évaluation dès qu'un seuil était franchi.
- **Le calcul est fait par vente**, plus sur un « TTC en cours » séparé de la liste.
  Chaque ligne est dépliable et affiche sa cascade complète : TTC → TVA → HT →
  tranches détaillées → rétrocession → part Efficity → cotisations → CFP → VL → net.
- **Recalcul en chaîne** : éditer ou réordonner une vente réévalue les paliers des suivantes.
- Seul le TTC est stocké ; le HT n'est plus persisté (il était dupliqué, donc désynchronisable).
- Réordonnancement manuel (↑ / ↓), date éditable, suppression par ligne.
- Section « Total de l'année » : TTC, TVA, CA HT, rétrocessions, taux moyen annuel, URSSAF, net.
- Export CSV (une ligne par vente, détail des tranches inclus).
- Alerte à l'approche du plafond micro-BNC (85 %) et au dépassement.
- Saisie tolérante : virgule décimale, espaces, espaces insécables.
- Migration automatique `efficity-calc-v1` → `v2` (dates `jj/mm/aa` → ISO).
- Suite de tests headless étendue à 72 assertions.

### v4 — 17/07/2026
- **Liste détaillée des ventes** composant le cumul, avec édition du TTC et suppression ligne par ligne
- Le cumul devient **calculé** (report + ventes) au lieu d'être saisi à la main
- Nouveau champ « Report » pour le CA antérieur à l'usage de l'app
- Migration automatique de l'ancien champ `cumul` → `report`

### v3 — 17/07/2026
- Correctif : le TTC était restauré à `0` au démarrage, ce qui affichait des zéros partout
  et donnait l'impression que les calculs ne se faisaient plus
- État explicite « Aucune vente en cours » quand le champ TTC est vide

### v2 — 17/07/2026
- Persistance `localStorage` (cumul, TTC, toggle VL)
- Bouton « Valider cette vente » (incrémentait alors un cumul opaque)
- Bouton de remise à zéro + reset automatique au 1er janvier

### v1 — 03/06/2026
- Version initiale : calcul en cascade, barème Efficity, PWA installable offline
- VL IR activé par défaut (situation d'Anthony)

---

## Pistes non traitées

- Icônes PNG (192/512) absentes → icône générique sur l'écran d'accueil
- CFE non intégrée (due à partir de la 2ᵉ année)
- Tri automatique par date (aujourd'hui l'ordre est manuel et fait foi)
- Pas de suivi de la TVA réellement déclarée / reversée (l'app la calcule mais ne la pilote pas)
- Aucun archivage des années précédentes : le 1er janvier efface tout après le reset
