import { useMemo } from 'react';
import { Link } from 'react-router';
import {
  POKER_HAND_RANKS,
  ROULETTE_PAYOUTS,
  SLOT_PAYTABLE,
  VIDEO_POKER_HAND_NAMES_IT,
  VIDEO_POKER_PAYTABLE,
  slotExactStats,
  type RouletteBetType,
  type SlotWinKind,
} from '@casino/engine';
import { ROULETTE_MAX_BETS } from '@casino/shared';
import {
  GAMES,
  SLOT_COMBINATIONS,
  SLOT_HIT_COMBINATIONS,
  SLOT_TOTAL_RETURN,
} from '../games/gameInfo.ts';
import { WIN_NAMES_IT } from '../games/slot/symbols.tsx';
import { chipsLabel, formatPercent } from '../lib/format.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';

const ROULETTE_ROWS: { type: RouletteBetType; name: string; covers: string; count: number }[] = [
  { type: 'straight', name: 'Pieno', covers: 'un numero', count: 1 },
  { type: 'split', name: 'Cavallo', covers: 'due numeri vicini (anche 0-1, 0-2, 0-3)', count: 2 },
  { type: 'street', name: 'Terzina', covers: 'una riga di tre numeri', count: 3 },
  { type: 'trio', name: 'Tris con lo zero', covers: '0-1-2 oppure 0-2-3', count: 3 },
  { type: 'corner', name: 'Carré', covers: 'quattro numeri in quadrato', count: 4 },
  { type: 'basket', name: 'Prima quattro', covers: '0-1-2-3', count: 4 },
  { type: 'sixline', name: 'Sestina', covers: 'due righe vicine', count: 6 },
  { type: 'dozen', name: 'Dozzina', covers: '1-12, 13-24 o 25-36', count: 12 },
  { type: 'column', name: 'Colonna', covers: 'una delle tre colonne', count: 12 },
  { type: 'red', name: 'Rosso / Nero', covers: '18 numeri', count: 18 },
  { type: 'even', name: 'Pari / Dispari', covers: '18 numeri', count: 18 },
  { type: 'low', name: 'Manque / Passe', covers: '1-18 oppure 19-36', count: 18 },
];

/** Combinations (out of 20^3) for each slot outcome, from the reel composition. */
const SLOT_WAYS: Record<SlotWinKind, number> = {
  THREE_SEVEN: 1,
  THREE_BAR: 8,
  THREE_BELL: 27,
  THREE_CHERRY: 64,
  THREE_LEMON: 125,
  THREE_ORANGE: 125,
  TWO_CHERRY: 768,
};

function useSlotStats() {
  return useMemo(() => {
    try {
      const s = slotExactStats();
      return { ...s, computed: true };
    } catch {
      // Engine not available: documented exact values.
      return {
        combinations: SLOT_COMBINATIONS,
        totalReturn: SLOT_TOTAL_RETURN,
        rtp: SLOT_TOTAL_RETURN / SLOT_COMBINATIONS,
        hitRate: SLOT_HIT_COMBINATIONS / SLOT_COMBINATIONS,
        computed: false,
      };
    }
  }, []);
}

export function RulesPage() {
  usePageTitle('Regole e probabilità');
  const slot = useSlotStats();

  return (
    <div className="page rules-page">
      <h1>Regole e probabilità</h1>
      <p className="lead">
        Tutti i giochi usano fiches virtuali senza valore. L’RTP (ritorno al giocatore) è la parte
        delle puntate che, in media e su moltissime partite, torna al giocatore; il resto è il
        vantaggio del banco. Nel breve periodo i risultati oscillano molto, nel lungo periodo il
        banco vince.
      </p>
      <nav aria-label="Giochi" className="toc">
        <a href="#roulette">Roulette</a>
        <a href="#slot">Slot</a>
        <a href="#blackjack">Blackjack</a>
        <a href="#videopoker">Video Poker</a>
        <a href="#equita">Equità verificabile</a>
      </nav>

      <section id="roulette" className="panel rules-section" aria-labelledby="rules-roulette">
        <h2 id="rules-roulette">{GAMES.roulette.name}</h2>
        <p>
          Ruota con 37 caselle (0-36) e un solo zero. Il numero vincente viene estratto con un’unica
          estrazione uniforme. Le puntate esterne perdono tutte quando esce lo 0 (niente «la
          partage»). Una puntata vincente restituisce la puntata più la vincita. Fino a{' '}
          {ROULETTE_MAX_BETS} puntate per giro, da {chipsLabel(GAMES.roulette.limits.min)} a{' '}
          {chipsLabel(GAMES.roulette.limits.maxPerBet)} ciascuna e al massimo{' '}
          {chipsLabel(GAMES.roulette.limits.maxPerRound)} in totale.
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Puntata</th>
                <th scope="col">Copre</th>
                <th scope="col" className="num">
                  Paga
                </th>
                <th scope="col" className="num">
                  Probabilità
                </th>
                <th scope="col" className="num">
                  Vantaggio banco
                </th>
              </tr>
            </thead>
            <tbody>
              {ROULETTE_ROWS.map((row) => (
                <tr key={row.type}>
                  <th scope="row">{row.name}</th>
                  <td>{row.covers}</td>
                  <td className="num">{ROULETTE_PAYOUTS[row.type]}:1</td>
                  <td className="num">
                    {row.count}/37 ({formatPercent(row.count / 37)})
                  </td>
                  <td className="num">2,70%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Numeri rossi: 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36. Tutti gli
          altri da 1 a 36 sono neri; lo 0 è verde. RTP {GAMES.roulette.rtpLabel} per ogni puntata.
        </p>
      </section>

      <section id="slot" className="panel rules-section" aria-labelledby="rules-slot">
        <h2 id="rules-slot">{GAMES.slot.name}</h2>
        <p>
          Tre rulli identici da 20 posizioni: 1 sette, 2 bar, 3 campane, 4 ciliegie, 5 limoni e 5
          arance. Ogni rullo si ferma in una posizione estratta in modo uniforme; conta solo la
          linea centrale. I rulli mostrano sempre le posizioni estratte, senza «quasi vincite»
          pilotate.
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Combinazione</th>
                <th scope="col" className="num">
                  Rientro (× puntata)
                </th>
                <th scope="col" className="num">
                  Combinazioni su 8000
                </th>
                <th scope="col" className="num">
                  Probabilità
                </th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(SLOT_PAYTABLE) as SlotWinKind[]).map((kind) => (
                <tr key={kind}>
                  <th scope="row">{WIN_NAMES_IT[kind]}</th>
                  <td className="num">×{SLOT_PAYTABLE[kind]}</td>
                  <td className="num">{SLOT_WAYS[kind]}</td>
                  <td className="num">{formatPercent(SLOT_WAYS[kind] / SLOT_COMBINATIONS, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="summary-list compact">
          <div>
            <dt>RTP esatto</dt>
            <dd>
              {formatPercent(slot.rtp)} ({slot.totalReturn}/{slot.combinations})
            </dd>
          </div>
          <div>
            <dt>Vantaggio del banco</dt>
            <dd>{formatPercent(1 - slot.rtp)}</dd>
          </div>
          <div>
            <dt>Frequenza di vincita</dt>
            <dd>{formatPercent(slot.hitRate, 3)}</dd>
          </div>
        </dl>
        <p className="small muted">
          {slot.computed
            ? 'Valori calcolati ora nel tuo browser enumerando tutte le 8000 combinazioni.'
            : 'Valori esatti ottenuti enumerando tutte le 8000 combinazioni.'}
        </p>
      </section>

      <section id="blackjack" className="panel rules-section" aria-labelledby="rules-blackjack">
        <h2 id="rules-blackjack">{GAMES.blackjack.name}</h2>
        <ul className="plain-list bullets">
          <li>6 mazzi, rimescolati a ogni mano (niente conteggio delle carte).</li>
          <li>
            Asso vale 1 o 11, figure 10. Blackjack (asso + carta da 10 nelle prime due carte, non
            dopo una divisione) paga 3:2.
          </li>
          <li>
            Il banco controlla subito se ha blackjack: in quel caso la mano finisce e perdi solo la
            puntata iniziale (pareggio se hai blackjack anche tu).
          </li>
          <li>
            Mosse: carta, stai, raddoppia (sulle prime due carte, anche dopo una divisione: una sola
            carta in più), dividi (due carte dello stesso valore facciale, una sola volta per mano).
            Gli assi divisi ricevono una sola carta ciascuno.
          </li>
          <li>Il banco pesca fino a 16 e sta su tutti i 17, anche morbidi.</li>
          <li>Niente assicurazione né resa.</li>
          <li>
            Vincita normale 1:1, pareggio restituisce la puntata. RTP {GAMES.blackjack.rtpLabel} con
            la strategia di base (vantaggio del banco {GAMES.blackjack.houseEdgeLabel}); al tavolo
            puoi attivare il suggerimento della strategia di base.
          </li>
        </ul>
      </section>

      <section id="videopoker" className="panel rules-section" aria-labelledby="rules-videopoker">
        <h2 id="rules-videopoker">{GAMES.videopoker.name}</h2>
        <p>
          Un mazzo da 52 carte rimescolato a ogni mano. Ricevi 5 carte, scegli quali tenere e le
          altre vengono sostituite, nell’ordine, dalle carte successive del mazzo. Conta la mano
          finale. Scale: A-2-3-4-5 e 10-J-Q-K-A valgono; non si «gira» l’angolo (Q-K-A-2-3 non è
          scala).
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Mano</th>
                <th scope="col" className="num">
                  Rientro (× puntata)
                </th>
              </tr>
            </thead>
            <tbody>
              {POKER_HAND_RANKS.filter((r) => r !== 'NOTHING').map((rank) => (
                <tr key={rank}>
                  <th scope="row">{VIDEO_POKER_HAND_NAMES_IT[rank]}</th>
                  <td className="num">×{VIDEO_POKER_PAYTABLE[rank]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          RTP {GAMES.videopoker.rtpLabel} solo con strategia perfetta; ogni errore lo riduce. Il
          suggerimento al tavolo calcola il valore atteso esatto di tutte le 32 scelte possibili.
        </p>
      </section>

      <section id="equita" className="panel rules-section" aria-labelledby="rules-fair">
        <h2 id="rules-fair">Equità verificabile (provably fair)</h2>
        <ol className="plain-list numbered">
          <li>
            Il server genera un seed segreto e ti mostra in anticipo la sua impronta SHA-256: non
            può più cambiarlo senza che tu te ne accorga.
          </li>
          <li>Tu hai un seed client (puoi sceglierlo) e ogni partita usa un nonce 0, 1, 2…</li>
          <li>
            I numeri casuali sono HMAC-SHA256(seed server, «seed client:nonce:contatore»), estratti
            senza distorsioni (rejection sampling); i mazzi sono mescolati con Fisher-Yates.
          </li>
          <li>
            Quando ruoti i seed, il seed del server viene rivelato: nella pagina{' '}
            <Link to="/verifica">Verifica</Link> ricalcoli ogni partita nel tuo browser.
          </li>
        </ol>
      </section>
    </div>
  );
}
