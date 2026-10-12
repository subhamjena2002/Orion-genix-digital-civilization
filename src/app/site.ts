/**
 * What the site says about itself, in one place: its address, name and pitch, and the search
 * terms it's written for. The landing page, the metadata, the sitemap and the share card all
 * read from here.
 *
 * Set NEXT_PUBLIC_SITE_URL to the live address (e.g. https://oriongenix.com) when building for
 * release: canonical links, the sitemap and social share cards need the real domain.
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://oriongenix.com").replace(/\/+$/, "");

export const SITE_NAME = "OrionGenix";

/** Under 60 characters, so search results show it whole. */
export const SITE_TITLE = "OrionGenix — Free Open-World Game in Your Browser";

/** Under 160 characters: what you do, that it's free, that there's nothing to install. */
export const SITE_DESCRIPTION =
	"Steal cars, fly fighter jets and gunships, survive 5-star police chases and win street races. A free 3D open-world game — play instantly, no download.";

/** The searches the page answers, most valuable first. */
export const SITE_KEYWORDS = [
	"free open world game",
	"open world game online",
	"browser game no download",
	"free online games",
	"3D browser game",
	"play games online free",
	"car games online",
	"police chase game",
	"car stealing game",
	"helicopter game online",
	"fighter jet game online",
	"flight game browser",
	"street racing game online",
	"free racing games",
	"crime city game",
	"action game online free",
	"games for laptop without graphics card",
	"low end pc games",
	"WebGL game",
	"OrionGenix",
];

/** Facts the page quotes, kept true to the game as built. */
export const GAME_FACTS = {
	missions: 6,
	races: 3,
	wantedStars: 5,
	weapons: 6,
	/** End to end, the expressway's top to the far end of the sea link. */
	worldKm: 1.7,
	/** First load, then cached for offline play. */
	downloadMb: 260,
	qualityLevels: 6,
} as const;
