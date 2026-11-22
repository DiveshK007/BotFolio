import type { MetadataRoute } from "next";

/** PWA manifest (SPEC §2.4: mobile-first PWA). Served at /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BotFolio",
    short_name: "BotFolio",
    description: "Raise an AI trader in one sentence. Play money. Not investment advice. No prizes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FAFAF7",
    theme_color: "#2B50FF",
    categories: ["entertainment", "education"],
    // UNVERIFIED: some Android launchers want PNG 192/512 icons for the install prompt; add them if the phone check shows a blank icon.
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
