import type { MetadataRoute } from "next";

import { SITE_URL } from "./site";

/** Written once at build time: the site is static files. */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: "*",
			allow: "/",
			// The game's own data: nothing for a search result to show.
			disallow: ["/models/", "/textures/", "/environments/"],
		},
		sitemap: `${SITE_URL}/sitemap.xml`,
		host: SITE_URL,
	};
}
