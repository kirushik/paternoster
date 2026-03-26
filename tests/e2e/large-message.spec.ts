import { test, expect } from '@playwright/test';
import { fillDialogAndConfirm, sendMessage, receiveFromKnown } from './helpers';

const LARGE_TEXT = 'Съешь же ещё этих мягких французских булок, да выпей чаю. '.repeat(40);

test.describe('large message conversation', () => {
  test('Alice and Bob exchange large messages after key exchange', async ({ browser }) => {
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

    // ── Key exchange: Bob adds Alice via invite token ──

    await alicePage.click('[data-id="self"]');
    await expect(alicePage.locator('.invite-token')).toBeVisible();
    const aliceToken = await alicePage.locator('.invite-token').textContent();

    await bobPage.fill('#input', aliceToken!);
    await fillDialogAndConfirm(bobPage, { 'Имя контакта': 'Alice' });
    await expect(bobPage.locator('.contact-pill', { hasText: 'Alice' })).toBeVisible();

    // Bob sends introduction (short message to establish key exchange)
    const intro = await sendMessage(bobPage, 'Привет!');

    // Alice receives, saves Bob
    await alicePage.fill('#input', intro);
    await expect(alicePage.locator('#save-contact-btn')).toBeVisible({ timeout: 5000 });
    await alicePage.click('#save-contact-btn');
    await fillDialogAndConfirm(alicePage, { 'Имя контакта': 'Bob' });
    await alicePage.locator('.contact-pill', { hasText: 'Bob' }).click();
    await expect(alicePage.locator('#input')).toHaveValue('', { timeout: 3000 });

    // Alice replies to confirm key exchange
    const reply = await sendMessage(alicePage, 'Привет, Боб!');
    await receiveFromKnown(bobPage, reply);

    // ── Large message exchange (post key-exchange, MSG_STANDARD) ──

    // Alice sends large message to Bob
    const encoded1 = await sendMessage(alicePage, LARGE_TEXT);
    expect(encoded1.length).toBeGreaterThan(1000);

    await receiveFromKnown(bobPage, encoded1);
    await expect(
      bobPage.locator('.chat-message.received .chat-text').last(),
    ).toHaveText(LARGE_TEXT, { timeout: 5000 });

    // Bob sends large reply back to Alice
    const encoded2 = await sendMessage(bobPage, LARGE_TEXT);
    expect(encoded2.length).toBeGreaterThan(1000);

    // This is the exact bug scenario: Alice must decrypt, not re-encrypt
    await receiveFromKnown(alicePage, encoded2);
    await expect(
      alicePage.locator('.chat-message.received .chat-text').last(),
    ).toHaveText(LARGE_TEXT, { timeout: 5000 });

    await alicePage.close();
    await bobPage.close();
    await aliceContext.close();
    await bobContext.close();
  });
});
