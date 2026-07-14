// Share-out plumbing for the ShareCard "moment". Three surfaces:
//   1. navigator.share() — the OS share sheet (mobile-first), with the PNG
//      attached when the platform can share files.
//   2. copy-as-text — the universal fallback (desktop, unsupported browsers).
//   3. PNG export — a self-contained canvas render of the moment card, so the
//      image works everywhere with zero runtime dependencies.
//
// Copy carries NO bet / wager / stake / gamble / monetary-outcome wording —
// Touchline is proof-of-skill, not a book. See WIN LIST §7.

import type { Trophy } from "@/lib/game";
import type { SponsorTemplate } from "@/lib/sponsor";
import { nationByCode } from "@touchline/shared";

/** Public site origin — env first, then the live origin, then localhost. */
function siteOrigin(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

/** The link to share — a referral `/r/<code>` when we have one, else the site. */
export function shareUrl(referralCode?: string | null): string {
  const origin = siteOrigin();
  return referralCode ? `${origin}/r/${referralCode}` : origin;
}

/** Human share copy. Skill-framed, upbeat, no monetary-outcome wording. */
export function buildShareText(
  trophy: Trophy,
  nation?: string | null,
  referralCode?: string | null,
): string {
  const odds = trophy.oddsBeaten != null ? `${trophy.oddsBeaten.toFixed(2)}×` : null;
  const nat = nationByCode(nation);
  const lines: string[] = [];

  if (odds) {
    lines.push(`I called a ${odds} long shot on Touchline and beat the bookies. 🏆`);
  } else {
    lines.push(`I called it on Touchline and beat the bookies. 🏆`);
  }
  lines.push(`${trophy.name} · ${trophy.tier.toUpperCase()}${nat ? ` · Backing ${nat.name} ${nat.flag}` : ""}`);
  lines.push(`Think you can read the game? ${shareUrl(referralCode)}`);

  return lines.join("\n");
}

const TIER_METAL: Record<Trophy["tier"], string> = {
  bronze: "#D08A4E",
  silver: "#AEBDC6",
  gold: "#F2B33C",
};

/** Round-rect path helper (canvas has no primitive until recent, keep it safe). */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// IconTrophy path (viewBox 0 0 24 24), stroked — drawn scaled into the coin.
const TROPHY_PATHS = [
  "M7 4.5h10v4a5 5 0 0 1-10 0v-4Z",
  "M7 6H4.5v1.5A3 3 0 0 0 7 10.4M17 6h2.5v1.5A3 3 0 0 1 17 10.4M9.5 14.4 9 18h6l-.5-3.6M7.5 21h9",
];

/**
 * Render the moment card to a PNG Blob via a self-contained canvas draw. Mirrors
 * the ShareCard design language (on-chain gradient hero, tier coin, odds beaten)
 * so the exported image is on-brand without capturing live DOM.
 */
export async function renderMomentPng(
  trophy: Trophy,
  nation?: string | null,
  sponsor?: SponsorTemplate | null,
): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const scale = 2; // retina
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.scale(scale, scale);

  // Best-effort: wait for the web fonts so text is on-brand, not fallback.
  try {
    if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;
  } catch {
    /* fonts optional */
  }

  const display = `"Saira Condensed", "Saira", system-ui, sans-serif`;
  const body = `"Saira", system-ui, sans-serif`;
  const isGold = trophy.tier === "gold";
  const metal = TIER_METAL[trophy.tier];
  const nat = nationByCode(nation);
  const odds = trophy.oddsBeaten != null ? trophy.oddsBeaten.toFixed(2) : null;

  // ---- canvas ground ----
  ctx.fillStyle = "#0A0E15";
  ctx.fillRect(0, 0, W, H);

  // ---- on-chain gradient hero ----
  const heroH = 760;
  const grad = ctx.createLinearGradient(0, 0, W, heroH);
  grad.addColorStop(0, "#00E08A");
  grad.addColorStop(1, "#2BE5FF");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, heroH);

  ctx.textAlign = "center";

  // eyebrow
  ctx.fillStyle = "rgba(3,36,27,0.82)";
  ctx.font = `600 30px ${display}`;
  ctx.fillText("B E A T   T H E   B O O K I E S", W / 2, 120);

  // ---- coin ----
  const cx = W / 2;
  const cy = 300;
  const rOuter = 120;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
  if (isGold) {
    const cg = ctx.createLinearGradient(cx - rOuter, cy - rOuter, cx + rOuter, cy + rOuter);
    cg.addColorStop(0, "#00E08A");
    cg.addColorStop(1, "#2BE5FF");
    ctx.fillStyle = cg;
  } else {
    ctx.fillStyle = metal;
  }
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  ctx.fill();
  ctx.restore();

  // white coin face
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter - 14, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.fill();

  // trophy glyph (24x24 viewBox → scale to ~120px, centred)
  ctx.save();
  const glyph = 120;
  ctx.translate(cx - glyph / 2, cy - glyph / 2);
  ctx.scale(glyph / 24, glyph / 24);
  ctx.strokeStyle = metal;
  ctx.lineWidth = 1.7;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const d of TROPHY_PATHS) ctx.stroke(new Path2D(d));
  ctx.restore();

  // ---- odds beaten ----
  if (odds) {
    ctx.fillStyle = "rgba(3,36,27,0.82)";
    ctx.font = `600 30px ${display}`;
    ctx.fillText("O D D S   B E A T E N", W / 2, 500);

    ctx.fillStyle = "#03241B";
    ctx.font = `700 168px ${display}`;
    const oddsText = odds;
    ctx.fillText(oddsText, W / 2 - 26, 660);
    // the × sign, smaller, trailing
    const w = ctx.measureText(oddsText).width;
    ctx.font = `700 96px ${display}`;
    ctx.textAlign = "left";
    ctx.fillText("×", W / 2 - 26 + w / 2 + 12, 660);
    ctx.textAlign = "center";
  }

  // ---- footer (dark solid surface) ----
  ctx.fillStyle = "#131B27";
  ctx.fillRect(0, heroH, W, H - heroH);

  // trophy name
  ctx.fillStyle = "#EAF1F7";
  ctx.font = `700 66px ${display}`;
  ctx.fillText(trophy.name, W / 2, heroH + 130);

  // tier pill
  const tierLabel = trophy.tier.toUpperCase();
  ctx.font = `600 30px ${display}`;
  const pillW = ctx.measureText(tierLabel).width + 56;
  const pillH = 56;
  const pillX = (W - pillW) / 2;
  const pillY = heroH + 165;
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.fillStyle = isGold ? "#7a5a12" : "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(tierLabel, W / 2, pillY + pillH / 2 + 2);
  ctx.textBaseline = "alphabetic";

  // nation
  let cursorY = heroH + 300;
  if (nat) {
    ctx.fillStyle = "#8B98A8";
    ctx.font = `500 38px ${body}`;
    ctx.fillText(`${nat.flag}  Backing ${nat.name}`, W / 2, cursorY);
    cursorY += 60;
  }

  // caption
  ctx.fillStyle = "#8B98A8";
  ctx.font = `500 38px ${body}`;
  ctx.fillText("Beat the bookies on Touchline.", W / 2, cursorY);

  // ---- sponsor-branded strip (W10 monetization surface) ----
  if (sponsor) {
    const stripY = H - 190;
    ctx.textAlign = "center";
    ctx.fillStyle = "#6B7787";
    ctx.font = `600 24px ${display}`;
    ctx.fillText("P R E S E N T E D   B Y", W / 2, stripY);

    // monogram chip + brand name, centred as one lockup
    ctx.font = `700 40px ${display}`;
    const nameW = ctx.measureText(sponsor.name).width;
    const chip = 52;
    const gap = 18;
    const lockW = chip + gap + nameW;
    const chipX = (W - lockW) / 2;
    const chipY = stripY + 24;
    roundRect(ctx, chipX, chipY, chip, chip, 14);
    ctx.fillStyle = sponsor.accent;
    ctx.fill();
    ctx.fillStyle = "#1a1205";
    ctx.font = `700 26px ${display}`;
    ctx.textBaseline = "middle";
    ctx.fillText(sponsor.monogram, chipX + chip / 2, chipY + chip / 2 + 2);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#EAF1F7";
    ctx.font = `700 40px ${display}`;
    ctx.textAlign = "left";
    ctx.fillText(sponsor.name, chipX + chip + gap, chipY + chip / 2 + 14);
    ctx.textAlign = "center";
  }

  // wordmark
  ctx.fillStyle = "#21D98E";
  ctx.font = `700 40px ${display}`;
  ctx.fillText("TOUCHLINE", W / 2, H - 70);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))),
      "image/png",
    );
  });
}

/** Trigger a browser download of the moment PNG. */
export async function downloadMomentPng(
  trophy: Trophy,
  nation?: string | null,
  sponsor?: SponsorTemplate | null,
): Promise<void> {
  const blob = await renderMomentPng(trophy, nation, sponsor);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `touchline-${trophy.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Copy the share text to the clipboard. Returns true on success. */
export async function copyShareText(
  trophy: Trophy,
  nation?: string | null,
  referralCode?: string | null,
): Promise<boolean> {
  const text = buildShareText(trophy, nation, referralCode);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  // Legacy fallback for non-secure contexts.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export type ShareOutcome = "shared" | "copied" | "failed";

/**
 * Generic text share — the same OS-sheet-then-copy plumbing as `shareMoment`,
 * for lightweight snippets (a pundit line, a called result) that have no PNG.
 * Never throws; returns an outcome the UI can surface. Copy carries no
 * monetary-outcome wording (caller supplies the text — keep it skill-framed).
 */
export async function shareSnippet(text: string, title = "Touchline", url: string = shareUrl()): Promise<ShareOutcome> {
  const body = text.includes(url) ? text : `${text}\n${url}`;

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text, url, title });
      return "shared";
    } catch (e) {
      // AbortError = user dismissed the sheet; treat as a no-op, not a failure.
      if (e instanceof DOMException && e.name === "AbortError") return "shared";
      // Any other failure → fall back to copy below.
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(body);
      return "copied";
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = body;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok ? "copied" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * The primary share action. Prefers the OS share sheet (with the PNG attached
 * when supported); otherwise copies the text. Never throws — returns an outcome
 * the UI can surface.
 */
export async function shareMoment(
  trophy: Trophy,
  nation?: string | null,
  referralCode?: string | null,
): Promise<ShareOutcome> {
  const text = buildShareText(trophy, nation, referralCode);
  const url = shareUrl(referralCode);
  const title = `${trophy.name} · Touchline`;

  // Try to attach the PNG to the share sheet where the platform allows it.
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      let file: File | null = null;
      try {
        const blob = await renderMomentPng(trophy, nation);
        file = new File([blob], "touchline-moment.png", { type: "image/png" });
      } catch {
        file = null;
      }

      const canShareFiles =
        file != null &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });

      if (canShareFiles && file) {
        await navigator.share({ files: [file], text, title });
      } else {
        await navigator.share({ text, url, title });
      }
      return "shared";
    } catch (e) {
      // AbortError = user dismissed the sheet; treat as a no-op, not a failure.
      if (e instanceof DOMException && e.name === "AbortError") return "shared";
      // Any other failure → fall back to copy below.
    }
  }

  const copied = await copyShareText(trophy, nation, referralCode);
  return copied ? "copied" : "failed";
}
