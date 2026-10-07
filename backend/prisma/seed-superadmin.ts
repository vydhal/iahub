import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { MODULE_KEYS } from '../src/shared/modules/catalog.js';

const prisma = new PrismaClient();

/**
 * Cria/atualiza o superadmin da plataforma (Simplisoft) e garante que a conta demo
 * exista com todos os módulos ligados. Idempotente: pode rodar quantas vezes quiser.
 */
export async function seedSuperadmin(client: PrismaClient = prisma) {
  const email = process.env.SUPERADMIN_EMAIL || 'admin@simplisoft.com.br';
  const password = process.env.SUPERADMIN_PASSWORD || 'simplisoft123';

  const user = await client.user.upsert({
    where: { email },
    update: { role: 'SUPERADMIN', active: true },
    create: { name: 'Administração Simplisoft', email, passwordHash: await bcrypt.hash(password, 10), role: 'SUPERADMIN' },
  });

  // Conta demo com tudo ligado (é a vitrine interna, não um cliente)
  const demo = await client.workspace.findFirst({ where: { slug: 'simplisoft' } });
  if (demo) {
    await client.workspace.update({
      where: { id: demo.id },
      data: {
        modules: Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as any,
        maxBrands: 0,
        maxScheduledPosts: 1000,
        contactEmail: demo.contactEmail || 'vidal@simplisoft.com.br',
      },
    });
  }
  return { email, userId: user.id };
}

if (process.argv[1] && process.argv[1].includes('seed-superadmin')) {
  seedSuperadmin()
    .then((r) => console.log(`✅ Superadmin pronto: ${r.email}`))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
