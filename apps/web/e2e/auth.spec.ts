import { expect, test } from '@playwright/test';

/**
 * The auth screens as a browser sees them. No database is involved: these assert the forms and
 * their client-side validation, which is exactly what the e2e job can run without Postgres.
 */

test.describe('login page', () => {
  test('offers both ways in: email + password, and Google', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Mật khẩu')).toBeVisible();
    await expect(page.getByTestId('google-signin')).toHaveText('Đăng nhập với Google');
  });

  test('links to registration and to the guest flow', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('link', { name: 'Đăng ký' }).click();
    await expect(page).toHaveURL(/\/register$/);

    await page.goBack();
    await page.getByRole('link', { name: 'Vào phòng với tư cách khách' }).click();
    await expect(page).toHaveURL(/\/join$/);
  });

  test('shows the provider error NextAuth redirects back with', async ({ page }) => {
    await page.goto('/login?error=OAuthAccountNotLinked');

    await expect(page.getByTestId('login-error')).toBeVisible();
  });
});

test.describe('register page', () => {
  test('refuses a weak password before sending anything to the server', async ({ page }) => {
    let requested = false;
    await page.route('**/api/register', (route) => {
      requested = true;
      return route.abort();
    });

    await page.goto('/register');
    await page.getByLabel('Email').fill('khoi.pv@hblab.vn');
    await page.getByLabel('Mật khẩu').fill('short');
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page.getByTestId('register-errors')).toContainText('ít nhất');
    expect(requested).toBe(false);
  });

  test('rejects an invalid email address', async ({ page }) => {
    await page.goto('/register');

    // The browser's own `type="email"` check accepts a dot-less domain; ours does not, which is
    // the point of validating again in our code.
    await page.getByLabel('Email').fill('khoi@localhost');
    await page.getByLabel('Mật khẩu').fill('planning-poker-42');
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page.getByTestId('register-errors')).toContainText('Email không hợp lệ.');
  });
});

test('the home page points at both identities', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('home-login-link')).toBeVisible();
  await expect(page.getByTestId('home-guest-link')).toBeVisible();
  await expect(page.getByTestId('auth-status')).toContainText('Chưa đăng nhập');
});
