import type { BlackjackAction, BlackjackOutcome } from '@casino/engine';

export const ACTION_LABELS: Record<BlackjackAction, string> = {
  hit: 'Carta',
  stand: 'Stai',
  double: 'Raddoppia',
  split: 'Dividi',
};

/** Keyboard shortcuts (H/S/D/P, as on most online tables). */
export const ACTION_KEYS: Record<BlackjackAction, string> = {
  hit: 'H',
  stand: 'S',
  double: 'D',
  split: 'P',
};

export const OUTCOME_LABELS: Record<BlackjackOutcome, string> = {
  blackjack: 'Blackjack! Pagato 3:2',
  win: 'Vinta',
  push: 'Pareggio',
  lose: 'Persa',
};

export const OUTCOME_SHORT: Record<BlackjackOutcome, string> = {
  blackjack: 'Blackjack',
  win: 'Vinta',
  push: 'Pareggio',
  lose: 'Persa',
};
