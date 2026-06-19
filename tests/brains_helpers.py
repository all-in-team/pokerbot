"""Cerveaux scriptés, déterministes, pour les tests."""

from __future__ import annotations

from sim.brains import Action, BotBrain, DecisionContext


class AllInBrain(BotBrain):
    """Jam maximal : relance au tapis si possible, sinon suit (call all-in)."""

    def decide(self, ctx: DecisionContext) -> Action:
        la = ctx.legal_actions
        if la.can_raise:
            return Action.raise_to(la.max_raise_to)
        if la.can_call:
            return Action.call()
        if la.can_check:
            return Action.check()
        return Action.fold()


class FoldBrain(BotBrain):
    """Se couche dès que possible (sinon check gratuit)."""

    def decide(self, ctx: DecisionContext) -> Action:
        la = ctx.legal_actions
        if la.can_check:
            return Action.check()
        return Action.fold()
