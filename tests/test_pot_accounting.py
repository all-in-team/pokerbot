"""Compta du pot : antes + blinds, et conservation des jetons par main."""

from __future__ import annotations

from sim.brains import SeatConfig
from sim.engine import GameConfig, PokerEngine

from .brains_helpers import FoldBrain


def _hands(events):
    """Découpe le journal plat en sous-listes, une par main (sur 'hand_start')."""
    out, cur = [], None
    for e in events:
        if e["type"] == "hand_start":
            cur = [e]
            out.append(cur)
        else:
            cur.append(e)
    return out


def test_preflop_accounting_antes_blinds():
    """Antes 6×2 = 12, SB 1, BB 2  ->  pot préflop = 15."""
    engine = PokerEngine(config=GameConfig(), seed=7)
    journal = engine.run_hand()

    antes = [e for e in journal if e["type"] == "post_ante"]
    blinds = {e["kind"]: e["amount"] for e in journal if e["type"] == "post_blind"}

    assert len(antes) == 6
    assert sum(e["amount"] for e in antes) == 12
    assert blinds == {"sb": 1, "bb": 2}
    assert sum(e["amount"] for e in antes) + sum(blinds.values()) == 15


def test_first_action_pot_after_is_15():
    """Avant toute mise volontaire, le pot vaut exactement 15 (12+1+2)."""
    # FoldBrain partout -> la première action (UTG) est un fold déterministe,
    # donc aucun jeton volontaire ajouté : le pot doit valoir antes+blinds = 15.
    engine = PokerEngine(seat_config=SeatConfig.all(FoldBrain), seed=7)
    journal = engine.run_hand()

    first_action = next(e for e in journal if e["type"] == "action")
    assert first_action["action"] in ("fold", "check")
    assert first_action["pot_after"] == 15


def test_uncontested_pot_conserves_chips():
    """Tout le monde fold sauf la BB : conservation parfaite sur la main."""
    seats = SeatConfig.all(FoldBrain)
    engine = PokerEngine(seat_config=seats, config=GameConfig(), seed=3)
    before = sum(engine.stacks)
    journal = engine.run_hand()
    end = next(e for e in journal if e["type"] == "hand_end")

    assert sum(end["stacks"]) == before  # rien créé ni détruit
    # Un seul gagnant ramasse le pot mort (antes + SB).
    awards = [e for e in journal if e["type"] == "award"]
    assert len(awards) == 1
    assert awards[0]["pot"] == "main"


def test_chip_conservation_over_many_hands():
    """Conservation vérifiée main après main sur une longue séquence."""
    engine = PokerEngine(config=GameConfig(starting_stack=1000), seed=42)
    total = sum(engine.stacks)
    for _ in range(25):
        engine._rebuy()
        rebought_total = sum(engine.stacks)  # peut augmenter via recave (hors main)
        journal = engine.run_hand()
        end = next(e for e in journal if e["type"] == "hand_end")
        # Conservation À L'INTÉRIEUR de la main : entrée == sortie.
        assert sum(end["stacks"]) == rebought_total
        total = rebought_total
