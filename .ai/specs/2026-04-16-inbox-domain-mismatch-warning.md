# Inbox Domain Mismatch Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect and fix inbox address domain mismatch when `INBOX_OPS_DOMAIN` changes after tenant creation (fixes #1431).

**Architecture:** The GET settings API returns the current `INBOX_OPS_DOMAIN` value alongside settings so the UI can detect mismatch. The PATCH handler accepts `inboxAddress` updates. The settings page shows a warning banner with a one-click domain fix button when the stored domain doesn't match the environment.

**Tech Stack:** Next.js API routes, React client component, Zod validation, MikroORM entity, `apiCall`/`useGuardedMutation`, Jest (unit), Playwright (integration)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/modules/inbox_ops/data/validators.ts` | Modify | Add `inboxAddress` to `updateSettingsSchema` |
| `packages/core/src/modules/inbox_ops/data/__tests__/validators.test.ts` | Modify | Unit tests for the new `inboxAddress` field |
| `packages/core/src/modules/inbox_ops/api/settings/route.ts` | Modify | Return `expectedDomain` in GET; accept `inboxAddress` in PATCH |
| `packages/core/src/modules/inbox_ops/api/settings/__tests__/route.test.ts` | Create | Unit tests for GET (expectedDomain) and PATCH (inboxAddress) |
| `packages/core/src/modules/inbox_ops/backend/inbox-ops/settings/page.tsx` | Modify | Add domain mismatch warning banner with "Update domain" button |
| `packages/core/src/modules/inbox_ops/__integration__/TC-INBOX-DOMAIN-001.spec.ts` | Create | Integration test: domain update via API + warning banner in UI |
| `packages/core/src/modules/inbox_ops/setup.ts` | Modify (optional) | Startup drift detection log |

---

### Task 1: Extend validator to accept `inboxAddress` (TDD)

**Files:**
- Modify: `packages/core/src/modules/inbox_ops/data/__tests__/validators.test.ts`
- Modify: `packages/core/src/modules/inbox_ops/data/validators.ts:254-257`

- [ ] **Step 1: Write failing tests for `updateSettingsSchema`**

In `packages/core/src/modules/inbox_ops/data/__tests__/validators.test.ts`, add `updateSettingsSchema` to the import:

```typescript
import {
  orderPayloadSchema,
  updateOrderPayloadSchema,
  updateShipmentPayloadSchema,
  createContactPayloadSchema,
  linkContactPayloadSchema,
  logActivityPayloadSchema,
  draftReplyPayloadSchema,
  extractionOutputSchema,
  proposalListQuerySchema,
  validateActionPayloadForType,
  updateSettingsSchema,
} from '../validators'
```

Add at the end of the file:

```typescript
describe('updateSettingsSchema', () => {
  it('accepts workingLanguage only', () => {
    const result = updateSettingsSchema.safeParse({ workingLanguage: 'de' })
    expect(result.success).toBe(true)
  })

  it('accepts isActive only', () => {
    const result = updateSettingsSchema.safeParse({ isActive: false })
    expect(result.success).toBe(true)
  })

  it('accepts inboxAddress only', () => {
    const result = updateSettingsSchema.safeParse({ inboxAddress: 'ops-12345678@newdomain.com' })
    expect(result.success).toBe(true)
  })

  it('accepts all fields together', () => {
    const result = updateSettingsSchema.safeParse({
      workingLanguage: 'pl',
      isActive: true,
      inboxAddress: 'ops-12345678@newdomain.com',
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty object (all fields optional)', () => {
    const result = updateSettingsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects invalid email in inboxAddress', () => {
    const result = updateSettingsSchema.safeParse({ inboxAddress: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects inboxAddress that is too short', () => {
    const result = updateSettingsSchema.safeParse({ inboxAddress: 'a@b' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid workingLanguage', () => {
    const result = updateSettingsSchema.safeParse({ workingLanguage: 'fr' })
    expect(result.success).toBe(false)
  })

  it('trims whitespace from inboxAddress', () => {
    const result = updateSettingsSchema.safeParse({ inboxAddress: '  ops-12345678@newdomain.com  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.inboxAddress).toBe('ops-12345678@newdomain.com')
    }
  })
})
```

- [ ] **Step 2: Run tests — expect RED**

Run: `cd packages/core && npx jest --config jest.config.cjs src/modules/inbox_ops/data/__tests__/validators.test.ts --testNamePattern="updateSettingsSchema" --verbose 2>&1 | tail -30`
Expected: `accepts inboxAddress only`, `accepts all fields together`, and `trims whitespace` FAIL because the schema doesn't have an `inboxAddress` field yet (the object will strip unknown keys, so `safeParse` succeeds but `result.data.inboxAddress` is `undefined`).

- [ ] **Step 3: Implement — add `inboxAddress` to the schema**

In `packages/core/src/modules/inbox_ops/data/validators.ts`, replace:

```typescript
export const updateSettingsSchema = z.object({
  workingLanguage: z.enum(['en', 'de', 'es', 'pl']).optional(),
  isActive: z.boolean().optional(),
})
```

with:

```typescript
export const updateSettingsSchema = z.object({
  workingLanguage: z.enum(['en', 'de', 'es', 'pl']).optional(),
  isActive: z.boolean().optional(),
  inboxAddress: z.string().trim().min(5).max(320).email().optional(),
})
```

- [ ] **Step 4: Run tests — expect GREEN**

Run: `cd packages/core && npx jest --config jest.config.cjs src/modules/inbox_ops/data/__tests__/validators.test.ts --testNamePattern="updateSettingsSchema" --verbose 2>&1 | tail -30`
Expected: All 9 `updateSettingsSchema` tests pass.

- [ ] **Step 5: Run full validator test suite to check for regressions**

Run: `cd packages/core && npx jest --config jest.config.cjs src/modules/inbox_ops/data/__tests__/validators.test.ts --verbose 2>&1 | tail -10`
Expected: All tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/inbox_ops/data/validators.ts packages/core/src/modules/inbox_ops/data/__tests__/validators.test.ts
git commit -m "feat(inbox_ops): allow inboxAddress in settings update schema

Adds optional email-validated inboxAddress field to updateSettingsSchema
so the PATCH endpoint can accept domain corrections.

Fixes #1431"
```

---

### Task 2: Extend GET/PATCH settings API route (TDD)

**Files:**
- Create: `packages/core/src/modules/inbox_ops/api/settings/__tests__/route.test.ts`
- Modify: `packages/core/src/modules/inbox_ops/api/settings/route.ts`

- [ ] **Step 1: Write failing unit tests for the settings route**

Create `packages/core/src/modules/inbox_ops/api/settings/__tests__/route.test.ts`:

```typescript
/** @jest-environment node */

import { GET, PATCH } from '@open-mercato/core/modules/inbox_ops/api/settings/route'

const mockGetAuthFromRequest = jest.fn()
const mockFindOneWithDecryption = jest.fn()

const mockEm = {
  flush: jest.fn(),
}

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  invalidate: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return { fork: () => mockEm }
    if (token === 'cache') return mockCache
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn(async (_tenantId: string, fn: () => Promise<unknown>) => fn()),
}))

jest.mock('../../../lib/cache', () => ({
  resolveCache: jest.fn((container: unknown) => {
    try {
      return (container as { resolve: (key: string) => unknown }).resolve('cache')
    } catch {
      return null
    }
  }),
  createSettingsCacheKey: jest.fn((tenantId: string) => `inbox_ops:settings:${tenantId}`),
  createSettingsCacheTag: jest.fn((tenantId: string) => `inbox_ops:settings:${tenantId}`),
  invalidateSettingsCache: jest.fn(),
  SETTINGS_CACHE_TTL_MS: 300000,
}))

jest.mock('../../../lib/eventBus', () => ({
  resolveOptionalEventBus: jest.fn(() => null),
}))

const tenantId = '123e4567-e89b-12d3-a456-426614174001'
const organizationId = '223e4567-e89b-12d3-a456-426614174001'

function makeGetRequest() {
  return new Request('http://localhost/api/inbox_ops/settings', { method: 'GET' })
}

function makePatchRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/inbox_ops/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/inbox_ops/settings', () => {
  const settingsRecord = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    inboxAddress: 'ops-12345678@inbox.mercato.local',
    isActive: true,
    workingLanguage: 'en',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId,
      orgId: organizationId,
      roles: ['admin'],
    })
    mockCache.get.mockResolvedValue(null)
    mockFindOneWithDecryption.mockResolvedValue(settingsRecord)
  })

  test('returns settings with expectedDomain from env', async () => {
    const originalEnv = process.env.INBOX_OPS_DOMAIN
    process.env.INBOX_OPS_DOMAIN = 'custom.resend.app'

    try {
      const response = await GET(makeGetRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.expectedDomain).toBe('custom.resend.app')
      expect(body.settings).toMatchObject({
        id: settingsRecord.id,
        inboxAddress: settingsRecord.inboxAddress,
        isActive: true,
        workingLanguage: 'en',
      })
    } finally {
      if (originalEnv !== undefined) {
        process.env.INBOX_OPS_DOMAIN = originalEnv
      } else {
        delete process.env.INBOX_OPS_DOMAIN
      }
    }
  })

  test('defaults expectedDomain to inbox.mercato.local when env unset', async () => {
    const originalEnv = process.env.INBOX_OPS_DOMAIN
    delete process.env.INBOX_OPS_DOMAIN

    try {
      const response = await GET(makeGetRequest())
      const body = await response.json()

      expect(body.expectedDomain).toBe('inbox.mercato.local')
    } finally {
      if (originalEnv !== undefined) {
        process.env.INBOX_OPS_DOMAIN = originalEnv
      }
    }
  })

  test('returns null settings when no record exists', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    const response = await GET(makeGetRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.settings).toBeNull()
    expect(body.expectedDomain).toBeDefined()
  })

  test('returns 401 when unauthenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await GET(makeGetRequest())
    expect(response.status).toBe(401)
  })
})

describe('PATCH /api/inbox_ops/settings', () => {
  const settingsRecord = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    inboxAddress: 'ops-12345678@inbox.mercato.local',
    isActive: true,
    workingLanguage: 'en',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId,
      orgId: organizationId,
      roles: ['admin'],
    })
    mockFindOneWithDecryption.mockResolvedValue({ ...settingsRecord })
    mockEm.flush.mockResolvedValue(undefined)
  })

  test('updates inboxAddress when provided', async () => {
    const mutableSettings = { ...settingsRecord }
    mockFindOneWithDecryption.mockResolvedValue(mutableSettings)

    const response = await PATCH(makePatchRequest({ inboxAddress: 'ops-12345678@newdomain.com' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mutableSettings.inboxAddress).toBe('ops-12345678@newdomain.com')
    expect(body.settings.inboxAddress).toBe('ops-12345678@newdomain.com')
  })

  test('updates workingLanguage without touching inboxAddress', async () => {
    const mutableSettings = { ...settingsRecord }
    mockFindOneWithDecryption.mockResolvedValue(mutableSettings)

    const response = await PATCH(makePatchRequest({ workingLanguage: 'de' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mutableSettings.workingLanguage).toBe('de')
    expect(mutableSettings.inboxAddress).toBe('ops-12345678@inbox.mercato.local')
  })

  test('rejects invalid email in inboxAddress', async () => {
    const response = await PATCH(makePatchRequest({ inboxAddress: 'not-an-email' }))
    expect(response.status).toBe(400)
  })

  test('returns 404 when settings not found', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    const response = await PATCH(makePatchRequest({ inboxAddress: 'ops-12345678@newdomain.com' }))
    expect(response.status).toBe(404)
  })

  test('returns 401 when unauthenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await PATCH(makePatchRequest({ inboxAddress: 'ops-12345678@newdomain.com' }))
    expect(response.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run tests — expect RED**

Run: `cd packages/core && npx jest --config jest.config.cjs src/modules/inbox_ops/api/settings/__tests__/route.test.ts --verbose 2>&1 | tail -40`
Expected: `returns settings with expectedDomain from env` FAILS (no `expectedDomain` in response). `updates inboxAddress when provided` FAILS (`inboxAddress` unchanged after PATCH).

- [ ] **Step 3: Implement — update GET to return `expectedDomain`**

In `packages/core/src/modules/inbox_ops/api/settings/route.ts`, replace the `responseBody` block (lines 46-53):

```typescript
    const responseBody = {
      settings: settings ? {
        id: settings.id,
        inboxAddress: settings.inboxAddress,
        isActive: settings.isActive,
        workingLanguage: settings.workingLanguage,
      } : null,
    }
```

with:

```typescript
    const expectedDomain = process.env.INBOX_OPS_DOMAIN || 'inbox.mercato.local'

    const responseBody = {
      settings: settings ? {
        id: settings.id,
        inboxAddress: settings.inboxAddress,
        isActive: settings.isActive,
        workingLanguage: settings.workingLanguage,
      } : null,
      expectedDomain,
    }
```

- [ ] **Step 4: Implement — update PATCH to accept `inboxAddress`**

In the PATCH handler, replace lines 99-104:

```typescript
    if (parsed.data.workingLanguage !== undefined) {
      settings.workingLanguage = parsed.data.workingLanguage
    }
    if (parsed.data.isActive !== undefined) {
      settings.isActive = parsed.data.isActive
    }
```

with:

```typescript
    if (parsed.data.workingLanguage !== undefined) {
      settings.workingLanguage = parsed.data.workingLanguage
    }
    if (parsed.data.isActive !== undefined) {
      settings.isActive = parsed.data.isActive
    }
    if (parsed.data.inboxAddress !== undefined) {
      settings.inboxAddress = parsed.data.inboxAddress
    }
```

- [ ] **Step 5: Run tests — expect GREEN**

Run: `cd packages/core && npx jest --config jest.config.cjs src/modules/inbox_ops/api/settings/__tests__/route.test.ts --verbose 2>&1 | tail -40`
Expected: All 9 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/inbox_ops/api/settings/__tests__/route.test.ts packages/core/src/modules/inbox_ops/api/settings/route.ts
git commit -m "feat(inbox_ops): return expectedDomain in GET, accept inboxAddress in PATCH

GET /api/inbox_ops/settings now includes expectedDomain from the
INBOX_OPS_DOMAIN env var so the UI can detect domain drift.

PATCH /api/inbox_ops/settings now accepts inboxAddress to let admins
correct the domain when it has drifted.

Includes unit tests covering env fallback, 401/404 cases, and
inboxAddress mutation vs. workingLanguage isolation.

Fixes #1431"
```

---

### Task 3: Add domain mismatch warning banner + integration tests

**Files:**
- Create: `packages/core/src/modules/inbox_ops/__integration__/TC-INBOX-DOMAIN-001.spec.ts`
- Modify: `packages/core/src/modules/inbox_ops/backend/inbox-ops/settings/page.tsx`

Integration tests are written first. They define the acceptance criteria for the UI behavior. Some tests (API-level) will pass immediately after Task 2. The UI banner test will fail until the page component is updated.

- [ ] **Step 1: Write integration tests**

Create `packages/core/src/modules/inbox_ops/__integration__/TC-INBOX-DOMAIN-001.spec.ts`:

```typescript
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
        body: { inboxAddress: originalAddress },
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
        body: { inboxAddress: testAddress },
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
        body: { inboxAddress: originalAddress },
      });
      originalAddress = null;
    });

    test('PATCH rejects invalid email', async ({ request }) => {
      const response = await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        body: { inboxAddress: 'not-an-email' },
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

      // Read current settings
      const getResponse = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token });
      const getBody = await readJsonSafe<{ settings: { inboxAddress: string } | null; expectedDomain: string }>(getResponse);
      expect(getBody!.settings).toBeTruthy();
      originalAddress = getBody!.settings!.inboxAddress;

      // Force a mismatch by changing the stored address domain
      const localPart = originalAddress!.split('@')[0];
      const mismatchedAddress = `${localPart}@mismatched-domain.example.com`;
      await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        body: { inboxAddress: mismatchedAddress },
      });

      // Reload the settings page — banner should appear
      await page.goto('/backend/inbox-ops/settings');
      await expect(page.getByText(/domain mismatch/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /Update domain/i })).toBeVisible();

      // Click "Update domain" to fix it
      await page.getByRole('button', { name: /Update domain/i }).click();

      // Banner should disappear after successful update
      await expect(page.getByText(/domain mismatch/i)).not.toBeVisible({ timeout: 10000 });

      originalAddress = null; // The button restored it to expectedDomain
    });
  });
});
```

- [ ] **Step 2: Run integration tests — expect partial RED**

Run: `npx playwright test --config .ai/qa/tests/playwright.config.ts TC-INBOX-DOMAIN-001 --reporter=list 2>&1 | tail -30`
Expected: API tests pass (GET/PATCH work from Task 2). The "warning banner appears when domain mismatches" test FAILS because the UI doesn't render the banner yet.

- [ ] **Step 3: Implement — update state and fetch in the settings page**

In `packages/core/src/modules/inbox_ops/backend/inbox-ops/settings/page.tsx`, add state after the existing state declarations (after line 30):

```typescript
  const [expectedDomain, setExpectedDomain] = React.useState<string | null>(null)
  const [isUpdatingDomain, setIsUpdatingDomain] = React.useState(false)
```

Update the `apiCall` type and success branch. Replace:

```typescript
        const result = await apiCall<{ settings: { inboxAddress?: string; isActive?: boolean; workingLanguage?: string } | null }>('/api/inbox_ops/settings')
        if (!cancelled) {
          if (result?.ok && result.result?.settings) {
            setSettings(result.result.settings)
          } else {
```

with:

```typescript
        const result = await apiCall<{ settings: { inboxAddress?: string; isActive?: boolean; workingLanguage?: string } | null; expectedDomain?: string }>('/api/inbox_ops/settings')
        if (!cancelled) {
          if (result?.ok && result.result?.settings) {
            setSettings(result.result.settings)
            if (result.result.expectedDomain) {
              setExpectedDomain(result.result.expectedDomain)
            }
          } else {
```

- [ ] **Step 4: Implement — add mismatch detection and update handler**

After the `handleCopy` callback (after line 62), add:

```typescript
  const currentDomain = settings?.inboxAddress?.split('@')[1] ?? null
  const hasDomainMismatch = Boolean(expectedDomain && currentDomain && currentDomain !== expectedDomain)

  const handleUpdateDomain = React.useCallback(async () => {
    if (!settings?.inboxAddress || !expectedDomain) return
    const localPart = settings.inboxAddress.split('@')[0]
    const newAddress = `${localPart}@${expectedDomain}`
    setIsUpdatingDomain(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean; settings: { inboxAddress: string } }>('/api/inbox_ops/settings', {
        method: 'PATCH',
        body: JSON.stringify({ inboxAddress: newAddress }),
      }),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      setSettings((prev) => prev ? { ...prev, inboxAddress: result.result!.settings.inboxAddress } : prev)
      flash(t('inbox_ops.settings.domain_updated', 'Inbox domain updated'), 'success')
    } else {
      flash(t('inbox_ops.settings.domain_update_failed', 'Failed to update inbox domain'), 'error')
    }
    setIsUpdatingDomain(false)
  }, [settings, expectedDomain, t, runMutation])
```

- [ ] **Step 5: Implement — add warning banner JSX**

Inside the rendered settings block, right before the Forwarding Address `<div>` (before line 100), add:

```tsx
              {hasDomainMismatch && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    {t('inbox_ops.settings.domain_mismatch_title', 'Inbox domain mismatch')}
                  </p>
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                    {t(
                      'inbox_ops.settings.domain_mismatch_description' as never,
                      `Your inbox address uses "${currentDomain}" but INBOX_OPS_DOMAIN is set to "${expectedDomain}". Emails will not be received until this is corrected.`,
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={handleUpdateDomain}
                    disabled={isUpdatingDomain}
                  >
                    {isUpdatingDomain
                      ? t('inbox_ops.settings.updating_domain', 'Updating...')
                      : t('inbox_ops.settings.update_domain', 'Update domain')}
                  </Button>
                </div>
              )}
```

- [ ] **Step 6: Verify build**

Run: `cd packages/core && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 7: Run integration tests — expect GREEN**

Run: `npx playwright test --config .ai/qa/tests/playwright.config.ts TC-INBOX-DOMAIN-001 --reporter=list 2>&1 | tail -30`
Expected: All tests pass — including the banner appearance/disappearance test.

- [ ] **Step 8: Manual smoke test**

1. Start dev server: `yarn dev`
2. Navigate to `/backend/inbox-ops/settings`
3. **No mismatch:** If `INBOX_OPS_DOMAIN` matches stored domain, no banner visible.
4. **Mismatch:** Change `INBOX_OPS_DOMAIN` to a different value, restart, reload. Warning banner appears.
5. Click "Update domain" — address updates, banner disappears, success flash shows.
6. Copy button still works with the updated address.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/modules/inbox_ops/backend/inbox-ops/settings/page.tsx packages/core/src/modules/inbox_ops/__integration__/TC-INBOX-DOMAIN-001.spec.ts
git commit -m "feat(inbox_ops): domain mismatch warning banner with one-click fix

When INBOX_OPS_DOMAIN differs from the stored inbox_settings address,
the settings page shows a prominent warning with an 'Update domain'
button that patches the address in place, keeping the ops-{code}@ prefix.

Includes Playwright integration tests covering:
- GET returns expectedDomain
- PATCH updates/persists/rejects inboxAddress
- Banner visibility on mismatch and disappearance after fix

Fixes #1431"
```

---

### Task 4 (optional): Startup drift detection log in `seedDefaults`

**Files:**
- Modify: `packages/core/src/modules/inbox_ops/setup.ts:44`

This is a secondary safeguard. It logs a warning at startup if the domain has drifted, making the mismatch visible in server logs.

- [ ] **Step 1: Implement drift detection in `seedDefaults`**

In `packages/core/src/modules/inbox_ops/setup.ts`, replace:

```typescript
  async seedDefaults() {},
```

with:

```typescript
  async seedDefaults({ em, tenantId, organizationId }) {
    const settings = await findOneWithDecryption(
      em,
      InboxSettings,
      { tenantId, organizationId, deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
    if (settings) {
      const expectedDomain = process.env.INBOX_OPS_DOMAIN || 'inbox.mercato.local'
      const currentDomain = settings.inboxAddress.split('@')[1]
      if (currentDomain !== expectedDomain) {
        console.warn(
          `[inbox_ops] Domain mismatch: inbox_settings uses "${currentDomain}" but INBOX_OPS_DOMAIN is "${expectedDomain}". ` +
          `Update the domain from the Inbox Settings page or set the env var back to "${currentDomain}".`,
        )
      }
    }
  },
```

- [ ] **Step 2: Verify build**

Run: `cd packages/core && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/modules/inbox_ops/setup.ts
git commit -m "feat(inbox_ops): log warning on startup when inbox domain has drifted

seedDefaults checks if the stored inbox address domain matches
INBOX_OPS_DOMAIN and logs a console warning if they differ.

Fixes #1431"
```
