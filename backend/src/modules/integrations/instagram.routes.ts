import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../shared/audit/audit.js';
import { decryptJson, encryptJson } from '../../shared/security/crypto.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const OAUTH_DIALOG = 'https://www.facebook.com/v21.0/dialog/oauth';
const SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement', 'business_management'];

const REDIRECT_URI = () => `${env.PUBLIC_API_URL}/api/integrations/instagram/callback`;

function appConfigured() {
  return !!env.FACEBOOK_APP_ID && !!env.FACEBOOK_APP_SECRET;
}

const NOT_CONFIGURED_MESSAGE =
  'Integração com Instagram não está configurada nesta instalação. Peça ao administrador da plataforma para cadastrar FACEBOOK_APP_ID e FACEBOOK_APP_SECRET.';

function present(conn: { pageName: string | null; igUsername: string | null; status: string; lastError: string | null; updatedAt: Date } | null) {
  if (!conn) return { connected: false };
  return { connected: true, pageName: conn.pageName, igUsername: conn.igUsername, status: conn.status, lastError: conn.lastError, updatedAt: conn.updatedAt };
}

async function findOwnedBrand(workspaceId: string, brandId: string) {
  return prisma.brand.findFirst({ where: { id: brandId, workspaceId }, select: { id: true, name: true } });
}

export async function instagramRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('marcas') };

  fastify.get('/status', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { brandId } = z.object({ brandId: z.string() }).parse(request.query);
    const brand = await findOwnedBrand(workspaceId, brandId);
    if (!brand) return reply.status(404).send({ message: 'Marca não encontrada' });
    const conn = await prisma.instagramConnection.findUnique({ where: { brandId } });
    return reply.send(present(conn));
  });

  fastify.get('/connect-url', guard, async (request, reply) => {
    if (!appConfigured()) return reply.status(422).send({ message: NOT_CONFIGURED_MESSAGE });
    const { workspaceId, userId } = tenantOf(request);
    const { brandId } = z.object({ brandId: z.string() }).parse(request.query);
    const brand = await findOwnedBrand(workspaceId, brandId);
    if (!brand) return reply.status(404).send({ message: 'Marca não encontrada' });

    const state = fastify.jwt.sign({ purpose: 'instagram-oauth', workspaceId, userId, brandId }, { expiresIn: '10m' });
    const url = `${OAUTH_DIALOG}?${new URLSearchParams({
      client_id: env.FACEBOOK_APP_ID!,
      redirect_uri: REDIRECT_URI(),
      state,
      scope: SCOPES.join(','),
      response_type: 'code',
    })}`;
    return reply.send({ url });
  });

  // Facebook redireciona o navegador direto pra cá — sem sessão, a identidade vem do `state`.
  fastify.get('/callback', async (request, reply) => {
    const { code, state, error } = request.query as { code?: string; state?: string; error?: string };
    const back = (q: string) => reply.redirect(`${env.PUBLIC_WEB_URL}/?${q}`);

    if (error) return back(`instagram=erro&msg=${encodeURIComponent('Autorização cancelada no Facebook.')}`);
    if (!code || !state) return back(`instagram=erro&msg=${encodeURIComponent('Resposta inválida do Facebook.')}`);

    let payload: { workspaceId: string; brandId: string; userId: string; purpose: string };
    try {
      payload = fastify.jwt.verify(state) as any;
      if (payload.purpose !== 'instagram-oauth') throw new Error('state inválido');
    } catch {
      return back(`instagram=erro&msg=${encodeURIComponent('Link de autorização expirado, tente conectar de novo.')}`);
    }

    try {
      // 1) code -> token de usuário de curta duração
      const shortRes = await fetch(
        `${GRAPH}/oauth/access_token?${new URLSearchParams({
          client_id: env.FACEBOOK_APP_ID!,
          client_secret: env.FACEBOOK_APP_SECRET!,
          redirect_uri: REDIRECT_URI(),
          code,
        })}`,
      );
      const shortData: any = await shortRes.json();
      if (!shortRes.ok || !shortData.access_token) throw new Error(shortData.error?.message || 'Falha ao trocar o code por token.');

      // 2) troca pra token de longa duração (~60 dias)
      const longRes = await fetch(
        `${GRAPH}/oauth/access_token?${new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: env.FACEBOOK_APP_ID!,
          client_secret: env.FACEBOOK_APP_SECRET!,
          fb_exchange_token: shortData.access_token,
        })}`,
      );
      const longData: any = await longRes.json();
      if (!longRes.ok || !longData.access_token) throw new Error(longData.error?.message || 'Falha ao gerar token de longa duração.');
      const userToken = longData.access_token as string;
      const expiresInSec = longData.expires_in as number | undefined;

      // 3) páginas do Facebook que esse usuário administra, com a conta IG Business vinculada
      const pagesRes = await fetch(
        `${GRAPH}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: userToken })}`,
      );
      const pagesData: any = await pagesRes.json();
      if (!pagesRes.ok) throw new Error(pagesData.error?.message || 'Falha ao listar páginas do Facebook.');

      const candidates = (pagesData.data || []).filter((p: any) => p.instagram_business_account);
      if (candidates.length === 0) {
        throw new Error(
          'Nenhuma conta do Instagram Business/Creator foi encontrada vinculada às suas páginas do Facebook. Converta a conta para Business/Creator no app do Instagram e vincule-a a uma Página do Facebook antes de conectar.',
        );
      }
      if (candidates.length > 1) {
        throw new Error(
          `Encontramos ${candidates.length} páginas com Instagram vinculado (${candidates.map((c: any) => c.name).join(', ')}). Hoje só conectamos automaticamente quando há uma única opção — desvincule as páginas extras no Facebook Business Manager ou peça suporte para escolher manualmente.`,
        );
      }

      const page = candidates[0];
      await prisma.instagramConnection.upsert({
        where: { brandId: payload.brandId },
        create: {
          brandId: payload.brandId,
          pageId: page.id,
          pageName: page.name,
          igBusinessId: page.instagram_business_account.id,
          igUsername: page.instagram_business_account.username,
          accessToken: `enc:${encryptJson({ token: page.access_token || userToken })}`,
          tokenExpiresAt: expiresInSec ? new Date(Date.now() + expiresInSec * 1000) : null,
          status: 'connected',
        },
        update: {
          pageId: page.id,
          pageName: page.name,
          igBusinessId: page.instagram_business_account.id,
          igUsername: page.instagram_business_account.username,
          accessToken: `enc:${encryptJson({ token: page.access_token || userToken })}`,
          tokenExpiresAt: expiresInSec ? new Date(Date.now() + expiresInSec * 1000) : null,
          status: 'connected',
          lastError: null,
        },
      });

      await audit(payload.workspaceId, payload.userId, 'integration.instagram.connect', 'instagram_connection', payload.brandId, {
        igUsername: page.instagram_business_account.username,
      });

      return back('instagram=conectado');
    } catch (err: any) {
      return back(`instagram=erro&msg=${encodeURIComponent(err.message || 'Falha ao conectar o Instagram.')}`);
    }
  });

  fastify.delete('/disconnect', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { brandId } = z.object({ brandId: z.string() }).parse(request.query);
    const brand = await findOwnedBrand(workspaceId, brandId);
    if (!brand) return reply.status(404).send({ message: 'Marca não encontrada' });

    const conn = await prisma.instagramConnection.findUnique({ where: { brandId } });
    if (!conn) return reply.status(404).send({ message: 'Nenhuma conexão para remover.' });

    await prisma.instagramConnection.delete({ where: { brandId } });
    await audit(workspaceId, userId, 'integration.instagram.disconnect', 'instagram_connection', brandId, {});
    return reply.status(204).send();
  });
}

/**
 * Publica uma imagem já hospedada (URL pública) na conta do Instagram vinculada à marca.
 * Fluxo de 2 passos da Graph API: cria o container de mídia, depois publica o container.
 * Pronto para o agendador usar como novo canal — ainda não há nenhuma chamada real a isso.
 */
export async function postImageToInstagram(brandId: string, imageUrl: string, caption: string) {
  const conn = await prisma.instagramConnection.findUnique({ where: { brandId } });
  if (!conn) throw new Error('Marca sem Instagram conectado.');
  if (!appConfigured()) throw new Error(NOT_CONFIGURED_MESSAGE);

  const accessToken = decryptJson<{ token: string }>(conn.accessToken.slice(4)).token;

  const createRes = await fetch(`${GRAPH}/${conn.igBusinessId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
  });
  const createData: any = await createRes.json();
  if (!createRes.ok || !createData.id) throw new Error(createData.error?.message || 'Falha ao criar o container de mídia.');

  const publishRes = await fetch(`${GRAPH}/${conn.igBusinessId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: createData.id, access_token: accessToken }),
  });
  const publishData: any = await publishRes.json();
  if (!publishRes.ok || !publishData.id) throw new Error(publishData.error?.message || 'Falha ao publicar no Instagram.');

  return { mediaId: publishData.id as string };
}
