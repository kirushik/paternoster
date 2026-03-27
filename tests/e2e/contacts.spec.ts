import { test, expect } from '@playwright/test';
import { fillDialogAndConfirm } from './helpers';

test.describe('contact management', () => {
  test('"Я" button shows invite link and contact token', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    // Click "Я" pill
    await page.click('[data-id="self"]');
    await expect(page.locator('.invite-token')).toBeVisible();

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
    await expect(alicePage.locator('.invite-link')).toBeVisible();

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

test.describe('contact deletion', () => {
  test('deleting a contact removes the pill and clears chat', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    // Add a contact
    await page.click('[data-id="add"]');
    await fillDialogAndConfirm(page, {
      'Код приглашения или ключ': 'EE'.repeat(32),
      'Имя контакта': 'Удаляемый',
    });
    await expect(page.locator('.contact-pill', { hasText: 'Удаляемый' })).toBeVisible();

    // Select the contact (shows × button)
    await page.locator('.contact-pill', { hasText: 'Удаляемый' }).click();
    await expect(page.locator('.contact-delete')).toBeVisible();

    // Click × → confirm dialog
    await page.click('.contact-delete');
    const dialog = page.locator('dialog.app-dialog');
    await dialog.waitFor({ state: 'visible' });
    await expect(dialog).toContainText('Удалить контакт?');
    await dialog.locator('.dialog-confirm').click();
    await dialog.waitFor({ state: 'hidden' });

    // Contact pill should be gone
    await expect(page.locator('.contact-pill', { hasText: 'Удаляемый' })).toHaveCount(0);
    // "Я" should be selected (self mode)
    await expect(page.locator('.contact-pill.selected', { hasText: 'Я' })).toBeVisible();
  });
});

test.describe('identity export and import', () => {
  test('export generates a backup blob with password', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    // Open "Я" profile
    await page.click('[data-id="self"]');
    await expect(page.locator('.invite-token')).toBeVisible();

    // Expand "Дополнительно"
    await page.click('summary:has-text("Дополнительно")');

    // Click "Сохранить профиль"
    await page.click('button:has-text("Сохранить профиль")');

    // Fill password dialog
    await fillDialogAndConfirm(page, {
      'Пароль': 'тестпароль',
      'Повторите пароль': 'тестпароль',
    });

    // Output should show backup blob
    await expect(page.locator('#output-mode-label')).toHaveText('Резервная копия');
    const blob = await page.locator('#output').textContent();
    expect(blob!.length).toBeGreaterThan(50);
    await expect(page.locator('#copy-btn')).toContainText('Скопировать копию');
  });

  test('import restores identity from backup blob', async ({ browser }) => {
    // ── Context A: export identity ──

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto('http://localhost:5199');
    await pageA.waitForSelector('#input');

    const keysA = await pageA.evaluate(() => ({
      priv: localStorage.getItem('paternoster_private_key'),
      pub: localStorage.getItem('paternoster_public_key'),
    }));

    await pageA.click('[data-id="self"]');
    await expect(pageA.locator('.invite-token')).toBeVisible();
    await pageA.click('summary:has-text("Дополнительно")');
    await pageA.click('button:has-text("Сохранить профиль")');
    await fillDialogAndConfirm(pageA, {
      'Пароль': 'секрет',
      'Повторите пароль': 'секрет',
    });
    // Wait for export to complete
    await expect(pageA.locator('#output-mode-label')).toHaveText('Резервная копия', { timeout: 5000 });
    const blob = (await pageA.locator('#output').textContent())!.trim();
    expect(blob.length).toBeGreaterThan(50);
    // Verify it looks like base64url
    expect(blob).toMatch(/^[A-Za-z0-9_-]+$/);

    // ── Context B: import identity ──

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto('http://localhost:5199');
    await pageB.waitForSelector('#input');

    // Verify B starts with a different key
    const keysBBefore = await pageB.evaluate(() =>
      localStorage.getItem('paternoster_public_key'),
    );
    expect(keysBBefore).not.toBe(keysA.pub);

    await pageB.click('[data-id="self"]');
    await expect(pageB.locator('.invite-token')).toBeVisible();
    const summary = pageB.locator('summary:has-text("Дополнительно")');
    await expect(summary).toBeVisible();
    await summary.click();
    const restoreBtn = pageB.locator('button:has-text("Восстановить профиль")');
    await expect(restoreBtn).toBeVisible({ timeout: 2000 });
    await restoreBtn.click();
    await fillDialogAndConfirm(pageB, {
      'Вставьте резервную копию': blob!,
      'Пароль': 'секрет',
    });

    await expect(pageB.locator('#output-mode-label')).toHaveText('Профиль восстановлен', { timeout: 5000 });

    // Keys should now match context A
    const keysBAfter = await pageB.evaluate(() => ({
      priv: localStorage.getItem('paternoster_private_key'),
      pub: localStorage.getItem('paternoster_public_key'),
    }));
    expect(keysBAfter.priv).toBe(keysA.priv);
    expect(keysBAfter.pub).toBe(keysA.pub);

    // ── Cleanup ──
    await pageA.close(); await pageB.close();
    await ctxA.close(); await ctxB.close();
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
    await expect(page.locator('#output')).not.toBeEmpty();
    const output1 = await page.textContent('#output');

    // Select Bob — output should change (different key)
    const bobPill = page.locator('.contact-pill', { hasText: 'Bob' });
    await bobPill.click();
    await expect(page.locator('#output')).not.toHaveText(output1!);
    const output2 = await page.textContent('#output');

    expect(output1).not.toBe(output2);
  });
});
