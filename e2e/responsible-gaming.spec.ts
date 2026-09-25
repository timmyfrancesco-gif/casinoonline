import type { Page } from '@playwright/test';
import type { ApiErrorBody, VideoPokerRoundResponse } from '../packages/shared/src/index.ts';
import {
  STARTING_BALANCE,
  clickAndReadJson,
  expect,
  expectBalance,
  register,
  test,
} from './fixtures.ts';

function limitRow(page: Page, label: string) {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: `Limite di ${label}` }) });
}

test('limite di perdita: una puntata oltre il limite è rifiutata con un messaggio chiaro', async ({
  page,
}) => {
  await register(page, 'limite');
  await page
    .getByRole('navigation', { name: 'Principale' })
    .getByRole('link', { name: 'Gioco responsabile' })
    .click();

  const daily = limitRow(page, '24 ore');
  await daily.getByLabel('Nuovo limite (fiches)').fill('1');
  await daily.getByRole('button', { name: 'Salva' }).click();
  await expect(daily.getByRole('status')).toHaveText(/Limite aggiornato: è già in vigore\./);
  await expect(daily).toContainText('In vigore: 1 fiche');

  await page.goto('/slot');
  await page
    .getByRole('group', { name: 'Puntate rapide' })
    .getByRole('button', { name: '5 fiches', exact: true })
    .click();
  await page.getByRole('button', { name: 'Gira (5 fiches)' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Questa puntata supererebbe il tuo limite di perdita delle 24 ore. Puoi ancora puntare al massimo 1 fiche in questo periodo.',
  );
  await expectBalance(page, STARTING_BALANCE);

  // Raising a limit only takes effect after the cooling-off period.
  await page.goto('/gioco-responsabile');
  await daily.getByLabel('Nuovo limite (fiches)').fill('50');
  await daily.getByRole('button', { name: 'Salva' }).click();
  await expect(daily.getByRole('status')).toHaveText(/Richiesta registrata: entrerà in vigore il /);
  await expect(daily).toContainText('In vigore: 1 fiche');
  await expect(daily).toContainText('In attesa: nuovo limite di 50 fiches');
});

test('autoesclusione: nessuna nuova puntata, ma la mano aperta si può completare', async ({
  page,
}) => {
  await register(page, 'pausa');

  // A video poker hand is left open before the pause.
  await page.goto('/videopoker');
  const dealt = await clickAndReadJson<VideoPokerRoundResponse>(
    page,
    page.getByRole('button', { name: 'Distribuisci (1 fiche)' }),
    '/games/videopoker/deal',
  );
  expect(dealt.round.status).toBe('open');

  await page.goto('/gioco-responsabile');
  await page.getByRole('radio', { name: '24 ore' }).check();
  await page.getByRole('button', { name: 'Prendi una pausa di 24 ore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confermi la pausa?' });
  const confirm = dialog.getByRole('button', { name: 'Conferma la pausa' });
  await expect(confirm).toBeDisabled();
  await dialog
    .getByRole('checkbox', { name: 'Ho capito che la pausa non si può annullare.' })
    .check();
  await dialog.getByLabel('Scrivi PAUSA per confermare').fill('pausa');
  await confirm.click();
  await expect(dialog).toBeHidden();
  const pauseNotice = page
    .getByRole('status')
    .filter({ has: page.getByText('Pausa attiva', { exact: true }) });
  await expect(pauseNotice).toContainText('Fino al');

  // The open hand is resumed after navigation and can still be completed.
  await page.goto('/videopoker');
  await expect(page.getByText('Hai una mano in corso: scegli le carte da tenere')).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Pausa di autoesclusione attiva' }),
  ).toBeVisible();
  const drawn = await clickAndReadJson<VideoPokerRoundResponse>(
    page,
    page.getByRole('button', { name: 'Cambia 5 carte' }),
    '/games/videopoker/draw',
  );
  expect(drawn.round.id).toBe(dealt.round.id);
  expect(drawn.round.status).toBe('settled');
  await expect(page.getByRole('button', { name: 'Distribuisci (1 fiche)' })).toBeDisabled();

  await page.goto('/roulette');
  await expect(
    page.getByRole('status').filter({ hasText: 'Pausa di autoesclusione attiva' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rosso', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Gira la ruota' })).toBeDisabled();

  // The server enforces the pause as well, whatever the client does.
  const res = await page.request.post('/api/games/slot/spin', {
    headers: { 'x-casino-csrf': '1' },
    data: { amount: 100, idempotencyKey: crypto.randomUUID() },
  });
  expect(res.status()).toBe(403);
  const body = (await res.json()) as ApiErrorBody;
  expect(body.error.code).toBe('RG_SELF_EXCLUDED');
  const until = Date.parse((body.error.details as { until: string }).until);
  expect(until).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
});

test('reality check: promemoria modale ogni 15 minuti', async ({ page }) => {
  // Fake timers, installed before the app loads: the 15 minutes are fast-forwarded.
  await page.clock.install();
  // Some latency on /api/rg: a refetch that lands between «Continua» and the next fast-forward
  // must not move the session anchor (regression seen on CI runners).
  await page.route('**/api/rg', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });
  await register(page, 'promemoria');

  await page.goto('/gioco-responsabile');
  const every = page.getByRole('group', { name: 'Mostra il promemoria ogni' });
  await expect(every.getByRole('radio', { name: '30 minuti' })).toBeChecked();
  await every.getByRole('radio', { name: '15 minuti' }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Frequenza aggiornata.' })).toBeVisible();

  // Client-side navigation: the reminder timer, rescheduled when the setting was saved, keeps
  // running (a reload would anchor it to the fake clock, which the server does not share).
  await page.getByRole('link', { name: 'Lobby', exact: true }).click();
  await page.getByRole('link', { name: 'Gioca a Roulette europea' }).click();
  await expect(page.getByRole('button', { name: 'Gira la ruota' })).toBeVisible();
  const reminder = page.getByRole('alertdialog', { name: 'Promemoria di gioco' });
  await page.clock.fastForward('14:00');
  await expect(page.getByRole('button', { name: 'Gira la ruota' })).toBeVisible();
  await expect(reminder).toBeHidden();

  await page.clock.fastForward('01:30');
  await expect(reminder).toBeVisible();
  await expect(reminder).toContainText('Tempo di gioco');
  await expect(reminder).toContainText('0 partite');
  await reminder.getByRole('button', { name: 'Continua a giocare' }).click();
  await expect(reminder).toBeHidden();

  // The next one comes 15 minutes later; "Esci" ends the session.
  await page.clock.fastForward('15:00');
  await expect(reminder).toBeVisible();
  await reminder.getByRole('button', { name: 'Esci' }).click();
  await expect(reminder).toBeHidden();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Accedi' }).first()).toBeVisible();
});
