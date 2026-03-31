import { expect, type Page } from '@playwright/test';

/** Wait for custom <dialog> to appear, fill fields by placeholder, click confirm. */
export async function fillDialogAndConfirm(
  page: Page,
  fieldValues: Record<string, string>,
): Promise<void> {
  const dialog = page.locator('dialog.app-dialog');
  await dialog.waitFor({ state: 'visible' });

  for (const [placeholder, value] of Object.entries(fieldValues)) {
    await dialog
      .locator(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`)
      .fill(value);
  }

  await dialog.locator('.dialog-confirm').click();
  await dialog.waitFor({ state: 'hidden' });
}

/** Click "Я" and extract the invite token from the invite link href. */
export async function getInviteToken(page: Page): Promise<string> {
  await page.click('[data-id="self"]');
  await expect(page.locator('.invite-link')).toBeVisible();
  const href = await page.locator('.invite-link').getAttribute('href');
  return href!.split('#')[1];
}

/** Open the theme picker panel and click the card for the given theme ID. */
export async function selectTheme(page: Page, themeId: string): Promise<void> {
  await page.click('#theme-trigger');
  await page.click(`.theme-card[data-theme="${themeId}"]`);
}

/** Type a message, wait for encoding, click copy (commits to chat), return encoded text. */
export async function sendMessage(page: Page, text: string): Promise<string> {
  await page.fill('#input', text);

  // Wait for "Скопировать сообщение" — this label only appears after successful encoding,
  // distinguishing fresh encoded output from leftover decode/status text.
  await expect(page.locator('#copy-btn')).toHaveText('Скопировать сообщение', { timeout: 5000 });

  const output = page.locator('#output');
  const encoded = (await output.textContent())!;
  expect(encoded.length).toBeGreaterThan(10);

  await page.click('#copy-btn');

  // After copy, input/output auto-clear
  await expect(page.locator('#input')).toHaveValue('');

  return encoded;
}

/** Paste encoded text that auto-decodes from a known sender (auto-commits to chat, auto-clears). */
export async function receiveFromKnown(page: Page, encoded: string): Promise<void> {
  await page.fill('#input', encoded);
  // Known sender: auto-commits to chat, auto-clears input
  await expect(page.locator('#input')).toHaveValue('', { timeout: 3000 });
}
