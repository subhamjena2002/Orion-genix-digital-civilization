import type { MetadataRoute } from "next";

import { SITE_URL } from "./site";

/** Written once at build time: the site is static files. */
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
	const now = new Date();
	return [
		{
			url: `${SITE_URL}/`,
			lastModified: now,
			changeFrequency: "weekly",
			priority: 1,
			images: [
				`${SITE_URL}/landing/hero-gunship.webp`,
				`${SITE_URL}/landing/jets.webp`,
				`${SITE_URL}/landing/jets-row.webp`,
				`${SITE_URL}/landing/police-hq.webp`,
				`${SITE_URL}/landing/downtown.webp`,
			],
		},
		{ url: `${SITE_URL}/credits`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
	];
}
