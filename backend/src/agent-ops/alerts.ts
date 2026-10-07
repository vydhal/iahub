import type { Agent } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { decryptJson } from '../shared/security/crypto.js';
import { sendEmail, sendTelegram } from './tools/delivery.js';

/** Canal de alerta do agente (falha que exige intervenção, aprovação pendente). Nunca derruba a execução. */
export async function sendAgentAlert(agent: Agent, text: string): Promise<string | null> {
  if (!agent.alertCredentialId) return null;
  try {
    const cred = await prisma.credential.findFirst({ where: { id: agent.alertCredentialId, workspaceId: agent.workspaceId! } });
    if (!cred) return 'credencial de alerta não encontrada';
    const data = decryptJson<Record<string, any>>(cred.encryptedData);
    const signal = AbortSignal.timeout(20_000);
    if (cred.type === 'telegram_bot') await sendTelegram(data, text, undefined, signal);
    else if (cred.type === 'smtp') await sendEmail(data, [data.alertTo || data.from], `[${agent.name}] Alerta de execução`, text);
    else return `tipo ${cred.type} não suporta alertas`;
    return null;
  } catch (err: any) {
    return err?.message || String(err);
  }
}
