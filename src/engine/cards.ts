/**
 * Card representation and a seeded 52-card deck.
 *
 * Cards are 2-char strings in pokersolver's format: rank + suit.
 *   rank: 2 3 4 5 6 7 8 9 T J Q K A
 *   suit: s (spades) h (hearts) d (diamonds) c (clubs)
 * e.g. "As", "Td", "7c", "2h".
 */

import type { Rng } from "./rng.js";

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const SUITS = ["s", "h", "d", "c"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type Card = `${Rank}${Suit}`;

/** A fresh, ordered 52-card deck. */
export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(`${r}${s}`);
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle using the provided seeded RNG. Returns a new array;
 * does not mutate the input. Deterministic given the RNG's seed.
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** A shuffled 52-card deck, deterministic given the RNG. */
export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(freshDeck(), rng);
}

const RANK_VALUE: Record<string, number> = Object.fromEntries(
  RANKS.map((r, i) => [r, i + 2]),
);

export function rankOf(card: Card): Rank {
  return card[0] as Rank;
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

/** Numeric value of a rank: 2..14 (Ace high). */
export function rankValue(card: Card): number {
  return RANK_VALUE[card[0]!]!;
}

const RANK_LABEL: Record<Rank, string> = {
  "2": "Two", "3": "Three", "4": "Four", "5": "Five", "6": "Six",
  "7": "Seven", "8": "Eight", "9": "Nine", T: "Ten",
  J: "Jack", Q: "Queen", K: "King", A: "Ace",
};

const SUIT_LABEL: Record<Suit, string> = {
  s: "Spades", h: "Hearts", d: "Diamonds", c: "Clubs",
};

/** Human-readable card name, e.g. "Ace of Spades". For UI/logs. */
export function cardName(card: Card): string {
  return `${RANK_LABEL[rankOf(card)]} of ${SUIT_LABEL[suitOf(card)]}`;
}
