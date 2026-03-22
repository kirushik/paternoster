import { test, expect, type Page } from '@playwright/test';

test.describe('two-party message exchange', () => {
  test('Alice and Bob exchange messages end-to-end', async ({ browser }) => {
    const alicePage = await browser.newPage();
    const bobPage = await browser.newPage();

    await alicePage.goto('http://localhost:5199');
    await bobPage.goto('http://localhost:5199');
    await alicePage.waitForSelector('#input');
    await bobPage.waitForSelector('#input');

    // Step 1: Alice gets her invite token
    await alicePage.click('[data-id="self"]');
    await alicePage.waitForTimeout(200);
    const aliceToken = await alicePage.locator('.invite-token').textContent();
    expect(aliceToken).toBeTruthy();

    // Step 2: Bob pastes Alice's token to add her as contact
    bobPage.on('dialog', async dialog => {
      if (dialog.message().includes('контакт')) {
        await dialog.accept('Alice');
      }
    });
    await bobPage.fill('#input', aliceToken!);
    await bobPage.waitForTimeout(500);

    // Verify Alice appears in Bob's contacts
    const bobContacts = await bobPage.locator('.contact-pill').allTextContents();
    expect(bobContacts).toContain('Alice');

    // Step 3: Bob selects Alice and sends a message
    await bobPage.click(`.contact-pill:text("Alice")`);
    await bobPage.waitForTimeout(200);
    await bobPage.fill('#input', 'Привет, Алиса!');
    await bobPage.waitForTimeout(500);
    const bobOutput = await bobPage.textContent('#output');
    expect(bobOutput).toBeTruthy();
    expect(bobOutput!.length).toBeGreaterThan(10);

    // Step 4: Alice pastes Bob's encoded message
    // Bob's message includes sender key (first message), so Alice will discover Bob
    alicePage.on('dialog', async dialog => {
      if (dialog.message().includes('контакт')) {
        await dialog.accept('Bob');
      }
    });
    await alicePage.fill('#input', bobOutput!);
    await alicePage.waitForTimeout(500);

    // Alice should see the decrypted message
    const aliceOutput = await alicePage.textContent('#output');
    expect(aliceOutput).toBe('Привет, Алиса!');

    // Step 5: Alice should now have Bob as a contact (auto-discovered via sender key)
    const aliceContacts = await alicePage.locator('.contact-pill').allTextContents();
    expect(aliceContacts).toContain('Bob');

    await alicePage.close();
    await bobPage.close();
  });
});
