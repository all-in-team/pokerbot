# Pokerhubot — Architecture (Simulateur « Watch & Learn »)

## Vision
Simulateur **6-max NLHE en $1/$2 ante $2** : des bots jouent des mains complètes
entre eux, l'utilisateur **regarde pour apprendre**. Un seul style cible : **le
plus optimal possible** (max-EV), poursuivi via un **agent neuronal** (long
terme), avec un **cerveau baseline/GTO en filet de sécurité**.

Hors périmètre, explicitement : aucun jeu humain assisté en direct, aucun RTA,
pas de commentaire LLM. C'est un bac à sable d'observation.

## Principe d'ancrage (non négociable)
La décision d'un bot vient **toujours** d'une source de stratégie explicite (le
`BotBrain`), **jamais** inventée par un LLM. Vérité = moteur + cerveau.

## Décision d'archi : tout le « cerveau » tourne en Python
- pokerkit (moteur) est en Python ; le futur agent neuronal (PyTorch) aussi.
- Donc un **service de simulation Python** fait tourner le moteur + les cerveaux
  et émet un **journal d'événements (JSON)** pour une main complète.
- Le **front (Next/React)** est un pur **rejoueur** : il anime le journal sur la
  table 6-max existante (play / pause / step / reveal). Il n'a pas besoin de
  connaître le `BotBrain`.
- Avantage : pas d'aller-retour par décision (la main entière est simulée côté
  serveur, le client l'anime), et l'agent neuronal se branche dans le même
  service.

## Composants
1. **Moteur** (pokerkit) — cycle de vie d'une main : antes/blinds, tours
   d'enchères, all-in, **side pots**, abattage, évaluation, attribution,
   rotation du bouton.
2. **`BotBrain`** — interface de décision pluggable (le keystone).
3. **Journal d'événements** — contrat moteur → rejoueur.
4. **Rejoueur** (front) — la table 6-max réutilisée + contrôles.
5. *(plus tard)* **Agent neuronal**, comme implémentation de `BotBrain`.

## Le keystone : l'interface BotBrain
```python
@dataclass
class DecisionContext:
    hole_cards: tuple[str, str]
    board: list[str]                  # 0, 3, 4 ou 5 cartes
    street: str                       # preflop | flop | turn | river
    pot: int
    to_call: int
    legal_actions: list[LegalAction]  # avec min/max raise
    position: str                     # BB, SB, BTN, ...
    stacks: dict[str, int]
    action_history: list[dict]

class BotBrain(Protocol):
    name: str
    def decide(self, ctx: DecisionContext) -> Action: ...
```

Implémentations :
- **`BaselineBrain`** — charts préflop (pour la structure 1/2 ante 2) +
  heuristiques postflop simples. Fait tourner le sim aujourd'hui. *Baseline, pas
  optimal — assumé.*
- **`GtoLookupBrain`** *(prévu)* — lookup de la solution précalculée la plus
  proche. Ton **filet de sécurité** quand un siège galère.
- **`NeuralBrain`** *(prévu)* — l'agent entraîné.

Un `SeatConfig` assigne un cerveau par siège : le même partout pour « un seul
style optimal », ou mixte pour tester (ex. neuronal vs baseline).

## Flux
Le moteur distribue → à chaque décision il construit un `DecisionContext` →
demande au cerveau du siège → applique l'action → avance → abattage →
attribution → main suivante. Chaque étape émet un événement dans le journal. Le
rejoueur s'abonne au journal.

## Roadmap de l'agent neuronal (track séparé — ne bloque rien)
- **Phase 0** — CFR sur Kuhn / Leduc poker : piger la mécanique, mesurer
  l'exploitabilité (possible sur petits jeux).
- **Phase 1** — Deep CFR sur un petit jeu.
- **Phase 2** — NLHE réduit (peu de tailles, arbre élagué).
- **Phase 3** — 6-max NLHE complet avec antes.

Frameworks : OpenSpiel (CFR + jeux de poker), implémentations Deep CFR
publiques. Le `NeuralBrain` n'a qu'à implémenter `BotBrain` pour se brancher.

## Réutilisé du build précédent
La table 6-max (= le rejoueur), l'infra Next/Supabase réparée, le concept de
profil (→ devient la config de cerveau), le principe d'ancrage.

## Mis de côté
La boucle « spot figé + décision humaine + notation » — recyclable plus tard en
mode bonus « mets pause et devine le coup du bot ».
