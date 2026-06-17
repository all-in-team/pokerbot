declare module "pokersolver" {
  /** A solved poker hand. Higher `rank` = stronger hand. */
  export class Hand {
    /** Numeric hand class rank (1 = high card … 9 = straight flush / royal). */
    rank: number;
    /** Short name, e.g. "Full House". */
    name: string;
    /** Descriptive name, e.g. "Full House, A's over K's". */
    descr: string;
    /** The cards that make up the best 5-card hand. */
    cards: unknown[];

    /** Solve the best 5-card hand from 5, 6 or 7 cards (e.g. ["As","Kd",...]). */
    static solve(cards: string[], game?: string, canDisqualify?: boolean): Hand;

    /** Given an array of solved hands, return the winning hand(s) (ties => multiple). */
    static winners(hands: Hand[]): Hand[];
  }

  export class Card {
    constructor(str: string);
  }

  const _default: { Hand: typeof Hand; Card: typeof Card };
  export default _default;
}
