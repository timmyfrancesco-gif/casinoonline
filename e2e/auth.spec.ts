import type { ApiErrorBody, BlackjackRoundResponse } from '../packages/shared/src/index.ts';
import {
  PASSWORD,
  STARTING_BALANCE,
  balancePill,
  clickAndReadJson,
  expect,
  expectBalance,
  register,
  test,
} from './fixtures.ts';

test('logout e nuovo accesso', async ({ page }) => {
  const username = await register(page, 'accesso');

  // Logging out from a private page lands on the lobby.
  await page
    .getByRole('navigation', { name: 'Principale' })
    .getByRole('link', { name: 'Profilo' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Profilo' })).toBeVisible();
  await page.getByRole('button', { name: 'Esci' }).click();
  await expect(page).toHaveURL('/');
  await expect(balancePill(page)).toBeHidden();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Il casinò a fiches virtuali' }),
  ).toBeVisible();

  // Private pages send anonymous visitors to "Accedi" and back afterwards.
  await page.goto('/profilo');
  await expect(page).toHaveURL('/accedi');
  await page.getByLabel('Nome utente').fill(username);
  await page.getByLabel('Password').fill('password-sbagliata');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Nome utente o password non corretti.');

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page).toHaveURL('/profilo');
  await expect(page.getByRole('heading', { level: 1, name: 'Profilo' })).toBeVisible();
  await expectBalance(page, STARTING_BALANCE);
});

test('registrazione di un minorenne rifiutata', async ({ page }) => {
  await page.goto('/registrati');
  await page.getByLabel('Nome utente').fill('minorenne_e2e');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Conferma password').fill(PASSWORD);
  const lastYear = new Date().getFullYear() - 1;
  await page.getByLabel('Data di nascita').fill(`${lastYear}-01-15`);
  await page.getByRole('checkbox', { name: /accetto le condizioni/ }).check();
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.getByText('Per registrarti devi avere almeno 18 anni.')).toBeVisible();
  await expect(page).toHaveURL('/registrati');
});

test('cookie di sessione, CSRF e CSP', async ({ page, context }) => {
  const response = await page.goto('/');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-inline');

  await register(page, 'sicurezza');
  const cookie = (await context.cookies()).find((c) => c.name === 'casino_sid');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

  const data = { amount: 100, idempotencyKey: crypto.randomUUID() };
  const noHeader = await page.request.post('/api/games/slot/spin', { data });
  expect(noHeader.status()).toBe(403);
  expect(((await noHeader.json()) as ApiErrorBody).error.code).toBe('CSRF_REJECTED');

  const foreign = await page.request.post('/api/games/slot/spin', {
    data,
    headers: { 'x-casino-csrf': '1', origin: 'https://evil.example' },
  });
  expect(foreign.status()).toBe(403);
  expect(((await foreign.json()) as ApiErrorBody).error.code).toBe('CSRF_REJECTED');

  // Neither rejected request moved the balance.
  const wallet = await page.request.get('/api/wallet');
  expect(await wallet.json()).toEqual({ balance: STARTING_BALANCE });
});

test('blackjack: la mano aperta riprende dopo il ricaricamento', async ({ page }) => {
  await register(page, 'ripresa');
  await page.goto('/blackjack');
  const deal = page.getByRole('button', { name: /^(Distribuisci|Nuova mano) \(1 fiche\)$/ });
  // A natural blackjack settles immediately: deal again until a hand stays open.
  let hand = await clickAndReadJson<BlackjackRoundResponse>(page, deal, '/games/blackjack/deal');
  for (let i = 0; i < 5 && hand.state.phase !== 'player'; i += 1) {
    hand = await clickAndReadJson<BlackjackRoundResponse>(page, deal, '/games/blackjack/deal');
  }
  expect(hand.state.phase).toBe('player');

  await page.reload();
  await expect(page.getByText('Hai una mano in corso: puoi completarla.')).toBeVisible();
  const stand = page.getByRole('button', { name: 'Stai', exact: true });
  const settled = await clickAndReadJson<BlackjackRoundResponse>(
    page,
    stand,
    '/games/blackjack/action',
  );
  expect(settled.round.id).toBe(hand.round.id);
  expect(settled.state.phase).toBe('settled');
  await expectBalance(page, settled.balance);

  // A stale step (e.g. a second tab) is rejected and carries the current round.
  const stale = await page.request.post('/api/games/blackjack/action', {
    headers: { 'x-casino-csrf': '1' },
    data: { roundId: hand.round.id, action: 'stand', step: hand.state.step },
  });
  expect(stale.status()).toBe(409);
  const body = (await stale.json()) as ApiErrorBody;
  expect(body.error.code).toBe('ROUND_NOT_OPEN');
  expect((body.error.details as { round: BlackjackRoundResponse }).round.round.id).toBe(
    hand.round.id,
  );
});

test("eliminazione dell'account: si torna alla lobby e le credenziali non valgono più", async ({
  page,
}) => {
  const username = await register(page, 'addio');
  await page
    .getByRole('navigation', { name: 'Principale' })
    .getByRole('link', { name: 'Profilo' })
    .click();
  await page.getByRole('button', { name: 'Elimina il mio account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Eliminare definitivamente l’account?' });
  await dialog.getByLabel('Password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Elimina definitivamente' }).click();
  await expect(page).toHaveURL('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Il casinò a fiches virtuali' }),
  ).toBeVisible();
  await expect(balancePill(page)).toBeHidden();

  await page.goto('/accedi');
  await page.getByLabel('Nome utente').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Nome utente o password non corretti.');
});
