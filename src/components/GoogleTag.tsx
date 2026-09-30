import Script from "next/script";

/** The account's Google tag (GA4). */
const GOOGLE_TAG_ID = "G-FYD6RET54K";

/**
 * Google's tag (gtag.js), once for the whole app from the root layout.
 *
 * This is a single-page app: the tag loads once and stays loaded while the game runs. Page views
 * after the first (client-side route changes) are recorded by GA4's enhanced measurement, which
 * watches browser history changes — on by default for the web data stream ("Page changes based on
 * browser history events"), so no manual page_view calls are needed.
 *
 * `afterInteractive` is Next's way of placing a tag that Google says belongs in <head>: it loads
 * as soon as the page is interactive, without holding up the game's first paint.
 */
export function GoogleTag() {
	return (
		<>
			<Script src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}`} strategy="afterInteractive" />
			<Script id="google-tag" strategy="afterInteractive">
				{`
					window.dataLayer = window.dataLayer || [];
					function gtag(){dataLayer.push(arguments);}
					gtag('js', new Date());
					gtag('config', '${GOOGLE_TAG_ID}');
				`}
			</Script>
		</>
	);
}
