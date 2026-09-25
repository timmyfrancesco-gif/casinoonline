import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Locator, type Page, type Response } from '@playwright/test';

export { expect };

export const PASSWORD = 'Fiches-virtuali-2026';
export const STARTING_BALANCE = 100_000;

/**
 * Fails the test on JavaScript errors and CSP violations in the page. HTTP error statuses
 * ("Failed to load resource") are expected in some flows and asserted through the UI instead.
 */
export const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error' || msg.text().startsWith('Failed to load resource')) return;
        errors.push(`console: ${msg.text()}`);
      });
      await use(errors);
      expect(errors, 'errori JavaScript o violazioni CSP nel browser').toEqual([]);
    },
    { auto: true },
  ],
});

/** Username allowed by USERNAME_PATTERN (3-20 of [A-Za-z0-9_]), unique across runs. */
export function uniqueUsername(prefix: string): string {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}_${suffix}`.slice(0, 20);
}

/** Chips as the UI formats them: "1.000", "12,50". */
export function formatChips(units: number): string {
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = abs % 100;
  return `${sign}${cents === 0 ? whole : `${whole},${String(cents).padStart(2, '0')}`}`;
}

export function balancePill(page: Page): Locator {
  return page.getByRole('link', { name: /^Saldo: / });
}

export async function expectBalance(page: Page, units: number): Promise<void> {
  await expect(balancePill(page)).toHaveAccessibleName(
    `Saldo: ${formatChips(units)} fiches virtuali. Vai al profilo`,
  );
}

/** Registers through the UI (with birth date) and waits for the lobby. */
export async function register(page: Page, prefix = 'e2e'): Promise<string> {
  const username = uniqueUsername(prefix);
  await page.goto('/registrati');
  await page.getByLabel('Nome utente').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Conferma password').fill(PASSWORD);
  await page.getByLabel('Data di nascita').fill('1990-05-17');
  await page.getByRole('checkbox', { name: /accetto le condizioni/ }).check();
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `Bentornato, ${username}` }),
  ).toBeVisible();
  return username;
}

/** Clicks and returns the parsed JSON of the matching API response. */
export async function clickAndReadJson<T>(
  page: Page,
  target: Locator,
  apiPath: string,
): Promise<T> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r: Response) =>
        new URL(r.url()).pathname === `/api${apiPath}` && r.request().method() !== 'GET',
    ),
    target.click(),
  ]);
  return (await response.json()) as T;
}

/** Optional screenshots for manual review: set E2E_SCREENSHOT_DIR to enable. */
export async function reviewScreenshot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true, animations: 'disabled' });
}
