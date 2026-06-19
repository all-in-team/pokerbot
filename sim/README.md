# sim/ — cœur du simulateur de poker 6-max

Moteur de jeu + interface de cerveaux (`BotBrain`) + un `BaselineBrain`, qui
simule des mains 6-max complètes et émet un **journal d'événements JSON**.
Vérifiable seul, sans front.

## Installation

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r sim/requirements.txt
```

(Le repo a été développé avec `pokerkit==0.7.4`.)

## Lancer

```bash
python -m sim.run --hands 5 --seed 1          # 5 mains déterministes -> JSON
python -m sim.run --hands 3 --seed 1 --pretty # JSON indenté
python -m sim.run --hands 10 --stack 200      # tapis de départ paramétrable
```

Sortie : `{"hands": N, "events": [ ... ]}` sur stdout.

## Structure

| Fichier | Rôle |
|---|---|
| `engine.py` | Moteur (pokerkit) : antes/blinds, enchères, all-in, **side pots**, abattage, attribution, rotation du bouton. Pilote la boucle de simulation et émet les événements. |
| `events.py` | **Le contrat** avec le futur rejoueur front : fabriques d'événements typés. |
| `brains/base.py` | `DecisionContext`, `Action`, `LegalActions`, `BotBrain` (Protocol), `SeatConfig`. |
| `brains/baseline.py` | `BaselineBrain` : charts préflop par position (structure ante) + heuristique postflop. **Baseline assumé, pas optimal** (chaque approximation est marquée `TODO(approx)`). |
| `run.py` | CLI. |

## Structure de jeu

6 joueurs, **$1 / $2**, **ante $2 pour tout le monde**, tapis 100 bb ($200) par
défaut (paramétrable). Compta préflop : antes `6×2 = 12` + SB `1` + BB `2` = **15**.

Les sièges (0..5) sont **stables** entre les mains ; c'est le **bouton** qui
tourne. Cash game : un siège ruiné se **recave** au tapis de départ *entre* les
mains (option `allow_rebuy`, hors conservation intra-main).

## Le journal d'événements (contrat front)

Liste ordonnée d'événements typés ; assez d'info pour **animer** une main sans
rejouer la logique. Voir `events.py` pour la forme exacte de chaque type.

```
hand_start  · post_ante · post_blind · deal_hole · action · deal_board
showdown    · award     · hand_end
```

- `action.amount` : montant suivi (call) ou montant TOTAL « jusqu'à » (raise/all-in).
- `action.pot_after` : total au milieu après l'action (mises courantes incluses).
- `award.amount` : gain net depuis le pot nommé (`main`, `side_1`, …) — exclut les
  mises non suivies rendues au joueur.

## Écrire un cerveau

```python
from sim.brains import BotBrain, DecisionContext, Action

class MonBot(BotBrain):
    def decide(self, ctx: DecisionContext) -> Action:
        if ctx.to_call == 0:
            return Action.check()
        return Action.fold()
```

Assignation par siège :

```python
from sim.brains import SeatConfig
from sim.engine import PokerEngine
seats = SeatConfig({0: MonBot(), 1: BaselineBrain(), ...})
PokerEngine(seat_config=seats, seed=1).run(100)
```

## Tests

```bash
pytest                       # depuis la racine du repo
```

- `tests/test_pot_accounting.py` : compta antes+blinds (=15) et conservation des jetons.
- `tests/test_side_pots.py` : all-in multiway, tailles de side pots déterministes.

Garde-fous internes au moteur (actifs à chaque main) : **conservation** des
jetons (somme constante) et **réconciliation** des `award` avec les mouvements
réels de tapis de pokerkit (y compris partages de pots impairs).
```
