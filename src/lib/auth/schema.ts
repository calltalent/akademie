import { z } from "zod";

export const magicLinkSchema = z.object({
  email: z.string().email("Ungültige E-Mail-Adresse."),
});

export const passwordSignInSchema = z.object({
  email: z.string().email("Ungültige E-Mail-Adresse."),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen haben."),
});

export const passwordSignUpSchema = passwordSignInSchema.extend({
  fullName: z.string().min(1, "Name erforderlich.").max(200),
});

/** NEU (Phase 5, Block 8, 12.07.2026) — Passwort-vergessen/-setzen-Flow, siehe auth/actions.ts. */
export const passwordResetRequestSchema = z.object({
  email: z.string().email("Ungültige E-Mail-Adresse."),
});

export const newPasswordSchema = z.object({
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen haben."),
});

export type MagicLinkInput = z.infer<typeof magicLinkSchema>;
export type PasswordSignInInput = z.infer<typeof passwordSignInSchema>;
export type PasswordSignUpInput = z.infer<typeof passwordSignUpSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;
