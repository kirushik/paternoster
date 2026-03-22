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
    const aliceContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    await alicePage.goto('http://localhost:5199');
    await alicePage.waitForSelector('#input');
    await alicePage.click('[data-id="self"]');
    await alicePage.waitForTimeout(200);

    const inviteLink = await alicePage.locator('.invite-link').getAttribute('href');
    expect(inviteLink).toBeTruthy();

    // Bob opens the invite link — custom dialog appears for naming the contact
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await bobPage.goto(inviteLink!);
    await bobPage.waitForSelector('#input');

    await fillDialogAndConfirm(bobPage, { 'Имя контакта': 'Alice' });

    // Bob should now have Alice as a contact
    await expect(bobPage.locator('.contact-pill', { hasText: 'Alice' })).toBeVisible();

    // Hash should be cleared from URL
    const url = bobPage.url();
    expect(url).not.toContain('#');

    await alicePage.close();
    await bobPage.close();
    await aliceContext.close();
    await bobContext.close();
  });

  test('"+" button adds contact from hex key', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    await page.click('[data-id="add"]');

    // Custom dialog with two fields: token/key and name
    await fillDialogAndConfirm(page, {
      'Код приглашения или ключ': 'AB'.repeat(32),
      'Имя контакта': 'Тестовый контакт',
    });

    await expect(page.locator('.contact-pill', { hasText: 'Тестовый контакт' })).toBeVisible();
  });
});

test.describe('contact interaction', () => {
  test('selecting a contact changes encryption target', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    // Add a contact via "+" button
    await page.click('[data-id="add"]');
    await fillDialogAndConfirm(page, {
      'Код приглашения или ключ': 'CD'.repeat(32),
      'Имя контакта': 'Bob',
    });

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
