import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { modulesOf } from '../../shared/modules/catalog.js';

export async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/register
  fastify.post('/register', async (request, reply) => {
    const registerSchema = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6),
    });

    const { name, email, password } = registerSchema.parse(request.body);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return reply.status(400).send({ message: 'E-mail já cadastrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
    });

    // Cria workspace padrão do usuário
    const workspace = await prisma.workspace.create({
      data: {
        name: `Workspace de ${name}`,
        slug: `ws-${Date.now()}`,
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
    });

    const token = fastify.jwt.sign({ id: user.id, email: user.email });

    return reply.status(201).send({
      user: { id: user.id, name: user.name, email: user.email },
      workspace: { id: workspace.id, name: workspace.name },
      token,
    });
  });

  // POST /api/auth/login
  fastify.post('/login', async (request, reply) => {
    const loginSchema = z.object({
      email: z.string().email(),
      password: z.string(),
    });

    const { email, password } = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { workspace: true } } },
    });

    if (!user) {
      return reply.status(401).send({ message: 'Credenciais inválidas.' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ message: 'Credenciais inválidas.' });
    }
    if (!user.active) {
      return reply.status(403).send({ message: 'Acesso desativado. Procure o administrador da plataforma.' });
    }

    const token = fastify.jwt.sign({ id: user.id, email: user.email });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const workspace = user.memberships[0]?.workspace;

    return reply.send({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      workspaces: user.memberships.map((m: any) => m.workspace),
      workspace: workspace
        ? { id: workspace.id, name: workspace.name, status: workspace.status, suspendedReason: workspace.suspendedReason, modules: modulesOf(workspace) }
        : null,
      token,
    });
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as any).id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, active: true, avatarUrl: true, jobTitle: true,
        memberships: { take: 1, orderBy: { createdAt: 'asc' }, include: { workspace: true } } },
    });
    if (!user) return reply.status(404).send({ message: 'Usuário não encontrado' });
    const workspace = user.memberships[0]?.workspace;
    const { memberships, ...rest } = user;
    return reply.send({
      ...rest,
      workspace: workspace
        ? { id: workspace.id, name: workspace.name, status: workspace.status, suspendedReason: workspace.suspendedReason, modules: modulesOf(workspace) }
        : null,
    });
  });

  // PATCH /api/auth/me
  fastify.patch('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as any).id;
    const bodySchema = z.object({
      name: z.string().min(2).optional(),
      jobTitle: z.string().optional(),
    });
    const data = bodySchema.parse(request.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, jobTitle: true },
    });
    return reply.send(user);
  });
}
