import { readFileSync } from 'node:fs';
import type {
  BlackjackRoundResponse,
  RouletteSpinResponse,
  SlotSpinResponse,
  VideoPokerRoundResponse,
} from '../packages/shared/src/index.ts';
import {
  STARTING_BALANCE,
  clickAndReadJson,
  expect,
  expectBalance,
  register,
  reviewScreenshot,
  test,
} from './fixtures.ts';

const GAME_NAMES = {
  roulette: 'Roulette europea',
  slot: 'Slot Frutta',
  blackjack: 'Blackjack',
  videopoker: 'Video Poker Jacks or Better',
} as const;
const COLOR_IT = { red: 'rosso', black: 'nero', green: 'verde' } as const;

test('registrazione, i quattro tavoli, storico e verifica provably fair', async ({ page }) => {
  test.slow();
  const nav = page.getByRole('navigation', { name: 'Principale' });

  await test.step('registrazione con data di nascita: la lobby mostra 1.000 fiches', async () => {
    await register(page, 'giro');
    await expectBalance(page, STARTING_BALANCE);
    await expect(page.getByRole('link', { name: /^Gioca a / })).toHaveCount(4);
    await reviewScreenshot(page, '1-lobby');
  });

  let balance = STARTING_BALANCE;

  await test.step('roulette: rosso + pieno sul 17', async () => {
    await page.getByRole('link', { name: `Gioca a ${GAME_NAMES.roulette}` }).click();
    await expect(page.getByRole('heading', { level: 1, name: GAME_NAMES.roulette })).toBeVisible();
    await page.getByRole('button', { name: 'Rosso', exact: true }).click();
    await page.getByRole('button', { name: '17 nero', exact: true }).click();
    await expect(page.getByRole('button', { name: '17 nero, puntata 1 fiche' })).toBeVisible();
    await expect(page.getByText('Totale: 2 fiches')).toBeVisible();

    const spin = await clickAndReadJson<RouletteSpinResponse>(
      page,
      page.getByRole('button', { name: 'Gira la ruota' }),
      '/games/roulette/spin',
    );
    expect(spin.settlement.totalBet).toBe(200);
    expect(spin.balance).toBe(balance - 200 + spin.settlement.totalWin);
    balance = spin.balance;

    const { number, color } = spin.settlement;
    const result = page.getByRole('region', { name: 'Risultato' });
    await expect(result).toContainText(`È uscito il ${number} ${COLOR_IT[color]}`);
    await expect(page.locator('p[aria-live="polite"]')).toContainText(
      `È uscito il ${number} ${COLOR_IT[color]}.`,
    );
    await expectBalance(page, balance);
    await expect(page.getByRole('button', { name: 'Gira la ruota' })).toBeDisabled(); // no bets left
    await expect(page.getByRole('button', { name: 'Ripeti puntate' })).toBeEnabled();
    await reviewScreenshot(page, '2-roulette-dopo-giro');
  });

  await test.step('slot: un giro da 1 fiche', async () => {
    await nav.getByRole('link', { name: 'Lobby' }).click();
    await page.getByRole('link', { name: `Gioca a ${GAME_NAMES.slot}` }).click();
    const spin = await clickAndReadJson<SlotSpinResponse>(
      page,
      page.getByRole('button', { name: 'Gira (1 fiche)' }),
      '/games/slot/spin',
    );
    expect(spin.balance).toBe(balance - 100 + spin.settlement.win);
    balance = spin.balance;
    // The reels stop on the server outcome, then the balance and the result are shown.
    await expect(page.getByRole('button', { name: 'Gira (1 fiche)' })).toBeEnabled();
    await expect(page.getByText(/^Linea: /).first()).toBeVisible();
    await expectBalance(page, balance);
  });

  await test.step('blackjack: una mano fino alla fine', async () => {
    await nav.getByRole('link', { name: 'Lobby' }).click();
    await page.getByRole('link', { name: `Gioca a ${GAME_NAMES.blackjack}` }).click();
    let hand = await clickAndReadJson<BlackjackRoundResponse>(
      page,
      page.getByRole('button', { name: 'Distribuisci (1 fiche)' }),
      '/games/blackjack/deal',
    );
    // The hole card never leaves the server while the hand is open.
    if (hand.state.phase === 'player') expect(hand.state.dealer.cards).toContain(null);
    while (hand.state.phase === 'player') {
      hand = await clickAndReadJson<BlackjackRoundResponse>(
        page,
        page.getByRole('button', { name: 'Stai', exact: true }),
        '/games/blackjack/action',
      );
    }
    expect(hand.round.status).toBe('settled');
    expect(hand.state.dealer.cards).not.toContain(null);
    balance = hand.balance;
    await expect(page.getByText(/^(Mano vinta|Pareggio|Mano persa|Mano chiusa)$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nuova mano (1 fiche)' })).toBeEnabled();
    await expectBalance(page, balance);
    await reviewScreenshot(page, '3-blackjack');
  });

  await test.step('video poker: distribuisci, tieni la prima carta, cambia', async () => {
    await nav.getByRole('link', { name: 'Lobby' }).click();
    await page.getByRole('link', { name: `Gioca a ${GAME_NAMES.videopoker}` }).click();
    const dealt = await clickAndReadJson<VideoPokerRoundResponse>(
      page,
      page.getByRole('button', { name: 'Distribuisci (1 fiche)' }),
      '/games/videopoker/deal',
    );
    expect(dealt.state.phase).toBe('hold');
    const firstCard = page.getByRole('button', { name: /^Carta 1: / });
    await firstCard.click();
    await expect(firstCard).toHaveAttribute('aria-pressed', 'true');
    const drawn = await clickAndReadJson<VideoPokerRoundResponse>(
      page,
      page.getByRole('button', { name: 'Cambia 4 carte' }),
      '/games/videopoker/draw',
    );
    expect(drawn.state.phase).toBe('settled');
    expect(drawn.state.hand[0]).toBe(dealt.state.hand[0]);
    balance = drawn.balance;
    await expect(page.getByRole('button', { name: 'Distribuisci (1 fiche)' })).toBeEnabled();
    await expectBalance(page, balance);
  });

  await test.step('storico: le quattro partite e il CSV', async () => {
    await nav.getByRole('link', { name: 'Storico' }).click();
    const table = page.getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(5); // header + 4 rounds
    for (const name of Object.values(GAME_NAMES)) {
      await expect(table.getByRole('cell', { name, exact: true })).toBeVisible();
    }
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Scarica CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^storico-fiches-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = readFileSync(await download.path(), 'utf8')
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toMatch(/^id,gioco,stato,puntata_fiches,/);
    expect(lines).toHaveLength(5);
  });

  await test.step('profilo: rotazione dei seed', async () => {
    await nav.getByRole('link', { name: 'Profilo' }).click();
    await expect(page.getByText('Prossimo nonce')).toBeVisible();
    await page.getByRole('button', { name: 'Ruota i seed e rivela quello attuale' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Seed rivelato' })).toBeVisible();
    const revealed = page.getByRole('listitem').filter({ hasText: 'Verifica con questa coppia' });
    await expect(revealed).toHaveCount(1);
    await expect(revealed).toContainText('4 partite (nonce 0–3)');
  });

  for (const [game, name] of Object.entries(GAME_NAMES)) {
    await test.step(`verifica nel browser della partita di ${name}`, async () => {
      await nav.getByRole('link', { name: 'Storico' }).click();
      await page.getByLabel('Gioco', { exact: true }).selectOption(game);
      const rows = page.getByRole('table').getByRole('row');
      await expect(rows).toHaveCount(2);
      await rows
        .nth(1)
        .getByRole('link', { name: /^Dettaglio/ })
        .click();
      await expect(
        page.getByRole('heading', { level: 1, name: new RegExp(`^${name} · partita n\\. \\d+$`) }),
      ).toBeVisible();
      await page.getByRole('main').getByRole('link', { name: 'Verifica', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Verifica di una partita' }),
      ).toBeVisible();
      await expect(page.getByLabel('Seed server (rivelato)')).toHaveValue(/^[0-9a-f]{64}$/);
      await page.getByRole('button', { name: 'Ricalcola' }).click();
      const result = page.getByRole('region', { name: 'Risultato della verifica' });
      await expect(result.getByText('✓ Sì, il seed è quello promesso')).toBeVisible();
      await expect(result.getByText('✓ Sì, esito identico')).toBeVisible();
      if (game === 'roulette') await reviewScreenshot(page, '4-verifica');
    });
  }
});
