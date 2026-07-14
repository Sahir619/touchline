// Monetization surface (W10 stub) — a sponsor-branded moment template.
//
// This is the *visible* form of the J4 commercial claim: earned moments carry a
// partner presentation as they spread through the share loop. One demo placement
// stands in for a partner ad-server / config in production — swapping
// `activeSponsor()` swaps the whole surface. No payments, no tracking: this is
// the surface, not the sale. See Touchline_WIN_LIST.md §W10.

export interface SponsorTemplate {
  id: string;
  /** Partner brand name shown in the "Presented by" lockup. */
  name: string;
  /** 2-letter monogram used as the logo mark on the moment card. */
  monogram: string;
  /** One-line partner line (skill-framed, never a monetary-outcome claim). */
  tagline: string;
  /** Brand accent (hex) for the monogram chip / PNG strip. */
  accent: string;
}

/**
 * The demo placement — a fictional boot brand, clearly a template stand-in so no
 * one mistakes it for a live paid deal. Real placements arrive via config.
 */
export const DEMO_SPONSOR: SponsorTemplate = {
  id: "avanti",
  name: "AVANTI Boots",
  monogram: "AV",
  tagline: "Built for the counter-attack.",
  accent: "#F2B33C",
};

/** The sponsor to present on moment cards, or `null` for an unbranded moment. */
export function activeSponsor(): SponsorTemplate | null {
  return DEMO_SPONSOR;
}
