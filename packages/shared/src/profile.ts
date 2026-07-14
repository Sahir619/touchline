// @touchline/shared — user profile primitives: pundit personas + nations.
// Used by onboarding (web), the profile, and the pundit engine (worker).

import { z } from 'zod';

/** Pundit personas — drive the AI narration tone. */
export const PERSONAS = [
  {
    id: 'hype',
    name: 'Hype-man',
    blurb: 'Loud, ALL-IN energy. Lives and dies with every pick.',
    sample: "OH THIS IS IT — your long shot is COOKING and the whole board can feel it!",
  },
  {
    id: 'rival',
    name: 'Sarcastic rival',
    blurb: 'Dry, needling. Will remind you when you fade the obvious.',
    sample: "Bold of you to back the underdog. The market disagrees. Loudly.",
  },
  {
    id: 'nerd',
    name: 'Stats nerd',
    blurb: 'Calm, numbers-first. Talks probabilities, not feelings.',
    sample: "Your pick was a 19% implied shot. The model likes where this is heading.",
  },
  {
    id: 'homer',
    name: 'Homer',
    blurb: 'Hopelessly biased for your nation. Objectivity not included.',
    sample: "Forget the odds — WE were always winning this one. Always.",
  },
] as const;

export type PersonaId = (typeof PERSONAS)[number]['id'];
export const PERSONA_IDS = PERSONAS.map((p) => p.id) as [PersonaId, ...PersonaId[]];
export const DEFAULT_PERSONA: PersonaId = 'hype';

/** Nations a user can back (allegiance). Codes are ISO-ish; flag is an emoji. */
export const NATIONS = [
  { code: 'ARG', name: 'Argentina', flag: '🇦🇷' },
  { code: 'AUT', name: 'Austria', flag: '🇦🇹' },
  { code: 'BEL', name: 'Belgium', flag: '🇧🇪' },
  { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
  { code: 'CPV', name: 'Cape Verde', flag: '🇨🇻' },
  { code: 'COL', name: 'Colombia', flag: '🇨🇴' },
  { code: 'COD', name: 'Congo DR', flag: '🇨🇩' },
  { code: 'CRO', name: 'Croatia', flag: '🇭🇷' },
  { code: 'EGY', name: 'Egypt', flag: '🇪🇬' },
  { code: 'ENG', name: 'England', flag: '🏴' },
  { code: 'FRA', name: 'France', flag: '🇫🇷' },
  { code: 'GER', name: 'Germany', flag: '🇩🇪' },
  { code: 'GHA', name: 'Ghana', flag: '🇬🇭' },
  { code: 'IRN', name: 'Iran', flag: '🇮🇷' },
  { code: 'ITA', name: 'Italy', flag: '🇮🇹' },
  { code: 'JPN', name: 'Japan', flag: '🇯🇵' },
  { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'MAR', name: 'Morocco', flag: '🇲🇦' },
  { code: 'NED', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'NZL', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'PAN', name: 'Panama', flag: '🇵🇦' },
  { code: 'POR', name: 'Portugal', flag: '🇵🇹' },
  { code: 'KSA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'SRB', name: 'Serbia', flag: '🇷🇸' },
  { code: 'KOR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'ESP', name: 'Spain', flag: '🇪🇸' },
  { code: 'USA', name: 'United States', flag: '🇺🇸' },
  { code: 'URU', name: 'Uruguay', flag: '🇺🇾' },
  { code: 'UZB', name: 'Uzbekistan', flag: '🇺🇿' },
] as const;

export type NationCode = (typeof NATIONS)[number]['code'];
export const NATION_CODES = NATIONS.map((n) => n.code) as [NationCode, ...NationCode[]];

export function nationByCode(code: string | null | undefined) {
  return NATIONS.find((n) => n.code === code) ?? null;
}
export function personaById(id: string | null | undefined) {
  return PERSONAS.find((p) => p.id === id) ?? null;
}

/** A user profile (keyed by Solana wallet address). */
export const ProfileSchema = z.object({
  wallet: z.string(),
  displayName: z.string().nullable(),
  nation: z.string().nullable(),
  persona: z.string(),
  xp: z.number().int(),
  level: z.number().int(),
  // Beat the Line: cumulative sharpness (sum of max(0, clv)) and count of picks that
  // beat the closing line. Default 0 so older payloads still parse.
  sharpScore: z.number().default(0),
  linesBeaten: z.number().int().default(0),
  createdAt: z.number().int(),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** XP → level curve (100 XP per level, simple + legible). */
export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(xp / 100) + 1);
}
