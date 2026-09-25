#!/usr/bin/env node
/**
 * Standalone provably-fair verifier: only node:crypto, no project code, no dependencies.
 * It re-implements packages/engine/src/fair/rng.ts and the per-game draws (docs/PROVABLY_FAIR.md).
 *
 *   node docs/verify-example.mjs <serverSeed> <clientSeed> <nonce> [roulette|slot|blackjack|videopoker]
 *
 * Without a game, the derivation of all four games is printed for the same (seed, nonce).
 */
import { createHash, createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TWO_POW_32 = 2 ** 32;

/** Byte stream HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`), read as big-endian uint32. */
export function createRoundRng(serverSeed, clientSeed, nonce) {
  let cursor = 0;
  let block = Buffer.alloc(0);
  let offset = 0;
  const nextUint32 = () => {
    if (offset + 4 > block.length) {
      block = createHmac('sha256', serverSeed)
        .update(`${clientSeed}:${nonce}:${cursor++}`)
        .digest();
      offset = 0;
    }
    const value = block.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  /** Uniform integer in [0, n) with rejection sampling (no modulo bias). */
  const int = (n) => {
    const limit = TWO_POW_32 - (TWO_POW_32 % n);
    for (;;) {
      const x = nextUint32();
      if (x < limit) return x % n;
    }
  };
  return { nextUint32, int };
}

/** Fisher-Yates from the last index down, j = int(i + 1). */
export function shuffle(rng, items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Unshuffled shoe: deck 0 codes 0..51, then deck 1 codes 0..51, ... */
export function orderedShoe(decks) {
  return Array.from({ length: decks * 52 }, (_, i) => i % 52);
}

/** Card code 0..51: rank = code % 13 (A,2..10,J,Q,K), suit = floor(code / 13) (♠ ♥ ♦ ♣). */
export function cardLabel(code) {
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return `${ranks[code % 13]}${'♠♥♦♣'[Math.floor(code / 13)]}`;
}

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
// Same 20-position strip for the three reels (index = stop).
// prettier-ignore
const SLOT_STRIP = [
  'LEMON', 'CHERRY', 'ORANGE', 'BELL', 'LEMON', 'BAR', 'ORANGE', 'CHERRY', 'LEMON', 'BELL',
  'ORANGE', 'SEVEN', 'LEMON', 'CHERRY', 'ORANGE', 'BAR', 'LEMON', 'CHERRY', 'ORANGE', 'BELL',
];

export function roulette(seeds) {
  const number = createRoundRng(...seeds).int(37);
  const color = number === 0 ? 'verde' : RED.has(number) ? 'rosso' : 'nero';
  return { number, color };
}

export function slot(seeds) {
  const rng = createRoundRng(...seeds);
  const stops = [rng.int(20), rng.int(20), rng.int(20)];
  return { stops, line: stops.map((s) => SLOT_STRIP[s]) };
}

export function blackjack(seeds) {
  const shoe = shuffle(createRoundRng(...seeds), orderedShoe(6));
  return {
    player: [shoe[0], shoe[2]],
    dealer: [shoe[1], shoe[3]],
    /** Hits, doubles, split cards and dealer draws, in the order they are needed. */
    next: shoe.slice(4, 16),
  };
}

export function videoPoker(seeds) {
  const deck = shuffle(createRoundRng(...seeds), orderedShoe(1));
  /** Non-held positions are replaced left to right with these cards. */
  return { hand: deck.slice(0, 5), replacements: deck.slice(5, 10) };
}

function main(argv) {
  const [serverSeed, clientSeed, nonceText, game] = argv;
  const nonce = Number(nonceText);
  if (!serverSeed || !clientSeed || !Number.isSafeInteger(nonce) || nonce < 0) {
    console.error(
      'Uso: node docs/verify-example.mjs <serverSeed> <clientSeed> <nonce> [roulette|slot|blackjack|videopoker]',
    );
    process.exit(2);
  }
  const seeds = [serverSeed, clientSeed, nonce];
  const cards = (codes) => codes.map(cardLabel).join(' ');
  const show = {
    roulette: () => {
      const r = roulette(seeds);
      console.log(`roulette:    numero ${r.number} (${r.color})`);
    },
    slot: () => {
      const s = slot(seeds);
      console.log(`slot:        fermate ${s.stops.join(', ')} -> ${s.line.join(' | ')}`);
    },
    blackjack: () => {
      const b = blackjack(seeds);
      console.log(
        `blackjack:   giocatore ${cards(b.player)}, banco ${cards(b.dealer)} (2a coperta)`,
      );
      console.log(`             carte successive: ${cards(b.next)}`);
    },
    videopoker: () => {
      const v = videoPoker(seeds);
      console.log(`videopoker:  mano ${cards(v.hand)}, sostituzioni ${cards(v.replacements)}`);
    },
  };
  if (game !== undefined && !(game in show)) {
    console.error(`Gioco sconosciuto: ${game}`);
    process.exit(2);
  }
  console.log(`sha256(serverSeed) = ${createHash('sha256').update(serverSeed).digest('hex')}`);
  for (const [name, print] of Object.entries(show)) {
    if (game === undefined || game === name) print();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
