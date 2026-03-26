import { test, expect } from '@playwright/test';
import { fillDialogAndConfirm } from './helpers';

test.describe('two-party message exchange', () => {
  test('Alice and Bob exchange messages end-to-end', async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();

    await alicePage.goto('http://localhost:5199');
    await bobPage.goto('http://localhost:5199');
    await alicePage.waitForSelector('#input');
    await bobPage.waitForSelector('#input');

    // Step 1: Alice gets her invite token
    await alicePage.click('[data-id="self"]');
    await expect(alicePage.locator('.invite-token')).toBeVisible();
    const aliceToken = await alicePage.locator('.invite-token').textContent();
    expect(aliceToken).toBeTruthy();

    // Step 2: Bob pastes Alice's token to add her as contact (custom dialog)
    await bobPage.fill('#input', aliceToken!);
    await fillDialogAndConfirm(bobPage, { 'Имя контакта': 'Alice' });

    // Verify Alice appears in Bob's contacts
    await expect(bobPage.locator('.contact-pill', { hasText: 'Alice' })).toBeVisible();

    // Step 3: Bob selects Alice and sends a message
    await bobPage.locator('.contact-pill', { hasText: 'Alice' }).click();
    await bobPage.fill('#input', 'Привет, Алиса!');
    await expect(bobPage.locator('#output')).not.toBeEmpty({ timeout: 5000 });
    const bobOutput = await bobPage.textContent('#output');
    expect(bobOutput).toBeTruthy();
    expect(bobOutput!.length).toBeGreaterThan(10);

    // Step 4: Alice pastes Bob's encoded message
    // Bob's message includes sender key (MSG_INTRODUCTION), so Alice will discover Bob
    await alicePage.fill('#input', bobOutput!);

    // Alice should see the decrypted message
    await expect(alicePage.locator('#output')).toHaveText('Привет, Алиса!');

    // Alice sees "save contact" button for unknown sender
    await expect(alicePage.locator('#save-contact-btn')).toBeVisible();
    await alicePage.click('#save-contact-btn');
    await fillDialogAndConfirm(alicePage, { 'Имя контакта': 'Bob' });

    // Step 5: Alice should now have Bob as a contact, selected and active
    await expect(alicePage.locator('.contact-pill', { hasText: 'Bob' })).toBeVisible();
    await expect(alicePage.locator('.contact-pill.selected', { hasText: 'Bob' })).toBeVisible();

    // Step 6: Bob's first message should appear in Alice's chat history
    const chatMessage = alicePage.locator('.chat-message.received .chat-text');
    await expect(chatMessage).toHaveText('Привет, Алиса!');

    // Step 7: Alice's working area should be clean (input + output cleared)
    await expect(alicePage.locator('#input')).toHaveValue('');
    await expect(alicePage.locator('#output')).toHaveText('');

    await alicePage.close();
    await bobPage.close();
    await aliceContext.close();
    await bobContext.close();
  });
});
