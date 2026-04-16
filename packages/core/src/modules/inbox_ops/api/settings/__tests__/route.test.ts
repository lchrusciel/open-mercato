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
