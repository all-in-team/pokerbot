"""Moteur de jeu 6-max No-Limit Hold'em avec structure ANTE, basé sur pokerkit.

Gère : antes (pour TOUT LE MONDE) + blinds, tours d'enchères, all-in, SIDE POTS,
abattage, évaluation, attribution, et rotation du bouton entre les mains.

Le moteur ne *décide* rien : à chaque point de décision il construit un
:class:`DecisionContext`, interroge le :class:`BotBrain` du siège, applique
l'action, et émet un événement dans le journal (voir ``sim/events.py``).

Structure par défaut : 6 joueurs, $1/$2, ante $2 chacun, tapis 100 bb ($200).
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from pokerkit import Automation, NoLimitTexasHoldem

from . import events
from .brains import Action, BaselineBrain, DecisionContext, LegalActions, SeatConfig
from .brains.base import CALL, CHECK, FOLD, RAISE

# Positions 6-max, par décalage depuis le bouton.
_POSITION_BY_OFFSET = {0: "BTN", 1: "SB", 2: "BB", 3: "UTG", 4: "HJ", 5: "CO"}

# pokerkit gère mécaniquement la collecte des mises, le brûlage de cartes et le
# choix du nombre de runouts ; on pilote tout le reste à la main pour pouvoir
# émettre les bons événements au bon moment.
_AUTOMATIONS = (
    Automation.BET_COLLECTION,
    Automation.CARD_BURNING,
    Automation.RUNOUT_COUNT_SELECTION,
)


def _cards(cards) -> list[str]:
    """Tuple/itérable de pokerkit.Card -> liste de chaînes ('As', 'Td', ...)."""
    return [repr(c) for c in cards]


def _board(state) -> list[str]:
    """Cartes communes visibles (liste vide preflop)."""
    return _cards(state.get_board_cards(0))


@dataclass
class GameConfig:
    num_seats: int = 6
    small_blind: int = 1
    big_blind: int = 2
    ante: int = 2
    starting_stack: int = 200  # 100 bb
    # Cash game : un joueur ruiné se recave au tapis de départ ENTRE deux mains.
    # La recave est une opération de session (hors main) : elle n'altère pas la
    # conservation À L'INTÉRIEUR d'une main, qui reste vérifiée par assertion.
    allow_rebuy: bool = True


class PokerEngine:
    """Simule des mains successives en conservant tapis et position du bouton."""

    def __init__(
        self,
        seat_config: SeatConfig | None = None,
        config: GameConfig | None = None,
        seed: int | None = None,
        starting_stacks: list[int] | None = None,
    ) -> None:
        self.cfg = config or GameConfig()
        self.seats = seat_config or SeatConfig.all(BaselineBrain, self.cfg.num_seats)
        # Tapis persistants entre les mains (index = siège stable).
        if starting_stacks is not None:
            self.stacks = list(starting_stacks)
        else:
            self.stacks = [self.cfg.starting_stack] * self.cfg.num_seats
        self.button = 0
        self.hand_no = 0
        # pokerkit mélange via le module random global -> on le sème ici pour
        # rendre toute la séquence de mains déterministe sous --seed.
        if seed is not None:
            random.seed(seed)

    # ------------------------------------------------------------------ public
    def run_hand(self) -> list[dict]:
        """Joue UNE main complète et renvoie son journal d'événements."""
        n = self.cfg.num_seats
        positions = {(self.button + off) % n: name
                     for off, name in _POSITION_BY_OFFSET.items()}
        sb_seat = (self.button + 1) % n
        bb_seat = (self.button + 2) % n

        total_before = sum(self.stacks)
        state = NoLimitTexasHoldem.create_state(
            _AUTOMATIONS,
            True,  # ante_trimming_status
            {i: self.cfg.ante for i in range(n)},        # antes : tout le monde
            {sb_seat: self.cfg.small_blind, bb_seat: self.cfg.big_blind},
            self.cfg.big_blind,                           # min_bet
            {i: self.stacks[i] for i in range(n)},        # tapis de départ
            n,
        )

        journal: list[dict] = []
        self.hand_no += 1
        journal.append(events.hand_start(
            hand=self.hand_no,
            button=self.button,
            seats=[
                {
                    "seat": i,
                    "position": positions[i],
                    "stack": self.stacks[i],
                    "brain": self.seats.name(i),
                }
                for i in range(n)
            ],
        ))

        revealed: list[tuple[int, list[str]]] = []  # (seat, cards) montrés à l'abattage
        showdown_done = False
        pending_awards: list[dict] | None = None

        while state.status:
            # 1) Antes (un joueur à la fois).
            if state.can_post_ante():
                op = state.post_ante()
                journal.append(events.post_ante(op.player_index, op.amount))
                continue

            # 2) Blinds.
            if state.can_post_blind_or_straddle():
                op = state.post_blind_or_straddle()
                kind = "sb" if op.player_index == sb_seat else "bb"
                journal.append(events.post_blind(op.player_index, kind, op.amount))
                continue

            # 3) Distribution des cartes fermées (toutes, puis on émet par siège).
            if state.can_deal_hole():
                while state.can_deal_hole():
                    state.deal_hole()
                for i in range(n):
                    journal.append(events.deal_hole(i, _cards(state.hole_cards[i])))
                continue

            # 4) Décision d'un joueur.
            if state.actor_index is not None:
                history = [e for e in journal if e["type"] == events.ACTION]
                journal.append(self._take_action(state, positions, history))
                continue

            # 5) Cartes communes (flop/turn/river, y c. runout d'all-in).
            if state.can_deal_board():
                op = state.deal_board()
                board = _board(state)
                street = {3: "flop", 4: "turn", 5: "river"}[len(board)]
                journal.append(events.deal_board(street, _cards(op.cards), board))
                continue

            # 6) Abattage : chaque joueur montre ou jette (auto : montre si peut gagner).
            if state.can_show_or_muck_hole_cards():
                seat = state.showdown_index
                op = state.show_or_muck_hole_cards()
                if op.hole_cards:
                    revealed.append((seat, _cards(op.hole_cards)))
                continue

            # 6b) Fin de l'action : board complet et abattages faits. On émet
            # l'abattage ET on calcule les gains par pot MAINTENANT, tant que les
            # mains existent encore — kill_hand (étape 7) rendrait get_hand -> None.
            if pending_awards is None and (
                state.can_kill_hand() or state.can_push_chips()
            ):
                if revealed and not showdown_done:
                    journal.append(self._showdown_event(state, revealed))
                    showdown_done = True
                revealed_seats = {s for s, _ in revealed}
                pending_awards = self._compute_awards(state, revealed_seats)
                continue

            # 7) Tuer les mains perdantes (mécanique, pas d'événement).
            if state.can_kill_hand():
                state.kill_hand()
                continue

            # 8) Mouvement réel des jetons + émission des gains calculés en 6b.
            if state.can_push_chips():
                stacks_before = list(state.stacks)
                # Mises non suivies encore en jeu : elles RETOURNENT à leur
                # propriétaire au moment du push (ce n'est pas un gain).
                uncalled = list(state.bets)
                while state.can_push_chips():
                    state.push_chips()
                while state.can_pull_chips():
                    state.pull_chips()
                # Réconciliation : delta de tapis = gains du pot + mise rendue.
                deltas = [state.stacks[i] - stacks_before[i] for i in range(n)]
                got = [uncalled[i] for i in range(n)]
                for a in pending_awards or []:
                    got[a["seat"]] += a["amount"]
                assert got == deltas, f"award+rendu != deltas : {got} vs {deltas}"
                journal.extend(pending_awards or [])
                continue

            # 9) Le gagnant ramasse ses jetons (cas sans étape 8 ; mécanique).
            if state.can_pull_chips():
                while state.can_pull_chips():
                    state.pull_chips()
                continue

            # Rien d'autre à faire pour avancer.
            if state.can_no_operate():
                state.no_operate()
                continue
            break

        # Persistance des tapis + rotation du bouton.
        self.stacks = list(state.stacks)
        journal.append(events.hand_end(list(self.stacks)))

        # Conservation : aucun jeton créé ni détruit (rake = 0).
        assert sum(self.stacks) == total_before, (
            f"Non-conservation : {total_before} -> {sum(self.stacks)}"
        )

        self.button = (self.button + 1) % n
        return journal

    def run(self, hands: int) -> list[dict]:
        """Joue ``hands`` mains, renvoie le journal concaténé de toutes."""
        out: list[dict] = []
        for _ in range(hands):
            self._rebuy()
            out.extend(self.run_hand())
        return out

    def _rebuy(self) -> None:
        """Recave (entre les mains) tout siège trop court pour poster l'ante.

        Garde la table 6-max pleine. Opération de session : effectuée AVANT le
        snapshot de conservation de la main suivante, donc sans impact dessus.
        """
        if not self.cfg.allow_rebuy:
            return
        floor = self.cfg.ante + self.cfg.big_blind
        for i in range(self.cfg.num_seats):
            if self.stacks[i] < floor:
                self.stacks[i] = self.cfg.starting_stack

    # ----------------------------------------------------------------- internes
    def _take_action(self, state, positions, history) -> dict:
        seat = state.actor_index
        to_call = state.checking_or_calling_amount  # avant application

        can_raise = state.can_complete_bet_or_raise_to()
        legal = LegalActions(
            can_fold=state.can_fold(),
            can_check=state.can_check_or_call() and to_call == 0,
            can_call=state.can_check_or_call() and to_call > 0,
            call_amount=to_call,
            can_raise=can_raise,
            min_raise_to=state.min_completion_betting_or_raising_to_amount or 0,
            max_raise_to=state.max_completion_betting_or_raising_to_amount or 0,
        )
        ctx = DecisionContext(
            seat=seat,
            position=positions[seat],
            hole_cards=_cards(state.hole_cards[seat]),
            board=_board(state),
            street=self._street_name(state),
            pot=state.total_pot_amount,
            to_call=to_call,
            legal_actions=legal,
            stacks=list(state.stacks),
            action_history=history,  # events 'action' déjà émis dans cette main
            button=self.button,
            big_blind=self.cfg.big_blind,
        )

        decision = self.seats.get(seat).decide(ctx)
        kind, label, amount = self._apply(state, decision, legal, to_call)

        # all-in : le joueur a engagé son dernier jeton en suivant/relançant.
        if kind in (CALL, RAISE) and state.stacks[seat] == 0:
            label = "all_in"
        return events.action(seat, label, amount, state.total_pot_amount)

    def _apply(self, state, decision: Action, legal: LegalActions, to_call: int):
        """Applique la décision (avec garde-fous) et renvoie (kind, label, amount)."""
        kind = decision.kind

        if kind == FOLD and legal.can_fold:
            state.fold()
            return FOLD, "fold", 0

        if kind == RAISE and legal.can_raise:
            target = max(legal.min_raise_to, min(decision.amount, legal.max_raise_to))
            state.complete_bet_or_raise_to(target)
            return RAISE, "raise", target

        # CHECK / CALL — et repli sûr pour toute décision illégale.
        state.check_or_call()
        if to_call == 0:
            return CHECK, "check", 0
        return CALL, "call", to_call

    def _street_name(self, state) -> str:
        return {0: "preflop", 3: "flop", 4: "turn", 5: "river"}[
            len(_board(state))
        ]

    def _showdown_event(self, state, revealed) -> dict:
        reveals = []
        for seat, cards in revealed:
            hand = state.get_hand(seat, 0, 0)
            reveals.append({
                "seat": seat,
                "cards": cards,
                "hand": str(hand) if hand is not None else None,
            })
        return events.showdown(reveals)

    def _compute_awards(self, state, revealed_seats: set[int]) -> list[dict]:
        """Calcule les gains par pot à partir de la structure GRANULAIRE des pots.

        pokerkit fusionne les side pots gagnés par un même joueur dans son
        opération de paiement ; on reconstruit donc l'attribution depuis
        ``state.pots`` (qui expose chaque palier séparément) pour garder des
        ``award`` par pot nommé (main, side_1, ...). L'appelant réconcilie ensuite
        la somme avec les deltas réels de tapis.

        Doit être appelé AVANT kill_hand (sinon get_hand renvoie None).
        """
        awards: list[dict] = []
        for idx, pot in enumerate(state.pots):
            amount = pot.amount
            if amount == 0:
                continue
            players = list(pot.player_indices)

            # Prétendants au pot : ceux qui ont montré (abattage), sinon — pot non
            # disputé — le(s) survivant(s) encore en jeu.
            if revealed_seats:
                contenders = [i for i in players if i in revealed_seats]
            else:
                contenders = [i for i in players if state.statuses[i]]
            if not contenders:  # garde-fou
                contenders = [i for i in players if state.statuses[i]]

            if len(contenders) == 1:
                winners = contenders
            else:
                hands = {i: state.get_hand(i, 0, 0) for i in contenders}
                best = max(h for h in hands.values() if h is not None)
                winners = [i for i in contenders if hands[i] == best]

            # Partage : quotient à chacun, et la TOTALITÉ du reste impair au
            # gagnant de plus petit index de siège — règle exacte de pokerkit
            # (le reste va à pot.player_indices[0], ordre croissant des sièges).
            base, rem = divmod(amount, len(winners))
            for k, seat in enumerate(sorted(winners)):
                awards.append(
                    events.award(seat, base + (rem if k == 0 else 0),
                                 events.pot_label(idx))
                )
        return awards
