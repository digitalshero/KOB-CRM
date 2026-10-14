import { z } from "zod";

export const LANGUAGES = [
  "TAMIL", "TELUGU", "MALAYALAM", "HINDI", "BENGALI",
  "ENGLISH", "KANNADA", "MARATHI", "GUJARATI", "OTHERS",
] as const;

export const CSV_COLUMNS = [
  "full_name", "phone", "language", "lead_source",
] as const;

export const importRowSchema = z.object({
  full_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  channel: z.string().optional(),
  lead_source: z.string().optional(),
  brand_code: z.string().optional(),
  state_name: z.string().optional(),
  city_name: z.string().optional(),
  language: z.string().optional(),
  investment_capacity: z.union([z.string(), z.number()]).optional(),
});

export const importInputSchema = z.object({ rows: z.array(importRowSchema).min(1).max(2000) });

export type ImportRow = z.infer<typeof importRowSchema>;

export type ImportRowResult = {
  row: number;
  name: string;
  phone: string;
  status: "IMPORTED" | "DUPLICATE" | "INVALID";
  reason?: string;
};

// Normalize an Indian phone number for dedupe comparison:
// strip non-digits, drop leading 91 country code, keep last 10 digits.
export function normalizePhone(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const trimmed = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
  return trimmed.length > 10 ? trimmed.slice(-10) : trimmed;
}
