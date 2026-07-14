import type { MetadataRoute } from "next";

/**
 * PWA manifest. start_url is /play so an installed icon opens straight into the
 * app (not the marketing landing). Stadium Night colours for the splash/toolbar.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Touchline: World Cup prediction game",
    short_name: "Touchline",
    description:
      "Make your calls on live World Cup odds, hear a live AI pundit narrate every pick, and beat the bookies to earn on-chain trophies. Free to play on Solana.",
    id: "/",
    start_url: "/play",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0A0E15",
    theme_color: "#0A0E15",
    categories: ["sports", "games", "entertainment"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
