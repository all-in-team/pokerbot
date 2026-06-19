"""Interface BotBrain : ce que voit un cerveau, et ce qu'il doit renvoyer.

Le moteur (``sim/engine.py``) construit un :class:`DecisionContext` à chaque
décision, le passe au :class:`BotBrain` du siège concerné, et applique l'
:class:`Action` renvoyée. Tout cerveau qui respecte ce protocole est jouable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

# Actions légales possibles (valeurs du champ Action.kind).
FOLD = "fold"
CHECK = "check"
CALL = "call"
RAISE = "raise"


@dataclass(frozen=True)
class LegalActions:
    """Ce que le siège a le droit de faire, avec les bornes de relance.

    Les montants de relance sont des montants « jusqu'à » (raise-to), c.-à-d. le
    total que la mise du joueur atteindra sur cette street — convention pokerkit.
    """

    can_fold: bool
    can_check: bool
    can_call: bool
    call_amount: int          # à ajouter pour suivre (0 si check possible)
    can_raise: bool
    min_raise_to: int         # relance minimale légale (total)
    max_raise_to: int         # relance maximale = tapis (total)


@dataclass(frozen=True)
class DecisionContext:
    """Photo de l'état de jeu présentée au cerveau au moment de décider."""

    seat: int                       # siège stable (0..5) qui doit agir
    position: str                   # "BTN","SB","BB","UTG","HJ","CO"
    hole_cards: list[str]           # ex: ["As","Kd"]
    board: list[str]                # cartes communes visibles (0,3,4,5)
    street: str                     # "preflop","flop","turn","river"
    pot: int                        # total au milieu AVANT l'action (mises incl.)
    to_call: int                    # montant pour suivre (0 si check)
    legal_actions: LegalActions
    stacks: list[int]               # tapis de chaque siège (index = siège)
    action_history: list[dict] = field(default_factory=list)  # events 'action' de la main
    button: int = 0                 # siège du bouton
    big_blind: int = 2              # taille de la BB (pour raisonner en bb)

    # --- helpers de confort pour les cerveaux ---
    @property
    def my_stack(self) -> int:
        return self.stacks[self.seat]

    @property
    def num_active(self) -> int:
        """Nombre de sièges encore en jeu (tapis > 0 ou déjà investis)."""
        return sum(1 for s in self.stacks if s > 0)


@dataclass(frozen=True)
class Action:
    """Décision d'un cerveau.

    kind : FOLD / CHECK / CALL / RAISE.
    amount : pertinent seulement pour RAISE — montant TOTAL « jusqu'à » (raise-to).
             Le moteur le borne à [min_raise_to, max_raise_to].
    """

    kind: str
    amount: int = 0

    @staticmethod
    def fold() -> "Action":
        return Action(FOLD)

    @staticmethod
    def check() -> "Action":
        return Action(CHECK)

    @staticmethod
    def call() -> "Action":
        return Action(CALL)

    @staticmethod
    def raise_to(amount: int) -> "Action":
        return Action(RAISE, amount)


@runtime_checkable
class BotBrain(Protocol):
    """Tout cerveau implémente ``decide``."""

    def decide(self, ctx: DecisionContext) -> Action:
        ...


@dataclass
class SeatConfig:
    """Assigne un BotBrain par siège. Défaut : le même cerveau partout."""

    brains: dict[int, BotBrain]

    @classmethod
    def all(cls, brain_factory, num_seats: int = 6) -> "SeatConfig":
        """Construit une config où chaque siège reçoit un cerveau frais.

        ``brain_factory`` est un callable sans argument renvoyant un BotBrain.
        """
        return cls({i: brain_factory() for i in range(num_seats)})

    def get(self, seat: int) -> BotBrain:
        return self.brains[seat]

    def name(self, seat: int) -> str:
        return type(self.brains[seat]).__name__
