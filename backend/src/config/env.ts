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
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET precisa ter pelo menos 32 caracteres — gere um valor forte e único (ex: openssl rand -base64 48).')
    .default('super_secret_jwt_key_simplisoft_pabllo_vittar_2026'),
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
  // Origem que o navegador deve ver depois do OAuth do Google (SPA) — difere de PUBLIC_API_URL em
  // dev (frontend:8080 por trás do proxy do Vite vs. backend:3000 publicado direto).
  PUBLIC_WEB_URL: z.string().default('http://localhost:8080'),

  // ── Google Drive (OAuth por workspace) ──
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // ── Instagram / Facebook Login (Graph API, OAuth por marca) ──
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
});

export const env = envSchema.parse(process.env);
