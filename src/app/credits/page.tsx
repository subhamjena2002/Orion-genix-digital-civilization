import Link from "next/link";
import type { Metadata } from "next";

import { PlayLink } from "@/components/landing/PlayLink";
import "../landing.css";

export const metadata: Metadata = {
	title: "Credits",
	description: "The artists whose 3D models, textures and skies help build OrionGenix, and the licences they're shared under.",
	alternates: { canonical: "/credits" },
};

/**
 * The visible credit the CC-BY licences ask for (see CREDITS.md), and thanks to the CC0 sources.
 * Keep in step with CREDITS.md when art is added or replaced.
 */
const ATTRIBUTED = [
	{ work: "Casual male character (rigged)", author: "ijiklvn", url: "https://sketchfab.com/3d-models/casual-male-char-rigged-9034a1acc95e494592441a057d319953" },
	{ work: "Modular military base, low poly", author: "Salah3D", url: "https://sketchfab.com/3d-models/modular-militry-base-low-poly-game-ready-cc96aa9f48b547df8844074bf14e63fe" },
	{ work: "Combat helicopter (the OG-1 Gunship)", author: "Muhamad Mirza Arrafi", url: "https://sketchfab.com/3d-models/boeing-ah-64d-apache-combat-helicopter-c3b58008c46b45048fdd7dd283a3c8c8" },
	{ work: "Fictional fighter/bomber aircraft (the OG-7 Striker)", author: "yoshikawa_Kosuke", url: "https://sketchfab.com/3d-models/fictional-fighterbomber-aircraft-f0b9f656b6964cbf83445484be54a237" },
] as const;

const THANKS = [
	{ work: "City and suburban props", author: "Kenney", licence: "CC0" },
	{ work: "Textures and the sky (Kloofendal 48d Partly Cloudy)", author: "Poly Haven", licence: "CC0" },
	{ work: "Engines, weapons, crashes, sirens and city sounds (GameAudioGDC bundles)", author: "Sonniss and its contributing studios", licence: "Royalty-free" },
] as const;

export default function Credits() {
	return (
		<div className="lp">
			<main className="lp-section">
				<p className="lp-kicker">Credits</p>
				<h1 className="lp-h2">Built with help from <span className="lp-gradient-text">great artists</span></h1>
				<p className="lp-lead">
					OrionGenix uses 3D models shared by these creators under the Creative Commons Attribution 4.0 licence (CC BY 4.0). Some were adapted
					for the game — rescaled, split into parts or repainted — and appear under made-up in-game names.
				</p>
				<ul className="lp-faq-list">
					{ATTRIBUTED.map((item) => (
						<li key={item.url} className="lp-cast-card">
							<div>
								<p className="lp-cast-name">{item.work}</p>
								<p className="lp-cast-role">by {item.author} · CC BY 4.0</p>
								<p className="lp-cast-line">
									<a href={item.url} rel="noopener noreferrer" target="_blank">Source on Sketchfab</a>
									{" · "}
									<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener noreferrer license" target="_blank">Licence</a>
								</p>
							</div>
						</li>
					))}
				</ul>
				<h2 className="lp-h3">Also thanks to</h2>
				<ul className="lp-faq-list">
					{THANKS.map((item) => (
						<li key={item.author} className="lp-cast-card">
							<div>
								<p className="lp-cast-name">{item.work}</p>
								<p className="lp-cast-role">by {item.author} · {item.licence}</p>
							</div>
						</li>
					))}
				</ul>
				<div className="lp-hero-actions">
					<PlayLink from="credits" className="lp-button lp-button-primary">Play OrionGenix</PlayLink>
					<Link href="/" className="lp-button lp-button-ghost">Back to home</Link>
				</div>
			</main>
		</div>
	);
}
