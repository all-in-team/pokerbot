"""BaselineBrain — un adversaire simple, jouable, et ASSUMÉ non-optimal.

Préflop : charts par position adaptés à la structure ANTE (rappel : les antes
augmentent le pot mort, donc on défend/ouvre PLUS LARGE qu'en structure sans ante).
Postflop : heuristique force-de-main + texture (c-bet, value, fold to aggression).

⚠️  Ce cerveau est un BASELINE, pas une stratégie GTO ni exploitante. Chaque
endroit « approx » est marqué d'un commentaire TODO. Le but est d'avoir un
sparring-partner cohérent contre qui mesurer un vrai bot plus tard.
"""

from __future__ import annotations

from .base import Action, BotBrain, DecisionContext

# --- Parsing de cartes -------------------------------------------------------
_RANKS = {r: i for i, r in enumerate("23456789TJQKA", start=2)}


def _parse(card: str) -> tuple[int, str]:
    """'As' -> (14, 's'). Tolère une casse mixte sur la couleur."""
    return _RANKS[card[0].upper()], card[1].lower()


# --- Évaluation préflop : formule de Chen (heuristique classique) ------------
# TODO(approx): la formule de Chen est une approximation grossière de l'équité
# préflop ; un vrai bot utiliserait des ranges/équités calculées. Suffisant comme
# baseline pour ordonner les mains.
def chen_score(hole: list[str]) -> float:
    (r1, s1), (r2, s2) = _parse(hole[0]), _parse(hole[1])
    hi, lo = max(r1, r2), min(r1, r2)

    def base(rank: int) -> float:
        return {14: 10, 13: 8, 12: 7, 11: 6}.get(rank, rank / 2)

    if r1 == r2:  # paire
        return max(base(hi) * 2, 5)

    score = base(hi)
    if s1 == s2:  # assortie
        score += 2

    gap = hi - lo - 1
    score -= {0: 0, 1: 1, 2: 2, 3: 4}.get(gap, 5)

    # Bonus « straighty » : 0/1 gap et les deux cartes < Q.
    if gap <= 1 and hi < 12:
        score += 1

    return round(score)


# Seuils d'OUVERTURE (Chen) par position. Plus bas = plus large.
# TODO(approx): seuils choisis à la main, déjà ABAISSÉS pour la structure ante
# (pot mort plus gros => on ouvre plus large). Pas calibrés par simulation.
_OPEN_THRESHOLD = {
    "UTG": 8,   # le plus serré
    "HJ": 7,
    "CO": 6,
    "BTN": 5,   # vol large au bouton
    "SB": 6,    # on complète/relance large vs un seul joueur (BB)
    "BB": 5,    # rarement « ouvre » (déjà investi) ; sert de garde-fou
}

# Seuils face à une relance.
_3BET_THRESHOLD = 10   # AA, KK, QQ, AKs ~ Chen >= 10
_CALL_THRESHOLD = 7    # mains correctes qui paient pour voir un flop


class BaselineBrain(BotBrain):
    """Stratégie fixe, sans état entre les mains."""

    def __init__(self, cbet_pot_fraction: float = 0.55) -> None:
        # Taille de mise par défaut en fraction de pot (c-bet / value).
        self.cbet_pot_fraction = cbet_pot_fraction

    # ------------------------------------------------------------------ API
    def decide(self, ctx: DecisionContext) -> Action:
        if ctx.street == "preflop":
            return self._preflop(ctx)
        return self._postflop(ctx)

    # --------------------------------------------------------------- préflop
    def _preflop(self, ctx: DecisionContext) -> Action:
        la = ctx.legal_actions
        score = chen_score(ctx.hole_cards)
        bb = ctx.big_blind

        # Personne n'a relancé au-delà de la BB : on peut OUVRIR.
        # (to_call == BB pour les non-blinds, 0 pour la BB, < BB pour la SB.)
        no_raise_yet = ctx.to_call <= bb
        if no_raise_yet:
            threshold = _OPEN_THRESHOLD.get(ctx.position, 7)
            if score >= threshold and la.can_raise:
                # Ouverture ~2.5bb (les antes justifient des opens plus petits).
                # TODO(approx): sizing fixe ; un vrai bot varie selon position/stacks.
                target = ctx.to_call + round(2.5 * bb)
                return self._raise_clamped(la, target)
            if la.can_check:           # BB qui peut voir gratuitement
                return Action.check()
            # SB qui complète avec une main jouable, sinon fold.
            if score >= _CALL_THRESHOLD and la.can_call and la.call_amount <= bb:
                return Action.call()
            return Action.fold() if la.can_fold else Action.check()

        # Face à une (sur)relance : 3bet premium / call correct / fold.
        if score >= _3BET_THRESHOLD and la.can_raise:
            target = ctx.to_call + round(3.0 * ctx.to_call)  # ~3x le montant à suivre
            return self._raise_clamped(la, target)
        if score >= _CALL_THRESHOLD and la.can_call:
            # TODO(approx): ne tient pas compte des cotes du pot ni de la
            # profondeur ; appelle « à la couleur » dès que la main est correcte.
            return Action.call()
        return Action.fold() if la.can_fold else Action.check()

    # -------------------------------------------------------------- postflop
    def _postflop(self, ctx: DecisionContext) -> Action:
        la = ctx.legal_actions
        tier = _made_hand_tier(ctx.hole_cards, ctx.board)

        if ctx.to_call == 0:
            # On a l'initiative : c-bet / value avec une main faite, sinon check.
            # TODO(approx): pas de bluff/semi-bluff structuré, pas de notion de
            # qui était l'agresseur préflop ; on value-bet simplement tier>=2.
            if tier >= 2 and la.can_raise:
                return self._bet_fraction(ctx, la, self.cbet_pot_fraction)
            return Action.check() if la.can_check else Action.fold()

        # Face à une mise : value-raise fort, call moyen, fold faible.
        if tier >= 3 and la.can_raise:
            return self._bet_fraction(ctx, la, 0.75)
        if tier >= 2 and la.can_call:
            # TODO(approx): call « top pair+ » sans calcul de cotes ni de draws.
            return Action.call()
        # fold to aggression
        # TODO(approx): on jette tous les tirages/floats ; un vrai bot défendrait
        # une partie de son range (semi-bluffs, blockers, cotes implicites).
        return Action.fold() if la.can_fold else Action.check()

    # --------------------------------------------------------------- helpers
    def _raise_clamped(self, la, target: int) -> Action:
        target = max(la.min_raise_to, min(target, la.max_raise_to))
        return Action.raise_to(target)

    def _bet_fraction(self, ctx, la, frac: float) -> Action:
        # Mise « jusqu'à » = à suivre + fraction du pot (après avoir suivi).
        target = ctx.to_call + round(frac * (ctx.pot + ctx.to_call))
        # On vise au moins la BB de plus que la mise courante.
        target = max(target, la.min_raise_to)
        return self._raise_clamped(la, target)


# --- Classificateur de main faite (tiers grossiers) --------------------------
# tier 0: air        1: paire faible       2: top pair / overpair
# tier 3: two pair / brelan                4: suite ou mieux
# TODO(approx): ignore les tirages (flush/straight draws), les kickers, les
# paires sur board apparié, etc. Classification volontairement grossière.
def _made_hand_tier(hole: list[str], board: list[str]) -> int:
    if not board:  # sécurité (ne devrait pas arriver postflop)
        return 0

    hole_r = [_parse(c)[0] for c in hole]
    hole_s = [_parse(c)[1] for c in hole]
    board_r = [_parse(c)[0] for c in board]
    board_s = [_parse(c)[1] for c in board]
    all_r = hole_r + board_r
    all_s = hole_s + board_s

    counts: dict[int, int] = {}
    for r in all_r:
        counts[r] = counts.get(r, 0) + 1
    multiples = sorted(counts.values(), reverse=True)

    # Flush ?
    suit_counts: dict[str, int] = {}
    for s in all_s:
        suit_counts[s] = suit_counts.get(s, 0) + 1
    has_flush = max(suit_counts.values()) >= 5

    # Suite ? (As compté haut et bas)
    uniq = set(all_r)
    if 14 in uniq:
        uniq.add(1)
    has_straight = any(all(r + i in uniq for i in range(5)) for r in uniq)

    if has_straight or has_flush or multiples[0] >= 4 or (
        multiples[0] == 3 and len(multiples) > 1 and multiples[1] >= 2
    ):
        return 4
    if multiples[0] == 3:                      # brelan
        return 3
    if multiples[0] == 2 and len([c for c in counts.values() if c == 2]) >= 2:
        return 3                                # deux paires
    if multiples[0] == 2:
        # Une paire : top pair / overpair => tier 2, sinon paire faible => tier 1.
        paired_rank = max(r for r, c in counts.items() if c == 2)
        top_board = max(board_r)
        is_pocket_pair = hole_r[0] == hole_r[1]
        if (is_pocket_pair and hole_r[0] >= top_board) or paired_rank >= top_board:
            return 2
        return 1
    return 0
