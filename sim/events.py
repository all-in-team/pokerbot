"""Journal d'événements — LE CONTRAT avec le futur rejoueur (front).

Une main produit une liste ordonnée d'événements typés. Un front doit pouvoir
ANIMER la main uniquement à partir de cette liste, sans rejouer la logique de jeu.

Chaque événement est un simple dict JSON-sérialisable. Les fabriques ci-dessous
documentent et garantissent la forme de chaque type. Le champ ``type`` identifie
l'événement ; les autres champs en sont la charge utile.

Types émis :
    {type:"hand_start",  hand, button, seats:[{seat, position, stack, brain}]}
    {type:"post_ante",   seat, amount}
    {type:"post_blind",  seat, kind:"sb"|"bb", amount}
    {type:"deal_hole",   seat, cards:[..]}
    {type:"deal_board",  street:"flop"|"turn"|"river", cards:[..], board:[..]}
    {type:"action",      seat, action:"fold"|"check"|"call"|"raise"|"all_in",
                         amount, pot_after}
    {type:"showdown",    reveals:[{seat, cards, hand}]}
    {type:"award",       seat, amount, pot:"main"|"side_1"|...}
    {type:"hand_end",    stacks:[..]}

Conventions de montants :
    - post_ante / post_blind : montant posté par le joueur.
    - action call : montant ajouté pour suivre (0 si check).
    - action raise / all_in : montant TOTAL « jusqu'à » (raise-to), pas l'increment.
    - pot_after : total au milieu APRÈS l'action (mises courantes incluses).
    - award : montant gagné depuis le pot nommé.
"""

from __future__ import annotations

# Constantes de type (évite les chaînes magiques côté appelant).
HAND_START = "hand_start"
POST_ANTE = "post_ante"
POST_BLIND = "post_blind"
DEAL_HOLE = "deal_hole"
DEAL_BOARD = "deal_board"
ACTION = "action"
SHOWDOWN = "showdown"
AWARD = "award"
HAND_END = "hand_end"


def hand_start(hand: int, button: int, seats: list[dict]) -> dict:
    return {"type": HAND_START, "hand": hand, "button": button, "seats": seats}


def post_ante(seat: int, amount: int) -> dict:
    return {"type": POST_ANTE, "seat": seat, "amount": amount}


def post_blind(seat: int, kind: str, amount: int) -> dict:
    return {"type": POST_BLIND, "seat": seat, "kind": kind, "amount": amount}


def deal_hole(seat: int, cards: list[str]) -> dict:
    return {"type": DEAL_HOLE, "seat": seat, "cards": cards}


def deal_board(street: str, cards: list[str], board: list[str]) -> dict:
    return {"type": DEAL_BOARD, "street": street, "cards": cards, "board": board}


def action(seat: int, action_kind: str, amount: int, pot_after: int) -> dict:
    return {
        "type": ACTION,
        "seat": seat,
        "action": action_kind,
        "amount": amount,
        "pot_after": pot_after,
    }


def showdown(reveals: list[dict]) -> dict:
    return {"type": SHOWDOWN, "reveals": reveals}


def award(seat: int, amount: int, pot: str) -> dict:
    return {"type": AWARD, "seat": seat, "amount": amount, "pot": pot}


def hand_end(stacks: list[int]) -> dict:
    return {"type": HAND_END, "stacks": stacks}


def pot_label(pot_index: int) -> str:
    """0 -> 'main', 1 -> 'side_1', 2 -> 'side_2', ..."""
    return "main" if pot_index == 0 else f"side_{pot_index}"
