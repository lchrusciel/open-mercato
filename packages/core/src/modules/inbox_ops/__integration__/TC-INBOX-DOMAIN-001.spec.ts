import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-INBOX-DOMAIN-001: Inbox Domain Mismatch Detection & Update
 * Verifies:
 * - GET /api/inbox_ops/settings returns expectedDomain
 * - PATCH /api/inbox_ops/settings accepts and persists inboxAddress update
 * - PATCH rejects invalid email
 * - UI shows warning banner when domain mismatches (and hides when it matches)
 */
test.describe('TC-INBOX-DOMAIN-001: Inbox Domain Mismatch', () => {
  let token: string;
  let originalAddress: string | null = null;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
  });

  test.afterAll(async ({ request }) => {
    if (originalAddress) {
      await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        data: { inboxAddress: originalAddress },
      });
    }
  });

  test.describe('API — Settings Domain', () => {
    test('GET returns expectedDomain field', async ({ request }) => {
      const response = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token });
      expect(response.status()).toBe(200);

      const body = await readJsonSafe<{ settings: { inboxAddress: string } | null; expectedDomain: string }>(response);
      expect(body).toBeDefined();
      expect(body!.expectedDomain).toBeTruthy();
      expect(typeof body!.expectedDomain).toBe('string');
    });

    test('PATCH updates inboxAddress and persists', async ({ request }) => {
      const getResponse = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token });
      const getBody = await readJsonSafe<{ settings: { inboxAddress: string } | null }>(getResponse);
      expect(getBody!.settings).toBeTruthy();
      originalAddress = getBody!.settings!.inboxAddress;

      const localPart = originalAddress!.split('@')[0];
      const testAddress = `${localPart}@test-domain-${Date.now()}.example.com`;

      const patchResponse = await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        data: { inboxAddress: testAddress },
      });
      expect(patchResponse.status()).toBe(200);
      const patchBody = await readJsonSafe<{ ok: boolean; settings: { inboxAddress: string } }>(patchResponse);
      expect(patchBody!.ok).toBe(true);
      expect(patchBody!.settings.inboxAddress).toBe(testAddress);

      const verifyResponse = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token });
      const verifyBody = await readJsonSafe<{ settings: { inboxAddress: string } | null }>(verifyResponse);
      expect(verifyBody!.settings!.inboxAddress).toBe(testAddress);

      await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        data: { inboxAddress: originalAddress },
      });
      originalAddress = null;
    });

    test('PATCH rejects invalid email', async ({ request }) => {
      const response = await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        data: { inboxAddress: 'not-an-email' },
      });
      expect(response.status()).toBe(400);
    });
  });

  test.describe('UI — Domain Mismatch Banner', () => {
    test('no warning banner when domain matches', async ({ page, request }) => {
      await login(page, 'admin');
      await page.goto('/backend/inbox-ops/settings');

      await expect(page.getByText(/Forwarding Address/i)).toBeVisible();

      const response = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token });
      const body = await readJsonSafe<{
        settings: { inboxAddress: string } | null;
        expectedDomain: string;
      }>(response);

      if (body?.settings) {
        const currentDomain = body.settings.inboxAddress.split('@')[1];
        if (currentDomain === body.expectedDomain) {
          await expect(page.getByText(/domain mismatch/i)).not.toBeVisible();
        }
      }
    });

    test('warning banner appears when domain mismatches and disappears after update', async ({ page, request }) => {
      await login(page, 'admin');

      const getResponse = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token });
      const getBody = await readJsonSafe<{ settings: { inboxAddress: string } | null; expectedDomain: string }>(getResponse);
      expect(getBody!.settings).toBeTruthy();
      originalAddress = getBody!.settings!.inboxAddress;

      const localPart = originalAddress!.split('@')[0];
      const mismatchedAddress = `${localPart}@mismatched-domain.example.com`;
      await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        data: { inboxAddress: mismatchedAddress },
      });

      await page.goto('/backend/inbox-ops/settings');
      await expect(page.getByText(/domain mismatch/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /Update domain/i })).toBeVisible();

      await page.getByRole('button', { name: /Update domain/i }).click();

      await expect(page.getByText(/domain mismatch/i)).not.toBeVisible({ timeout: 10000 });

      originalAddress = null;
    });
  });
});
