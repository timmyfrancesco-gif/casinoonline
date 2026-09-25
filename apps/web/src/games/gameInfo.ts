import { GAME_NAMES_IT, VIDEO_POKER_OPTIMAL_RTP, type GameId } from '@casino/engine';
import { TABLE_LIMITS, type TableLimits } from '@casino/shared';

export interface GameInfo {
  id: GameId;
  path: string;
  name: string;
  tagline: string;
  /** Return to player (0..1). */
  rtp: number;
  rtpLabel: string;
  houseEdgeLabel: string;
  /** When the RTP depends on how you play. */
  rtpNote: string;
  limits: TableLimits;
}

/** Exact slot figures (enumeration of the 8000 stop combinations, see the engine contract). */
export const SLOT_TOTAL_RETURN = 7492;
export const SLOT_COMBINATIONS = 8000;
export const SLOT_HIT_COMBINATIONS = 1118;

export const GAMES: Record<GameId, GameInfo> = {
  roulette: {
    id: 'roulette',
    path: '/roulette',
    name: GAME_NAMES_IT.roulette,
    tagline: 'Un solo zero, 37 caselle: puntate interne ed esterne sul tappeto classico.',
    rtp: 36 / 37,
    rtpLabel: '97,30%',
    houseEdgeLabel: '2,70% (1/37)',
    rtpNote: 'Uguale per ogni tipo di puntata.',
    limits: TABLE_LIMITS.roulette,
  },
  slot: {
    id: 'slot',
    path: '/slot',
    name: GAME_NAMES_IT.slot,
    tagline: 'Tre rulli, una linea, tabella dei pagamenti sempre visibile.',
    rtp: SLOT_TOTAL_RETURN / SLOT_COMBINATIONS,
    rtpLabel: '93,65%',
    houseEdgeLabel: '6,35%',
    rtpNote: 'Valore esatto: 7492/8000, calcolato su tutte le combinazioni.',
    limits: TABLE_LIMITS.slot,
  },
  blackjack: {
    id: 'blackjack',
    path: '/blackjack',
    name: GAME_NAMES_IT.blackjack,
    tagline: '6 mazzi rimescolati a ogni mano, il banco sta su 17, blackjack pagato 3:2.',
    rtp: 0.995,
    rtpLabel: '≈ 99,5%',
    houseEdgeLabel: '≈ 0,5%',
    rtpNote: 'Valore approssimato con la strategia di base; giocando peggio il ritorno scende.',
    limits: TABLE_LIMITS.blackjack,
  },
  videopoker: {
    id: 'videopoker',
    path: '/videopoker',
    name: GAME_NAMES_IT.videopoker,
    tagline: 'Jacks or Better 9/6: tieni le carte migliori e cambia le altre una volta.',
    rtp: VIDEO_POKER_OPTIMAL_RTP,
    rtpLabel: '99,54%',
    houseEdgeLabel: '0,46%',
    rtpNote: 'Solo con strategia perfetta; con errori il ritorno è più basso.',
    limits: TABLE_LIMITS.videopoker,
  },
};

export const GAME_LIST: GameInfo[] = [
  GAMES.roulette,
  GAMES.slot,
  GAMES.blackjack,
  GAMES.videopoker,
];
