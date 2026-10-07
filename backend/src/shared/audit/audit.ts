import { prisma } from '../../config/prisma.js';
import { redact } from '../security/crypto.js';

export async function audit(
  workspaceId: string,
  userId: string | null | undefined,
  action: string,
  entity: string,
  entityId?: string | null,
  metadata?: Record<string, unknown>,
) {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId: userId ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        metadata: metadata ? (redact(metadata) as any) : undefined,
      },
    });
  } catch (err) {
    // Auditoria nunca deve derrubar a operação principal, mas a falha precisa aparecer no log.
    console.error('❌ Falha ao gravar auditoria:', action, err);
  }
}
