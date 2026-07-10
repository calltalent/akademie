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

export type MagicLinkInput = z.infer<typeof magicLinkSchema>;
export type PasswordSignInInput = z.infer<typeof passwordSignInSchema>;
export type PasswordSignUpInput = z.infer<typeof passwordSignUpSchema>;
