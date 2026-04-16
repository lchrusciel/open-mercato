import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxSettings } from './data/entities'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['inbox_ops.*'],
    admin: [
      'inbox_ops.proposals.view',
      'inbox_ops.proposals.manage',
      'inbox_ops.settings.manage',
      'inbox_ops.log.view',
      'inbox_ops.replies.send',
    ],
    employee: [
      'inbox_ops.proposals.view',
      'inbox_ops.proposals.manage',
      'inbox_ops.replies.send',
    ],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    const exists = await findOneWithDecryption(
      em,
      InboxSettings,
      { tenantId, organizationId, deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
    if (!exists) {
      const domain = process.env.INBOX_OPS_DOMAIN || 'inbox.mercato.local'
      const slug = organizationId.slice(0, 8)
      const inboxAddress = `ops-${slug}@${domain}`
      em.persist(em.create(InboxSettings, {
        tenantId,
        organizationId,
        inboxAddress,
        isActive: true,
      }))
    }
    await em.flush()
  },

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
}

export default setup
