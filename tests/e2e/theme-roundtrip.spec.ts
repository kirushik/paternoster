import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { fillDialogAndConfirm, sendMessage, receiveFromKnown } from './helpers';

const ALL_THEMES = ['КИТАЙ', 'PATER', 'БОЖЕ', 'БУХАЮ', 'TRUMP', 'РОССИЯ', 'СССР', '🙂', 'hex'];

test.describe('per-theme roundtrip', () => {
  let aliceContext: BrowserContext;
  let bobContext: BrowserContext;
  let alicePage: Page;
  let bobPage: Page;

  test.beforeAll(async ({ browser }) => {
    aliceContext = await browser.newContext();
    await aliceContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    alicePage = await aliceContext.newPage();

    bobContext = await browser.newContext();
    await bobContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    bobPage = await bobContext.newPage();

    await alicePage.goto('http://localhost:5199');
    await bobPage.goto('http://localhost:5199');
    await alicePage.waitForSelector('#input');
    await bobPage.waitForSelector('#input');

    // Bob adds Alice via invite token
    await alicePage.click('[data-id="self"]');
    await expect(alicePage.locator('.invite-token')).toBeVisible();
    const aliceToken = await alicePage.locator('.invite-token').textContent();

    await bobPage.fill('#input', aliceToken!);
    await fillDialogAndConfirm(bobPage, { 'Имя контакта': 'Alice' });
    await expect(bobPage.locator('.contact-pill', { hasText: 'Alice' })).toBeVisible();

    // Bob sends introduction message
    const encoded1 = await sendMessage(bobPage, 'Установка связи');

    // Alice receives, saves Bob as contact
    await alicePage.fill('#input', encoded1);
    await expect(alicePage.locator('#save-contact-btn')).toBeVisible({ timeout: 5000 });
    await alicePage.click('#save-contact-btn');
    await fillDialogAndConfirm(alicePage, { 'Имя контакта': 'Bob' });
    await alicePage.locator('.contact-pill', { hasText: 'Bob' }).click();
    await expect(alicePage.locator('#input')).toHaveValue('', { timeout: 3000 });

    // Alice replies to confirm key exchange
    const encoded2 = await sendMessage(alicePage, 'Связь установлена');
    await receiveFromKnown(bobPage, encoded2);
  });

  test.afterAll(async () => {
    await alicePage.close();
    await bobPage.close();
    await aliceContext.close();
    await bobContext.close();
  });

  for (const themeId of ALL_THEMES) {
    test(`roundtrip with theme ${themeId}`, async () => {
      await alicePage.selectOption('#theme-select', themeId);

      const msg = `Тест ${themeId}`;
      const encoded = await sendMessage(alicePage, msg);
      await receiveFromKnown(bobPage, encoded);

      await expect(
        bobPage.locator('.chat-message.received .chat-text').last(),
      ).toHaveText(msg);
    });
  }
});
