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

  // Set signing state via checkbox
  const signCheckbox = page.locator('#broadcast-sign-toggle');
  const currentlyChecked = await signCheckbox.isChecked();
  if (signed !== currentlyChecked) {
    await signCheckbox.click();
  }

  // Type message and wait for output (XEdDSA signing + debounce)
  await page.fill('#input', text);
  const output = page.locator('#output');
  await expect(output).not.toBeEmpty({ timeout: 5000 });
  return (await output.textContent())!;
}

/** Leave broadcast mode via footer toggle button. */
async function exitBroadcastModeViaToggle(page: import('@playwright/test').Page): Promise<void> {
  await page.click('#mode-toggle');
  await page.waitForSelector('#input[placeholder*="Вставьте"]');
}

/** Leave broadcast mode via banner close button. */
async function exitBroadcastModeViaBanner(page: import('@playwright/test').Page): Promise<void> {
  await page.click('#broadcast-exit');
  await page.waitForSelector('#input[placeholder*="Вставьте"]');
}

test.describe('XEdDSA browser verification', () => {
  test('self-signed broadcast decodes correctly in Chromium', async ({ page }) => {
    await page.goto('http://localhost:5199');
    await page.waitForSelector('#input');

    const encoded = await composeBroadcast(page, 'Тест в браузере', true);

    // Exit broadcast mode and paste the encoded text back
    await exitBroadcastModeViaToggle(page);
    await page.fill('#input', encoded);

    // Own signed broadcast — shows as "Ваша публикация"
    await expect(page.locator('#output-mode-label')).toHaveText('Ваша публикация', { timeout: 5000 });
    await expect(page.locator('#output')).toHaveText('Тест в браузере');
  });
});

test.describe('broadcast mode visual distinction and exit', () => {
  test('broadcast mode applies warm background and shows banner', async ({ page }) => {
    await page.goto('http://localhost:5199');
    await page.waitForSelector('#input');

    // Regular mode — no banner, no broadcast-active class
    await expect(page.locator('#broadcast-banner')).toHaveCount(0);
    const bodyClassBefore = await page.evaluate(() => document.body.className);
    expect(bodyClassBefore).not.toContain('broadcast-active');

    // Enter broadcast mode
    await page.click('#mode-toggle');
    await page.waitForSelector('#broadcast-banner');

    // Banner visible with label and close button
    await expect(page.locator('.broadcast-banner-label')).toContainText('Публикация');
    await expect(page.locator('#broadcast-exit')).toBeVisible();

    // Body has broadcast-active class (warm background)
    const bodyClassAfter = await page.evaluate(() => document.body.className);
    expect(bodyClassAfter).toContain('broadcast-active');
  });

  test('banner close button exits broadcast mode', async ({ page }) => {
    await page.goto('http://localhost:5199');
    await page.waitForSelector('#input');

    // Enter broadcast mode
    await page.click('#mode-toggle');
    await page.waitForSelector('#broadcast-banner');

    // Exit via banner close button
    await exitBroadcastModeViaBanner(page);

    // Banner gone, broadcast-active removed
    await expect(page.locator('#broadcast-banner')).toHaveCount(0);
    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).not.toContain('broadcast-active');
  });

  test('footer toggle also exits broadcast mode', async ({ page }) => {
    await page.goto('http://localhost:5199');
    await page.waitForSelector('#input');

    await page.click('#mode-toggle');
    await page.waitForSelector('#broadcast-banner');

    // Exit via footer toggle
    await exitBroadcastModeViaToggle(page);
    await expect(page.locator('#broadcast-banner')).toHaveCount(0);
  });
});

test.describe('broadcast mode auto-detect pasted content', () => {
  test('pasting own signed broadcast in broadcast mode shows decoded', async ({ page }) => {
    await page.goto('http://localhost:5199');
    await page.waitForSelector('#input');

    // Compose a signed broadcast
    const encoded = await composeBroadcast(page, 'Мой тест', true);

    // Clear input, paste the broadcast back while still in broadcast mode
    await page.fill('#input', '');
    await expect(page.locator('#output')).toBeEmpty();
    await page.fill('#input', encoded);

    // Should decode as own broadcast, stay in broadcast mode
    await expect(page.locator('#output-mode-label')).toHaveText('Ваша публикация', { timeout: 5000 });
    await expect(page.locator('#output')).toHaveText('Мой тест');
    // Banner still visible — still in broadcast mode
    await expect(page.locator('#broadcast-banner')).toBeVisible();
  });

  test('pasting unsigned broadcast in broadcast mode shows decoded', async ({ page }) => {
    await page.goto('http://localhost:5199');
    await page.waitForSelector('#input');

    // Compose an unsigned broadcast
    const encoded = await composeBroadcast(page, 'Анонимка', false);

    // Clear and re-paste while in broadcast mode
    await page.fill('#input', '');
    await expect(page.locator('#output')).toBeEmpty();
    await page.fill('#input', encoded);

    // Should decode in broadcast mode
    await expect(page.locator('#output-mode-label')).toHaveText('Публикация · без подписи', { timeout: 5000 });
    await expect(page.locator('#output')).toHaveText('Анонимка');
    await expect(page.locator('#broadcast-banner')).toBeVisible();
  });

  test('pasting P2P encrypted message in broadcast mode auto-switches to regular', async ({ browser }) => {
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

    // Key exchange: Bob adds Alice
    await alice.click('[data-id="self"]');
    await expect(alice.locator('.invite-token')).toBeVisible();
    const aliceToken = await alice.locator('.invite-token').textContent();

    await bob.fill('#input', aliceToken!);
    await fillDialogAndConfirm(bob, { 'Имя контакта': 'Alice' });
    await expect(bob.locator('.contact-pill', { hasText: 'Alice' })).toBeVisible();

    // Alice adds Bob
    await bob.click('[data-id="self"]');
    await expect(bob.locator('.invite-token')).toBeVisible();
    const bobToken = await bob.locator('.invite-token').textContent();
    await alice.fill('#input', bobToken!);
    await fillDialogAndConfirm(alice, { 'Имя контакта': 'Bob' });

    // Alice sends an INTRO message to Bob
    await alice.locator('.contact-pill', { hasText: 'Bob' }).click();
    await alice.fill('#input', 'Привет Боб');
    await expect(alice.locator('#output')).not.toBeEmpty({ timeout: 5000 });
    const encodedMsg = await alice.locator('#output').textContent();

    // Bob enters broadcast mode
    await bob.click('#mode-toggle');
    await bob.waitForSelector('#broadcast-banner');

    // Bob pastes Alice's encrypted message while in broadcast mode
    await bob.fill('#input', encodedMsg!);

    // Should auto-switch to regular mode (banner gone)
    await expect(bob.locator('#broadcast-banner')).toHaveCount(0, { timeout: 5000 });
    const bodyClass = await bob.evaluate(() => document.body.className);
    expect(bodyClass).not.toContain('broadcast-active');

    await alice.close(); await bob.close();
    await aliceCtx.close(); await bobCtx.close();
  });

  test('plain text in broadcast mode still encodes as broadcast', async ({ page }) => {
    await page.goto('http://localhost:5199');
    await page.waitForSelector('#input');

    // Enter broadcast mode
    await page.click('#mode-toggle');
    await page.waitForSelector('#broadcast-banner');

    // Type plain text — should encode as broadcast
    await page.fill('#input', 'Простой текст');
    await expect(page.locator('#output')).not.toBeEmpty({ timeout: 5000 });

    const label = await page.locator('#output-mode-label').textContent();
    expect(label).toMatch(/^Публикация/);
    // Should still be in broadcast mode
    await expect(page.locator('#broadcast-banner')).toBeVisible();
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
    await expect(alice.locator('.invite-token')).toBeVisible();
    const aliceToken = await alice.locator('.invite-token').textContent();

    await bob.fill('#input', aliceToken!);
    await fillDialogAndConfirm(bob, { 'Имя контакта': 'Alice' });
    await expect(bob.locator('.contact-pill', { hasText: 'Alice' })).toBeVisible();

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
    await exitBroadcastModeViaToggle(page);
    await page.fill('#input', encoded);

    await expect(page.locator('#output-mode-label')).toHaveText('Публикация · без подписи', { timeout: 5000 });
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
    await expect(alice.locator('.invite-token')).toBeVisible();
    const aliceToken = await alice.locator('.invite-token').textContent();
    await bob.fill('#input', aliceToken!);
    await fillDialogAndConfirm(bob, { 'Имя контакта': 'Alice' });
    await expect(bob.locator('.contact-pill', { hasText: 'Alice' })).toBeVisible();

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

    // Should show as unknown sender with fingerprint code
    await expect(bob.locator('#output-mode-label')).not.toBeEmpty({ timeout: 5000 });
    const label = await bob.locator('#output-mode-label').textContent();
    expect(label).toMatch(/^Публикация · неизвестный отправитель \(код [0-9A-F]{4}\)$/);
    await expect(bob.locator('#output')).toHaveText(broadcastText);

    // ── Second broadcast from same Alice — same fingerprint ──

    const encoded2 = await composeBroadcast(alice, 'Это снова я', true);

    await bob.fill('#input', encoded2);
    await expect(bob.locator('#output')).toHaveText('Это снова я', { timeout: 5000 });

    const label2 = await bob.locator('#output-mode-label').textContent();
    expect(label2).toBe(label); // same fingerprint = same sender

    // ── Cleanup ──
    await alice.close(); await bob.close();
    await aliceCtx.close(); await bobCtx.close();
  });
});
