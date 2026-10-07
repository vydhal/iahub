import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// z.coerce.boolean() transforma a string "false" em true (Boolean("false") === true),
// o que tornava impossível desligar o AI_MOCK_MODE via variável de ambiente.
const envBool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? fallback : ['true', '1', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().default('super_secret_jwt_key_simplisoft_pabllo_vittar_2026'),
  DATABASE_URL: z.string(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  AI_MOCK_MODE: envBool(true),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  STORAGE_PROVIDER: z.string().default('local'),

  // ── Agent Operations ──
  // Chave de 32 bytes (hex ou base64) para criptografar credenciais. Em dev, derivada do JWT_SECRET.
  CREDENTIALS_KEY: z.string().optional(),
  // Liga o worker de execução de agentes e o scheduler dentro do processo da API.
  RUN_WORKERS: envBool(true),
  // Permite que ferramentas http/browser acessem redes privadas (localhost, 10.x, 192.168.x...).
  // Desligado por padrão para evitar que um agente alcance serviços internos (Postgres, Redis, API).
  ALLOW_PRIVATE_NETWORK: envBool(false),
  PUBLIC_API_URL: z.string().default('http://localhost:3000'),
});

export const env = envSchema.parse(process.env);
