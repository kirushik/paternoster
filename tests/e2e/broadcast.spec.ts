import { test, expect } from '@playwright/test';
import { fillDialogAndConfirm } from './helpers';

/** Enter broadcast mode, set signing state, type message, return encoded output. */
async function composeBroadcast(
  page: import('@playwright/test').Page,
  text: string,
  signed: boolean,
): Promise<string> {
  // Enter broadcast mode (if not already)
  const placeholder = await page.locator('#input').getAttribute('placeholder');
  if (!placeholder?.includes('публикации')) {
    await page.click('#mode-toggle');
    await page.waitForSelector('#input[placeholder*="публикации"]');
  }

  // Set signing state — check current and toggle only if needed
  const toggleBtn = page.locator('#broadcast-sign-toggle');
  const currentText = await toggleBtn.textContent();
  const currentlySigned = currentText === 'Подписано';
  if (signed !== currentlySigned) {
    await toggleBtn.click();
    await expect(toggleBtn).toHaveText(signed ? 'Подписано' : 'Без подписи');
  }

  // Type message and wait for output
  await page.fill('#input', text);
  await page.waitForTimeout(500); // XEdDSA signing can take ~30ms, plus debounce

  const output = page.locator('#output');
  await expect(output).not.toBeEmpty();
  return (await output.textContent())!;
}

/** Leave broadcast mode back to messaging. */
async function exitBroadcastMode(page: import('@playwright/test').Page): Promise<void> {
  await page.click('#mode-toggle');
  await page.waitForSelector('#input[placeholder*="Вставьте"]');
}

test.describe('XEdDSA browser verification', () => {
  test('self-signed broadcast decodes correctly in Chromium', async ({ page }) => {
    await page.goto('http://localhost:5199');
    await page.waitForSelector('#input');

    const encoded = await composeBroadcast(page, 'Тест в браузере', true);

    // Exit broadcast mode and paste the encoded text back
    await exitBroadcastMode(page);
    await page.fill('#input', encoded);
    await page.waitForTimeout(1000);

    // Self is not a contact — shows as signed with fingerprint
    // The key thing is it's detected as a signed broadcast (not re-encoded as plaintext)
    const label = await page.locator('#output-mode-label').textContent();
    expect(label).toMatch(/^Публикация/);
    await expect(page.locator('#output')).toHaveText('Тест в браузере');
  });
});

test.describe('signed broadcast with identity verification', () => {
  test('Alice signs broadcast, Bob verifies her identity via known contact', async ({ browser }) => {
    // ── Setup: two isolated browser contexts ──

    const aliceCtx = await browser.newContext();
    await aliceCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const alice = await aliceCtx.newPage();

    const bobCtx = await browser.newContext();
    await bobCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const bob = await bobCtx.newPage();

    await alice.goto('http://localhost:5199');
    await bob.goto('http://localhost:5199');
    await alice.waitForSelector('#input');
    await bob.waitForSelector('#input');

    // ── Phase 1: Key exchange — Bob adds Alice as contact ──

    await alice.click('[data-id="self"]');
    await alice.waitForTimeout(200);
    const aliceToken = await alice.locator('.invite-token').textContent();

    await bob.fill('#input', aliceToken!);
    await fillDialogAndConfirm(bob, { 'Имя контакта': 'Alice' });
    await expect(bob.locator('.contact-pill', { hasText: 'Alice' })).toBeVisible();

    // Wait for fingerprint cache to populate (async SHA-256)
    await bob.waitForTimeout(500);

    // ── Phase 2: Alice composes a signed broadcast ──

    const broadcastText = 'Всем привет из публикации!';
    const encoded = await composeBroadcast(alice, broadcastText, true);
    await expect(alice.locator('#output-mode-label')).toHaveText('Подписанная публикация');

    // ── Phase 3: Bob receives and verifies the broadcast ──

    await bob.locator('.contact-pill', { hasText: 'Alice' }).click();

    await bob.fill('#input', encoded);

    // Known sender signed broadcast → auto-commits to chat, auto-clears
    await expect(bob.locator('#input')).toHaveValue('', { timeout: 5000 });

    // Broadcast should appear in Alice's chat history with broadcast styling
    const broadcastMsg = bob.locator('.chat-message.broadcast');
    await expect(broadcastMsg).toHaveCount(1);
    await expect(broadcastMsg.locator('.chat-text')).toHaveText(broadcastText);
    await expect(broadcastMsg.locator('.chat-broadcast-label')).toHaveText('Публикация');

    // ── Cleanup ──
    await alice.close(); await bob.close();
    await aliceCtx.close(); await bobCtx.close();
  });

  test('unsigned broadcast shows without sender identity', async ({ page }) => {
    await page.goto('http://localhost:5199');
    await page.waitForSelector('#input');

    const broadcastText = 'Анонимное сообщение';
    const encoded = await composeBroadcast(page, broadcastText, false);
    await expect(page.locator('#output-mode-label')).toHaveText('Публикация без подписи');

    // Switch back to messaging mode and paste
    await exitBroadcastMode(page);
    await page.fill('#input', encoded);
    await page.waitForTimeout(300);

    await expect(page.locator('#output-mode-label')).toHaveText('Публикация · без подписи');
    await expect(page.locator('#output')).toHaveText(broadcastText);
  });

  test('duplicate signed broadcast is deduplicated in chat', async ({ browser }) => {
    const aliceCtx = await browser.newContext();
    await aliceCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const alice = await aliceCtx.newPage();

    const bobCtx = await browser.newContext();
    await bobCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const bob = await bobCtx.newPage();

    await alice.goto('http://localhost:5199');
    await bob.goto('http://localhost:5199');
    await alice.waitForSelector('#input');
    await bob.waitForSelector('#input');

    // Key exchange
    await alice.click('[data-id="self"]');
    await alice.waitForTimeout(200);
    const aliceToken = await alice.locator('.invite-token').textContent();
    await bob.fill('#input', aliceToken!);
    await fillDialogAndConfirm(bob, { 'Имя контакта': 'Alice' });
    await expect(bob.locator('.contact-pill', { hasText: 'Alice' })).toBeVisible();
    await bob.waitForTimeout(500);

    // Alice sends signed broadcast
    const encoded = await composeBroadcast(alice, 'Один раз', true);

    // Bob receives first time → 1 broadcast bubble
    await bob.locator('.contact-pill', { hasText: 'Alice' }).click();
    await bob.fill('#input', encoded);
    await expect(bob.locator('#input')).toHaveValue('', { timeout: 5000 });
    await expect(bob.locator('.chat-message.broadcast')).toHaveCount(1);

    // Bob receives same broadcast again → still 1 bubble (deduplicated)
    await bob.fill('#input', encoded);
    await expect(bob.locator('#input')).toHaveValue('', { timeout: 5000 });
    await expect(bob.locator('.chat-message.broadcast')).toHaveCount(1);

    await alice.close(); await bob.close();
    await aliceCtx.close(); await bobCtx.close();
  });

  test('signed broadcast from unknown sender shows fingerprint', async ({ browser }) => {
    // Alice and Bob do NOT exchange contacts

    const aliceCtx = await browser.newContext();
    await aliceCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const alice = await aliceCtx.newPage();

    const bobCtx = await browser.newContext();
    await bobCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const bob = await bobCtx.newPage();

    await alice.goto('http://localhost:5199');
    await bob.goto('http://localhost:5199');
    await alice.waitForSelector('#input');
    await bob.waitForSelector('#input');

    // Alice composes a signed broadcast (no key exchange with Bob)
    const broadcastText = 'Кто я такой?';
    const encoded = await composeBroadcast(alice, broadcastText, true);

    // Bob pastes it — Alice is NOT in his contacts
    await bob.fill('#input', encoded);
    await bob.waitForTimeout(500);

    // Should show with a fingerprint (4 hex chars)
    const label = await bob.locator('#output-mode-label').textContent();
    expect(label).toMatch(/^Публикация · подпись [0-9A-F]{4}$/);
    await expect(bob.locator('#output')).toHaveText(broadcastText);

    // ── Second broadcast from same Alice — same fingerprint ──

    const encoded2 = await composeBroadcast(alice, 'Это снова я', true);

    await bob.fill('#input', encoded2);
    await bob.waitForTimeout(500);

    const label2 = await bob.locator('#output-mode-label').textContent();
    expect(label2).toBe(label); // same fingerprint = same sender

    // ── Cleanup ──
    await alice.close(); await bob.close();
    await aliceCtx.close(); await bobCtx.close();
  });
});
