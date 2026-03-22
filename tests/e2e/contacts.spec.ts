import { test, expect } from '@playwright/test';

test.describe('contact management', () => {
  test('"Я" button shows invite link and contact token', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    // Click "Я" pill
    await page.click('[data-id="self"]');
    await page.waitForTimeout(200);

    // Should show invite link
    const inviteLink = await page.locator('.invite-link').textContent();
    expect(inviteLink).toContain('#');

    // Should show base64url token
    const inviteToken = await page.locator('.invite-token').textContent();
    expect(inviteToken).toBeTruthy();
    expect(inviteToken!.length).toBeGreaterThanOrEqual(43);
  });

  test('invite link opens page and triggers contact import', async ({ browser }) => {
    // Alice generates invite link
    const alicePage = await browser.newPage();
    await alicePage.goto('http://localhost:5199');
    await alicePage.waitForSelector('#input');
    await alicePage.click('[data-id="self"]');
    await alicePage.waitForTimeout(200);

    const inviteLink = await alicePage.locator('.invite-link').getAttribute('href');
    expect(inviteLink).toBeTruthy();

    // Bob opens the invite link
    const bobPage = await browser.newPage();
    // Pre-answer the prompt dialog
    bobPage.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('Alice');
      }
    });
    await bobPage.goto(inviteLink!);
    await bobPage.waitForSelector('#input');
    await bobPage.waitForTimeout(500);

    // Bob should now have Alice as a contact
    const contactText = await bobPage.locator('.contact-pill').allTextContents();
    expect(contactText).toContain('Alice');

    // Hash should be cleared from URL
    const url = bobPage.url();
    expect(url).not.toContain('#');

    await alicePage.close();
    await bobPage.close();
  });

  test('"+" button adds contact from hex key', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    const dialogValues = ['AB'.repeat(32), 'Тестовый контакт'];
    let dialogIdx = 0;
    page.on('dialog', async dialog => {
      await dialog.accept(dialogValues[dialogIdx++]);
    });

    await page.click('[data-id="add"]');
    await page.waitForTimeout(300);

    const pills = await page.locator('.contact-pill').allTextContents();
    expect(pills).toContain('Тестовый контакт');
  });
});

test.describe('contact interaction', () => {
  test('selecting a contact changes encryption target', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    // Add a contact first
    const dialogValues = ['CD'.repeat(32), 'Bob'];
    let dialogIdx = 0;
    page.on('dialog', async dialog => {
      await dialog.accept(dialogValues[dialogIdx++]);
    });
    await page.click('[data-id="add"]');
    await page.waitForTimeout(300);

    // Type a message with "Я" selected
    await page.click('[data-id="self"]');
    await page.fill('#input', 'Тест');
    await page.waitForTimeout(300);
    const output1 = await page.textContent('#output');

    // Select Bob — output should change (different key)
    const bobPill = page.locator('.contact-pill', { hasText: 'Bob' });
    await bobPill.click();
    await page.waitForTimeout(300);
    const output2 = await page.textContent('#output');

    expect(output1).not.toBe(output2);
  });
});
