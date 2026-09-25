export const GAME_IDS = ['roulette', 'slot', 'blackjack', 'videopoker'] as const;
export type GameId = (typeof GAME_IDS)[number];

export const GAME_NAMES_IT: Record<GameId, string> = {
  roulette: 'Roulette europea',
  slot: 'Slot Frutta',
  blackjack: 'Blackjack',
  videopoker: 'Video Poker Jacks or Better',
};

/** Games whose rounds span several requests (state stored server-side between actions). */
export const STATEFUL_GAMES: readonly GameId[] = ['blackjack', 'videopoker'];
