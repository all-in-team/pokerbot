"""CLI : simule N mains et imprime le journal d'événements en JSON.

    python -m sim.run --hands 5 [--seed N] [--stack 200]

Sortie : un objet JSON {"hands": M, "events": [...]} sur stdout, où ``events``
est la liste ordonnée de TOUS les événements (toutes mains concaténées). Chaque
événement porte un champ ``type`` (voir ``sim/events.py`` pour le contrat).
"""

from __future__ import annotations

import argparse
import json
import sys

from .engine import GameConfig, PokerEngine


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m sim.run",
        description="Simule des mains de poker 6-max (structure ante) et émet "
                    "un journal d'événements JSON.",
    )
    parser.add_argument("--hands", type=int, default=1,
                        help="nombre de mains à simuler (défaut : 1)")
    parser.add_argument("--seed", type=int, default=None,
                        help="graine aléatoire pour un déroulé déterministe")
    parser.add_argument("--stack", type=int, default=200,
                        help="tapis de départ en jetons (défaut : 200 = 100 bb)")
    parser.add_argument("--pretty", action="store_true",
                        help="JSON indenté (lisible) plutôt que compact")
    args = parser.parse_args(argv)

    engine = PokerEngine(
        config=GameConfig(starting_stack=args.stack),
        seed=args.seed,
    )
    journal = engine.run(args.hands)

    payload = {"hands": args.hands, "events": journal}
    indent = 2 if args.pretty else None
    json.dump(payload, sys.stdout, indent=indent, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
