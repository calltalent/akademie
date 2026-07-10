import { z } from "zod";

/**
 * Zentrale, zod-validierte Umgebungsvariablen.
 * Trennung: `publicEnv` darf im Client-Bundle landen, `serverEnv` NIEMALS.
 * Sicherheitsregel CLAUDE.md §2.2: Secrets nur serverseitig.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverOnlySchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  BUNNY_STREAM_LIBRARY_ID: z.string().min(1).optional(),
  BUNNY_STREAM_API_KEY: z.string().min(1).optional(),
  BUNNY_STREAM_CDN_HOSTNAME: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
});

function parsePublicEnv() {
  const result = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!result.success) {
    throw new Error(
      `Ungültige öffentliche Umgebungsvariablen: ${result.error.message}`,
    );
  }
  return result.data;
}

/** Nur serverseitig aufrufen (Server Components, Route Handlers, Server Actions). */
function parseServerEnv() {
  const result = serverOnlySchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    BUNNY_STREAM_LIBRARY_ID: process.env.BUNNY_STREAM_LIBRARY_ID,
    BUNNY_STREAM_API_KEY: process.env.BUNNY_STREAM_API_KEY,
    BUNNY_STREAM_CDN_HOSTNAME: process.env.BUNNY_STREAM_CDN_HOSTNAME,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  });
  if (!result.success) {
    throw new Error(
      `Ungültige Server-Umgebungsvariablen: ${result.error.message}`,
    );
  }
  return result.data;
}

export const publicEnv = parsePublicEnv();

/** Lazy: erst bei Zugriff validieren, damit Client-Bundles nicht scheitern. */
export function getServerEnv() {
  return parseServerEnv();
}
