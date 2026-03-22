import { test, expect, type Page } from '@playwright/test';

/** Wait for custom <dialog> to appear, fill fields by placeholder, click confirm. */
async function fillDialogAndConfirm(
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

/** Type a message, wait for encoding, click copy (commits to chat), return encoded text. */
async function sendMessage(page: Page, text: string): Promise<string> {
  await page.fill('#input', text);
  await page.waitForTimeout(300); // debounce is 150ms

  const output = page.locator('#output');
  await expect(output).not.toBeEmpty();
  const encoded = (await output.textContent())!;
  expect(encoded.length).toBeGreaterThan(10);

  await expect(page.locator('#copy-btn')).toHaveText('Скопировать сообщение');
  await page.click('#copy-btn');

  // After copy, input/output auto-clear
  await expect(page.locator('#input')).toHaveValue('');

  return encoded;
}

/** Paste encoded text that auto-decodes from a known sender (auto-commits to chat, auto-clears). */
async function receiveFromKnown(page: Page, encoded: string): Promise<void> {
  await page.fill('#input', encoded);
  // Known sender: auto-commits to chat, auto-clears input
  await expect(page.locator('#input')).toHaveValue('', { timeout: 3000 });
}

test.describe('multi-round conversation', () => {
  test('Alice and Bob exchange keys and have a full back-and-forth conversation', async ({ browser }) => {
    // ── Phase 1: Setup — isolated contexts with separate identities ──

    const aliceContext = await browser.newContext();
    await aliceContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    const alicePage = await aliceContext.newPage();

    const bobContext = await browser.newContext();
    await bobContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    const bobPage = await bobContext.newPage();

    await alicePage.goto('http://localhost:5199');
    await bobPage.goto('http://localhost:5199');
    await alicePage.waitForSelector('#input');
    await bobPage.waitForSelector('#input');

    // ── Phase 2: Contact exchange — Bob adds Alice via invite token ──

    await alicePage.click('[data-id="self"]');
    await alicePage.waitForTimeout(200);
    const aliceToken = await alicePage.locator('.invite-token').textContent();
    expect(aliceToken).toBeTruthy();

    // Bob pastes Alice's invite token → custom dialog appears
    await bobPage.fill('#input', aliceToken!);
    await fillDialogAndConfirm(bobPage, { 'Имя контакта': 'Alice' });

    // Alice should appear in Bob's contacts (and be auto-selected)
    await expect(bobPage.locator('.contact-pill', { hasText: 'Alice' })).toBeVisible();

    // ── Phase 3: Bob→Alice first message (MSG_INTRODUCTION) ──

    const msg1 = 'Привет, Алиса!';
    const encoded1 = await sendMessage(bobPage, msg1);
    const introductionLength = encoded1.length;

    // Bob's chat should show 1 sent message
    await expect(bobPage.locator('.chat-message.sent')).toHaveCount(1);
    await expect(bobPage.locator('.chat-message.sent .chat-text')).toHaveText(msg1);

    // Alice pastes Bob's encoded message — unknown sender
    await alicePage.fill('#input', encoded1);
    await alicePage.waitForTimeout(300);

    await expect(alicePage.locator('#output-mode-label')).toContainText('от нового контакта');
    await expect(alicePage.locator('#output')).toHaveText(msg1);
    await expect(alicePage.locator('#save-contact-btn')).toBeVisible();

    // Alice saves Bob as a contact
    await alicePage.click('#save-contact-btn');
    await fillDialogAndConfirm(alicePage, { 'Имя контакта': 'Bob' });

    // Bob pill appears in Alice's contacts
    await expect(alicePage.locator('.contact-pill', { hasText: 'Bob' })).toBeVisible();

    // Alice clicks Bob's pill → re-processes input → message commits to chat retroactively
    await alicePage.locator('.contact-pill', { hasText: 'Bob' }).click();
    await expect(alicePage.locator('#input')).toHaveValue('', { timeout: 3000 });

    // Alice's chat should show the received message
    await expect(alicePage.locator('.chat-message.received')).toHaveCount(1);
    await expect(alicePage.locator('.chat-message.received .chat-text')).toHaveText(msg1);

    // ── Phase 4: Alice→Bob reply (MSG_STANDARD — keyExchangeConfirmed=true) ──

    const msg2 = 'Привет, Алиса!'; // same text as msg1 to isolate wire format difference
    const encoded2 = await sendMessage(alicePage, msg2);

    // MSG_STANDARD should be shorter than MSG_INTRODUCTION (no 32-byte ephemeral key).
    // Use identical plaintext so stego randomness is the only noise source,
    // and allow a small margin for cosmetic variation.
    expect(encoded2.length).toBeLessThan(introductionLength + 50);

    // Alice's chat: 1 received + 1 sent = 2
    await expect(alicePage.locator('.chat-message')).toHaveCount(2);
    await expect(alicePage.locator('.chat-message.sent .chat-text')).toHaveText(msg2);

    // Bob receives Alice's reply (known sender — auto-commits)
    await receiveFromKnown(bobPage, encoded2);

    // Bob's chat: 1 sent + 1 received = 2
    await expect(bobPage.locator('.chat-message')).toHaveCount(2);
    await expect(bobPage.locator('.chat-message.received .chat-text')).toHaveText(msg2);

    // ── Phase 5: Second round — both directions with MSG_STANDARD ──

    const msg3 = 'Как дела?';
    const encoded3 = await sendMessage(bobPage, msg3);
    await expect(bobPage.locator('.chat-message')).toHaveCount(3);

    await receiveFromKnown(alicePage, encoded3);
    await expect(alicePage.locator('.chat-message')).toHaveCount(3);

    const msg4 = 'Хорошо!';
    const encoded4 = await sendMessage(alicePage, msg4);
    await expect(alicePage.locator('.chat-message')).toHaveCount(4);

    await receiveFromKnown(bobPage, encoded4);
    await expect(bobPage.locator('.chat-message')).toHaveCount(4);

    // ── Phase 6: Final verification — chat history content and order ──

    const expectedMessages = [msg1, msg2, msg3, msg4];

    // Bob's view: sent, received, sent, received
    const bobTexts = await bobPage.locator('.chat-message .chat-text').allTextContents();
    expect(bobTexts).toEqual(expectedMessages);

    const bobDirections = await bobPage.locator('.chat-message').evaluateAll(els =>
      els.map(el => (el.classList.contains('sent') ? 'sent' : 'received')),
    );
    expect(bobDirections).toEqual(['sent', 'received', 'sent', 'received']);

    // Alice's view: received, sent, received, sent
    const aliceTexts = await alicePage.locator('.chat-message .chat-text').allTextContents();
    expect(aliceTexts).toEqual(expectedMessages);

    const aliceDirections = await alicePage.locator('.chat-message').evaluateAll(els =>
      els.map(el => (el.classList.contains('sent') ? 'sent' : 'received')),
    );
    expect(aliceDirections).toEqual(['received', 'sent', 'received', 'sent']);

    // Verify key exchange is confirmed on both sides
    const bobContacts = await bobPage.evaluate(() =>
      JSON.parse(localStorage.getItem('paternoster_contacts') || '[]'),
    );
    expect(bobContacts).toHaveLength(1);
    expect(bobContacts[0].keyExchangeConfirmed).toBe(true);

    const aliceContacts = await alicePage.evaluate(() =>
      JSON.parse(localStorage.getItem('paternoster_contacts') || '[]'),
    );
    expect(aliceContacts).toHaveLength(1);
    expect(aliceContacts[0].keyExchangeConfirmed).toBe(true);

    // ── Cleanup ──

    await alicePage.close();
    await bobPage.close();
    await aliceContext.close();
    await bobContext.close();
  });
});
