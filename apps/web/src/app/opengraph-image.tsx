import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Touchline: call it, hear it land, own the trophy.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Stadium Night brand tokens (apps/web/src/app/globals.css) — kept in sync by hand,
// this file has no build-time access to CSS custom properties.
const CANVAS = "#0A0E15";
const SOLID = "#131B27";
const INK = "#EAF1F7";
const INK_SOFT = "#8B98A8";
const EMERALD = "#00E08A";
const CYAN = "#2BE5FF";
const GOLD = "#F2B33C";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: CANVAS,
          backgroundImage: `radial-gradient(circle at 18% -10%, rgba(0,224,138,0.16), transparent 55%), radial-gradient(circle at 100% 120%, rgba(43,229,255,0.10), transparent 50%)`,
          padding: "76px 88px",
          fontFamily: "sans-serif",
        }}
      >
        {/* on-chain gradient rule */}
        <div
          style={{
            display: "flex",
            width: 96,
            height: 8,
            borderRadius: 999,
            backgroundImage: `linear-gradient(108deg, ${EMERALD}, ${CYAN})`,
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: EMERALD,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 6,
              textTransform: "uppercase",
            }}
          >
            TOUCHLINE
          </div>

          <div
            style={{
              display: "flex",
              color: INK,
              fontSize: 80,
              fontWeight: 700,
              lineHeight: 1.06,
              letterSpacing: -1.5,
              maxWidth: 980,
            }}
          >
            Call it. Hear it land. Own the trophy.
          </div>

          <div
            style={{
              display: "flex",
              color: INK_SOFT,
              fontSize: 32,
              fontWeight: 500,
              maxWidth: 860,
            }}
          >
            A free-to-play World Cup companion on Solana. Live odds, a live AI
            pundit, an earned on-chain trophy.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              backgroundColor: SOLID,
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 999,
              padding: "12px 22px",
              color: GOLD,
              fontSize: 24,
              fontWeight: 600,
            }}
          >
            Beat the bookies
          </div>
          <div
            style={{
              display: "flex",
              color: INK_SOFT,
              fontSize: 24,
              fontWeight: 500,
            }}
          >
            Free to play · Not betting · Solana
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
