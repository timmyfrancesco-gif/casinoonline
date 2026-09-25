/**
 * A card is encoded as an integer 0..51:
 *   rank = code % 13  -> 0 = A, 1 = 2, ..., 8 = 9, 9 = 10, 10 = J, 11 = Q, 12 = K
 *   suit = floor(code / 13) -> 0 = spades, 1 = hearts, 2 = diamonds, 3 = clubs
 * A multi-deck shoe is an array of codes where every code appears once per deck.
 */
export type CardCode = number;

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

export const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAMES_IT: Record<Suit, string> = {
  S: 'picche',
  H: 'cuori',
  D: 'quadri',
  C: 'fiori',
};

export function isCardCode(value: unknown): value is CardCode {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 52;
}

/** 0 = Ace ... 12 = King. */
export function rankIndex(code: CardCode): number {
  return code % 13;
}

export function cardRank(code: CardCode): Rank {
  return RANKS[code % 13]!;
}

export function cardSuit(code: CardCode): Suit {
  return SUITS[Math.floor(code / 13)]!;
}

export function isRed(code: CardCode): boolean {
  const suit = cardSuit(code);
  return suit === 'H' || suit === 'D';
}

/** Short label such as "10♥" or "A♠". */
export function cardLabel(code: CardCode): string {
  return `${cardRank(code)}${SUIT_SYMBOLS[cardSuit(code)]}`;
}

/** Ordered, unshuffled deck(s): deck 0 codes 0..51, then deck 1 codes 0..51, ... */
export function orderedShoe(decks: number): CardCode[] {
  const shoe: CardCode[] = [];
  for (let d = 0; d < decks; d++) {
    for (let c = 0; c < 52; c++) shoe.push(c);
  }
  return shoe;
}
