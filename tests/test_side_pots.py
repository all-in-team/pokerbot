"""Scénario all-in multiway : structure et montants des side pots."""

from __future__ import annotations

from collections import defaultdict

from sim.brains import SeatConfig
from sim.engine import GameConfig, PokerEngine

from .brains_helpers import AllInBrain


def _run_all_in(stacks, seed):
    seats = SeatConfig.all(AllInBrain)
    engine = PokerEngine(
        seat_config=seats,
        config=GameConfig(allow_rebuy=False),
        starting_stacks=stacks,
        seed=seed,
    )
    return engine, engine.run_hand()


def test_multiway_all_in_side_pot_sizes():
    """Tapis distincts -> main + 3 side pots, tailles déterministes.

    Tapis [20,40,60,100,100,100], tout le monde all-in. Chaque siège engage la
    TOTALITÉ de son tapis. Les paliers (20/40/60/100) découpent le pot ainsi :
        main  : 6 joueurs × 20            = 120
        side_1: 5 joueurs × (40-20)=20    = 100
        side_2: 4 joueurs × (60-40)=20    =  80
        side_3: 3 joueurs × (100-60)=40   = 120
    Total = 420 = somme des tapis. Indépendant du gagnant.
    """
    stacks = [20, 40, 60, 100, 100, 100]
    engine, journal = _run_all_in(stacks, seed=11)

    awards = [e for e in journal if e["type"] == "award"]
    by_pot = defaultdict(int)
    for a in awards:
        by_pot[a["pot"]] += a["amount"]

    assert dict(by_pot) == {"main": 120, "side_1": 100, "side_2": 80, "side_3": 120}
    assert sum(by_pot.values()) == sum(stacks) == 420


def test_all_in_conserves_chips():
    """La somme distribuée égale exactement les jetons en jeu."""
    stacks = [20, 40, 60, 100, 100, 100]
    engine, journal = _run_all_in(stacks, seed=11)

    end = next(e for e in journal if e["type"] == "hand_end")
    assert sum(end["stacks"]) == sum(stacks)


def test_three_distinct_short_stacks_produce_three_pots():
    """Trois tapis distincts (le reste à égalité) -> main + 2 side pots."""
    stacks = [10, 30, 60, 60, 60, 60]
    engine, journal = _run_all_in(stacks, seed=5)

    pots = {e["pot"] for e in journal if e["type"] == "award"}
    # Paliers distincts : 10, 30, 60  -> 3 niveaux de pot.
    assert pots == {"main", "side_1", "side_2"}

    by_pot = defaultdict(int)
    for e in journal:
        if e["type"] == "award":
            by_pot[e["pot"]] += e["amount"]
    # main: 6×10=60 ; side_1: 5×20=100 ; side_2: 4×30=120 ; total=280=somme tapis.
    assert dict(by_pot) == {"main": 60, "side_1": 100, "side_2": 120}
    assert sum(by_pot.values()) == sum(stacks)


def test_every_seat_revealed_at_all_in_showdown():
    """Un all-in généralisé mène à un abattage où chaque siège montre son jeu."""
    stacks = [20, 40, 60, 100, 100, 100]
    engine, journal = _run_all_in(stacks, seed=11)

    showdown = next(e for e in journal if e["type"] == "showdown")
    revealed_seats = {r["seat"] for r in showdown["reveals"]}
    assert revealed_seats == set(range(6))
    # Chaque main révélée est évaluée (chaîne non vide).
    assert all(r["hand"] for r in showdown["reveals"])
