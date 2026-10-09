import { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../shared/audit/audit.js';
import { decryptJson, encryptJson } from '../../shared/security/crypto.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

const REDIRECT_URI = () => `${env.PUBLIC_API_URL}/api/integrations/google-drive/callback`;

function oauthConfigured() {
  return !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
}

function oauthClient() {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, REDIRECT_URI());
}

const NOT_CONFIGURED_MESSAGE =
  'Integração com Google Drive não está configurada nesta instalação. Peça ao administrador da plataforma para cadastrar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.';

/** Devolve um client do Drive já autenticado para o workspace, renovando o access token se preciso. */
export async function getDriveClientForWorkspace(workspaceId: string) {
  const conn = await prisma.googleDriveConnection.findUnique({ where: { workspaceId } });
  if (!conn) throw new Error('Workspace sem Google Drive conectado.');
  if (!oauthConfigured()) throw new Error(NOT_CONFIGURED_MESSAGE);

  const client = oauthClient();
  const accessToken = decryptJson<{ token: string }>(conn.accessToken.slice(4)).token;
  const refreshToken = decryptJson<{ token: string }>(conn.refreshToken.slice(4)).token;
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken, expiry_date: conn.tokenExpiresAt.getTime() });

  if (conn.tokenExpiresAt.getTime() < Date.now() + 60_000) {
    const { credentials } = await client.refreshAccessToken();
    await prisma.googleDriveConnection.update({
      where: { workspaceId },
      data: {
        accessToken: `enc:${encryptJson({ token: credentials.access_token })}`,
        tokenExpiresAt: new Date(credentials.expiry_date || Date.now() + 3500_000),
      },
    });
    client.setCredentials(credentials);
  }

  return google.drive({ version: 'v3', auth: client });
}

function present(conn: { connectedEmail: string | null; rootFolderId: string | null; rootFolderName: string | null; status: string; lastError: string | null; updatedAt: Date } | null) {
  if (!conn) return { connected: false };
  return {
    connected: true,
    email: conn.connectedEmail,
    rootFolderId: conn.rootFolderId,
    rootFolderName: conn.rootFolderName,
    status: conn.status,
    lastError: conn.lastError,
    updatedAt: conn.updatedAt,
  };
}

export async function googleDriveRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('integracoes') };

  fastify.get('/status', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const conn = await prisma.googleDriveConnection.findUnique({ where: { workspaceId } });
    return reply.send(present(conn));
  });

  fastify.get('/connect-url', guard, async (request, reply) => {
    if (!oauthConfigured()) return reply.status(422).send({ message: NOT_CONFIGURED_MESSAGE });
    const { workspaceId, userId } = tenantOf(request);
    const state = fastify.jwt.sign({ purpose: 'gdrive-oauth', workspaceId, userId }, { expiresIn: '10m' });
    const url = oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: OAUTH_SCOPES,
      state,
    });
    return reply.send({ url });
  });

  // O Google redireciona o navegador direto pra cá — não há header de sessão, então a
  // identidade do workspace/usuário vem do `state` assinado gerado em /connect-url.
  fastify.get('/callback', async (request, reply) => {
    const { code, state, error } = request.query as { code?: string; state?: string; error?: string };
    const back = (q: string) => reply.redirect(`${env.PUBLIC_WEB_URL}/?${q}`);

    if (error) return back(`gdrive=erro&msg=${encodeURIComponent('Autorização cancelada no Google.')}`);
    if (!code || !state) return back(`gdrive=erro&msg=${encodeURIComponent('Resposta inválida do Google.')}`);

    let payload: { workspaceId: string; userId: string; purpose: string };
    try {
      payload = fastify.jwt.verify(state) as any;
      if (payload.purpose !== 'gdrive-oauth') throw new Error('state inválido');
    } catch {
      return back(`gdrive=erro&msg=${encodeURIComponent('Link de autorização expirado, tente conectar de novo.')}`);
    }

    try {
      const client = oauthClient();
      const { tokens } = await client.getToken(code);
      if (!tokens.access_token || !tokens.refresh_token) {
        // O Google só manda refresh_token na primeira autorização (prompt=consent garante isso,
        // mas se o usuário já tinha autorizado antes sem revogar, pode faltar).
        throw new Error('O Google não devolveu um refresh token. Revogue o acesso em myaccount.google.com/permissions e conecte de novo.');
      }
      client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: client });
      const { data: userinfo } = await oauth2.userinfo.get();

      const drive = google.drive({ version: 'v3', auth: client });
      const workspace = await prisma.workspace.findUnique({ where: { id: payload.workspaceId }, select: { name: true } });
      const folderName = `AI Creative Studio — ${workspace?.name || 'Workspace'}`;
      const folder = await drive.files.create({
        requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id, name',
      });

      await prisma.googleDriveConnection.upsert({
        where: { workspaceId: payload.workspaceId },
        create: {
          workspaceId: payload.workspaceId,
          connectedEmail: userinfo.email || null,
          accessToken: `enc:${encryptJson({ token: tokens.access_token })}`,
          refreshToken: `enc:${encryptJson({ token: tokens.refresh_token })}`,
          tokenExpiresAt: new Date(tokens.expiry_date || Date.now() + 3500_000),
          rootFolderId: folder.data.id,
          rootFolderName: folder.data.name,
          status: 'connected',
        },
        update: {
          connectedEmail: userinfo.email || null,
          accessToken: `enc:${encryptJson({ token: tokens.access_token })}`,
          refreshToken: `enc:${encryptJson({ token: tokens.refresh_token })}`,
          tokenExpiresAt: new Date(tokens.expiry_date || Date.now() + 3500_000),
          rootFolderId: folder.data.id,
          rootFolderName: folder.data.name,
          status: 'connected',
          lastError: null,
        },
      });

      await audit(payload.workspaceId, payload.userId, 'integration.google_drive.connect', 'google_drive_connection', payload.workspaceId, {
        email: userinfo.email,
      });

      return back('gdrive=conectado');
    } catch (err: any) {
      return back(`gdrive=erro&msg=${encodeURIComponent(err.message || 'Falha ao conectar o Google Drive.')}`);
    }
  });

  fastify.delete('/disconnect', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const conn = await prisma.googleDriveConnection.findUnique({ where: { workspaceId } });
    if (!conn) return reply.status(404).send({ message: 'Nenhuma conexão para remover.' });

    if (oauthConfigured()) {
      try {
        const client = oauthClient();
        const refreshToken = decryptJson<{ token: string }>(conn.refreshToken.slice(4)).token;
        await client.revokeToken(refreshToken);
      } catch {
        // Revogação best-effort: mesmo se falhar (token já expirado/revogado), seguimos e apagamos localmente.
      }
    }

    await prisma.googleDriveConnection.delete({ where: { workspaceId } });
    await audit(workspaceId, userId, 'integration.google_drive.disconnect', 'google_drive_connection', workspaceId, {});
    return reply.status(204).send();
  });
}
