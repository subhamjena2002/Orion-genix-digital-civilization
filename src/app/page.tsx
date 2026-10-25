import Link from "next/link";
import Image from "next/image";

import { AccountLink } from "@/components/account/AccountLink";
import { Constellation } from "@/components/landing/Constellation";
import { DeviceCheck } from "@/components/landing/DeviceCheck";
import { PlayLink } from "@/components/landing/PlayLink";
import { ShareButton } from "@/components/landing/ShareButton";
import { GAME_FACTS, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./site";
import "./landing.css";

/**
 * The front door: what OrionGenix is, how it looks, its story, and whether your machine will run
 * it — then into the game at /play. Plain server-rendered HTML (the game's code isn't loaded
 * here), so it's quick to arrive and everything on it can be read by search engines.
 */

const FEATURES = [
	{
		title: "Steal any ride",
		text: "Every car on the street can be yours. Smash the window, drag the driver out and floor it — taxis, vans, buses, even a police cruiser.",
		image: "/landing/downtown.webp",
		alt: "A yellow school bus and patrol cars on a palm-lined downtown street in OrionGenix",
	},
	{
		title: "Jets & an attack gunship",
		text: "Climb into the OG-7 Striker on the air base apron, or lift the OG-1 Gunship off its pad: cannon, rockets and guided missiles over the city.",
		image: "/landing/jets.webp",
		alt: "OG-7 Striker fighter jet with its canopy open on the air base apron",
	},
	{
		title: "5-star police chases",
		text: "Every crime turns up the heat. Patrol cars box you in, officers jump out, and at five stars they shoot to stop you. Lose them — or get busted.",
		image: "/landing/police-hq.webp",
		alt: "Police headquarters with patrol cars parked in the lot",
	},
	{
		title: "Real crash damage",
		text: "Panels crumple where you hit, glass shatters, engines smoke and catch fire. Push it too far and it goes up — with you inside.",
		image: "/landing/crash.webp",
		alt: "A wrecked taxi with a crumpled bonnet at a palm-lined junction",
	},
] as const;

const GRAPHICS = [
	{ title: "HDR + filmic tone mapping", text: "The scene renders in high dynamic range and is graded with ACES, like film: hot fire, deep shade, nothing clipped." },
	{ title: "Bloom", text: "Explosions, sun glare and fires glow the way a real lens sees them." },
	{ title: "Ambient occlusion", text: "Soft contact shadows under cars, in doorways and between buildings give every street weight." },
	{ title: "4K shadow maps", text: "Crisp palm-frond shadows across the pavement at noon." },
	{ title: "4× anti-aliasing", text: "Clean edges on rotor blades, cables and power lines." },
	{ title: `${GAME_FACTS.qualityLevels}-level adaptive quality`, text: "The game watches its own frame time and steps quality up or down live, so it stays smooth on a laptop and gorgeous on a gaming rig." },
] as const;

const CAST = [
	{ name: "Benny Kasper", initials: "BK", role: "The fixer", line: "“Not a scratch on it, or it comes out of your cut.”" },
	{ name: "Dez Moreno", initials: "DM", role: "The fence", line: "“There's a buyer for a patrol car, lights and all.”" },
	{ name: "Marisol Reyes", initials: "MR", role: "Sunset Park", line: "“Five on the street, three of them carrying. End it.”" },
	{ name: "Rosa “Redline” Vega", initials: "RV", role: "Queen of the street races", line: "“You start at the back — win it.”" },
	{ name: "Capt. Ilsa Brandt", initials: "IB", role: "Air base", line: "“You want to fly with us, you fly the course.”" },
	{ name: "Maj. Odile Vos", initials: "OV", role: "The convoy", line: "“None of them reaches the hills.”" },
] as const;

const REQUIREMENTS = [
	{ spec: "Browser", min: "Chrome, Edge, Firefox or Safari with WebGL 2", rec: "Latest Chrome or Edge", ultra: "Latest Chrome or Edge" },
	{ spec: "Memory (RAM)", min: "4 GB", rec: "8 GB", ultra: "16 GB" },
	{ spec: "Processor", min: "4 threads (Intel Core i3 / Ryzen 3)", rec: "8 threads (Core i5 / Ryzen 5)", ultra: "8+ threads (Core i7 / Ryzen 7, Apple M-series)" },
	{ spec: "Graphics", min: "Integrated: Intel UHD 620, AMD Vega 8, Apple M1", rec: "GTX 1050 Ti / RX 570, Iris Xe, Apple M1 Pro", ultra: "RTX 2060 / RX 6600 or better" },
	{ spec: "Display", min: "1280 × 720", rec: "1920 × 1080", ultra: "1440p and up" },
	{ spec: "Download", min: "Game data loads on first play, then cached", rec: "Broadband for the first load", ultra: "Plays offline once installed" },
	{ spec: "Controls", min: "Touch screen", rec: "Keyboard + mouse", ultra: "Keyboard + mouse" },
] as const;

const FAQ = [
	{
		q: "Is OrionGenix free to play?",
		a: "Yes — completely free. No sign-up, no account and no payment. Open the page, press Play and you're in the city.",
	},
	{
		q: "Do I need to download or install anything?",
		a: "No. OrionGenix runs in your web browser using WebGL 2. The first visit downloads the game's models, textures and sounds, which are then cached, so the next start is much faster. You can also install it as an app from your browser and play offline.",
	},
	{
		q: "Will it run on my laptop without a graphics card?",
		a: "Usually, yes. Laptops with integrated graphics (Intel UHD or Iris Xe, AMD Radeon Vega, Apple M1) can play it: the game adjusts its own quality to keep the frame rate smooth. Use the live system check on this page to see what your device will get.",
	},
	{
		q: "Can I play OrionGenix on my phone or tablet?",
		a: "Yes. It has touch controls and plays in landscape on modern Android phones, iPhones and iPads. For the best graphics and the steadiest frame rate, a laptop or desktop is recommended.",
	},
	{
		q: "What can you do in OrionGenix?",
		a: `Explore a ${GAME_FACTS.worldKm} km open world, steal and drive any car, fly fighter jets and an attack gunship, fight with ${GAME_FACTS.weapons} weapons, survive ${GAME_FACTS.wantedStars}-star police chases, play ${GAME_FACTS.missions} story missions and win ${GAME_FACTS.races} street races against AI rivals.`,
	},
	{
		q: "Is my progress saved?",
		a: "Yes. Your cash, passed missions, unlocked weapons and the cars in your garage are saved in your browser automatically, on this device.",
	},
	{
		q: "Who is OrionGenix for?",
		a: "Anyone who loves open-world action, driving, flying and racing games. It contains action violence (shooting, crashes and explosions), so it's recommended for players aged 16 and over.",
	},
] as const;

const SCREENSHOTS = ["hero-gunship", "jets", "jets-row", "gunship-sky", "police-hq", "downtown", "helipad", "villa", "crash"];

/**
 * Opened as the installed app, there's no landing page: straight into the game, before anything
 * here is drawn. New installs start at /play anyway (see manifest.ts); this catches apps installed
 * when the start page was still /. A page merely put full screen by the game (the Fullscreen API)
 * has a fullscreenElement, so coming back here from the game isn't mistaken for the app.
 */
const INSTALLED_APP_REDIRECT = `(function(){try{var m=function(q){return window.matchMedia(q).matches};if(m("(display-mode: standalone)")||m("(display-mode: minimal-ui)")||m("(display-mode: window-controls-overlay)")||navigator.standalone===true||(m("(display-mode: fullscreen)")&&!document.fullscreenElement)){location.replace("/play")}}catch(e){}})();`;

function JsonLd() {
	const absolute = (path: string) => `${SITE_URL}${path}`;
	const data = [
		{
			"@context": "https://schema.org",
			"@type": "WebSite",
			name: SITE_NAME,
			url: absolute("/"),
		},
		{
			"@context": "https://schema.org",
			"@type": "VideoGame",
			name: SITE_NAME,
			description: SITE_DESCRIPTION,
			url: absolute("/"),
			image: absolute("/landing/hero-gunship.webp"),
			screenshot: SCREENSHOTS.map((name) => absolute(`/landing/${name}.webp`)),
			genre: ["Action", "Open world", "Driving", "Racing", "Flight"],
			gamePlatform: ["Web browser", "PC", "Mac", "Chromebook", "Android", "iOS"],
			operatingSystem: "Windows, macOS, ChromeOS, Linux, Android, iOS, iPadOS",
			applicationCategory: "Game",
			playMode: "SinglePlayer",
			inLanguage: "en",
			isAccessibleForFree: true,
			offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock", url: absolute("/play") },
			memoryRequirements: "4 GB RAM minimum, 8 GB recommended",
			processorRequirements: "4 threads minimum, 8 recommended",
			contentRating: "16+ (action violence)",
		},
		{
			"@context": "https://schema.org",
			"@type": "FAQPage",
			mainEntity: FAQ.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
		},
	];
	return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

function Wordmark() {
	return (
		<span className="lp-wordmark">
			<svg viewBox="0 0 24 24" aria-hidden="true" className="lp-wordmark-star">
				<path d="M12 0l2.4 8.6L24 12l-9.6 3.4L12 24l-2.4-8.6L0 12l9.6-3.4z" />
			</svg>
			ORION<span>GENIX</span>
		</span>
	);
}

export default function Home() {
	return (
		<div className="lp">
			<script dangerouslySetInnerHTML={{ __html: INSTALLED_APP_REDIRECT }} />
			<JsonLd />

			<header className="lp-nav">
				<a href="#top" className="lp-nav-brand" aria-label="OrionGenix home"><Wordmark /></a>
				<nav aria-label="Sections" className="lp-nav-links">
					<a href="#game">Game</a>
					<a href="#graphics">Graphics</a>
					<a href="#story">Story</a>
					<a href="#specs">Specs</a>
					<a href="#faq">FAQ</a>
				</nav>
				<div className="lp-nav-actions">
					<AccountLink className="lp-nav-account" />
					<PlayLink from="nav" className="lp-button lp-button-primary lp-button-small">Play free</PlayLink>
				</div>
			</header>

			<main id="top">
				{/* ---- Hero ---- */}
				<section className="lp-hero" aria-labelledby="hero-title">
					<Constellation className="lp-hero-sky" />
					<div className="lp-hero-grid" aria-hidden="true" />
					<div className="lp-hero-inner">
						<div className="lp-hero-copy">
							<p className="lp-chip"><span className="lp-dot" aria-hidden="true" /> Early access · Season 01 · Free to play</p>
							<h1 id="hero-title" className="lp-hero-title">
								<span className="lp-hero-line">Own the city.</span>
								<span className="lp-hero-line lp-gradient-text">Rule the sky.</span>
								<span className="lp-hero-seo">OrionGenix — the free 3D open-world action game you play in your browser</span>
							</h1>
							<p className="lp-hero-lead">
								Steal any car. Fly fighter jets and an attack gunship. Outrun a 5-star police chase and beat street racers who never brake.
								<strong> No download. No sign-up. One click and you&apos;re in the driver&apos;s seat.</strong>
							</p>
							<div className="lp-hero-actions">
								<PlayLink from="hero" className="lp-button lp-button-primary lp-button-large">
									<span aria-hidden="true">▶</span> Play free now
								</PlayLink>
								<a href="#specs" className="lp-button lp-button-ghost lp-button-large">Can my PC run it?</a>
							</div>
							<ul className="lp-trust" aria-label="Why it's easy to start">
								<li>100% free</li>
								<li>No download</li>
								<li>No account</li>
								<li>Laptop · Desktop · Phone</li>
							</ul>
						</div>

						<div className="lp-hero-visual">
							<div className="lp-screen">
								<Image
									src="/landing/hero-gunship.webp"
									alt="The OG-1 attack gunship flying past glass towers over the city in OrionGenix"
									width={1920}
									height={1080}
									priority
									sizes="(max-width: 900px) 100vw, 58vw"
								/>
								<span className="lp-screen-scan" aria-hidden="true" />
							</div>
							<div className="lp-float lp-float-wanted" aria-hidden="true">
								<span className="lp-stars">★★★★★</span>
								<span>Wanted level</span>
							</div>
							<div className="lp-float lp-float-cash" aria-hidden="true">
								<span className="lp-float-big">+$5,000</span>
								<span>Mission passed</span>
							</div>
							<div className="lp-float lp-float-craft" aria-hidden="true">
								<span className="lp-float-dot" /> OG-1 Gunship · airborne
							</div>
						</div>
					</div>
					<a href="#game" className="lp-scroll" aria-label="Scroll to the game">
						<span />
					</a>
				</section>

				{/* ---- Ticker ---- */}
				<div className="lp-ticker" aria-hidden="true">
					<div className="lp-ticker-track">
						{[0, 1].map((copy) => (
							<span key={copy}>
								Fighter jets ✦ Attack gunship ✦ 5-star police chases ✦ Street races ✦ Car crashes ✦ Story missions ✦ Open world ✦ Free to play ✦ No download ✦{" "}
							</span>
						))}
					</div>
				</div>

				{/* ---- Numbers ---- */}
				<section className="lp-stats" aria-label="OrionGenix in numbers">
					{[
						[`${GAME_FACTS.worldKm} km`, "open world, end to end"],
						[String(GAME_FACTS.missions), "story missions"],
						[String(GAME_FACTS.races), "street races vs AI rivals"],
						[`${GAME_FACTS.wantedStars}★`, "wanted levels"],
						[String(GAME_FACTS.weapons), "weapons to unlock"],
						["0", "downloads needed"],
					].map(([value, label]) => (
						<div key={label} className="lp-stat">
							<span className="lp-stat-value">{value}</span>
							<span className="lp-stat-label">{label}</span>
						</div>
					))}
				</section>

				{/* ---- The game ---- */}
				<section id="game" className="lp-section" aria-labelledby="game-title">
					<p className="lp-kicker">What is OrionGenix?</p>
					<h2 id="game-title" className="lp-h2">A whole crime city <span className="lp-gradient-text">in one browser tab</span></h2>
					<p className="lp-lead">
						OrionGenix is a free open-world action game. Drop into Orion State — palm-lined boulevards, glass towers, a cable-stayed sea bridge,
						a mountain expressway and a military air base — and do whatever you dare. Every car is yours to take, every crime raises the heat, and
						every mission pays in cash, guns and wheels.
					</p>
					<div className="lp-features">
						{FEATURES.map((feature) => (
							<article key={feature.title} className="lp-feature">
								<div className="lp-feature-image">
									<Image src={feature.image} alt={feature.alt} width={1280} height={720} sizes="(max-width: 900px) 100vw, 50vw" />
								</div>
								<div className="lp-feature-body">
									<h3>{feature.title}</h3>
									<p>{feature.text}</p>
								</div>
							</article>
						))}
					</div>
					<div className="lp-mini-features">
						<div>
							<h3>Street races</h3>
							<p>Three rivals, three races — a downtown circuit, a flat-out Sea Link sprint and a hill climb through the Ghats tunnel. Win and the gold Vesper is yours.</p>
						</div>
						<div>
							<h3>Missions with bite</h3>
							<p>Steal cars with the alarm screaming, shake a 3-star chase, clear a gang, fly a ring course and hunt a convoy — against the clock.</p>
						</div>
						<div>
							<h3>Play anywhere</h3>
							<p>Laptop, desktop or phone with touch controls. Install it from your browser and it even plays offline.</p>
						</div>
					</div>
				</section>

				{/* ---- Graphics ---- */}
				<section id="graphics" className="lp-section" aria-labelledby="graphics-title">
					<p className="lp-kicker">Graphics</p>
					<h2 id="graphics-title" className="lp-h2">Console-grade graphics. <span className="lp-gradient-text">Zero install.</span></h2>
					<p className="lp-lead">Every image on this page was captured inside the game, running in a browser. No renders, no trailers — this is what you play.</p>
					<div className="lp-bento">
						<figure className="lp-bento-big">
							<Image src="/landing/jets-row.webp" alt="A row of OG-7 Striker jets on the air base apron" width={1280} height={720} sizes="(max-width: 900px) 100vw, 66vw" />
							<figcaption>Air base apron · OG-7 Strikers</figcaption>
						</figure>
						<figure>
							<Image src="/landing/gunship-sky.webp" alt="The OG-1 gunship banking under a blue sky" width={1280} height={720} sizes="(max-width: 900px) 100vw, 33vw" />
							<figcaption>OG-1 Gunship</figcaption>
						</figure>
						<figure>
							<Image src="/landing/villa.webp" alt="A coastal villa with a red tiled roof behind palm trees" width={1280} height={720} sizes="(max-width: 900px) 100vw, 33vw" />
							<figcaption>Coral Bay estate</figcaption>
						</figure>
						<figure>
							<Image src="/landing/helipad.webp" alt="The gunship parked on its helipad inside the army base" width={1280} height={720} sizes="(max-width: 900px) 100vw, 33vw" />
							<figcaption>Army base helipad</figcaption>
						</figure>
						<figure>
							<Image src="/landing/jets.webp" alt="Close-up of a fighter jet with its canopy raised" width={1280} height={720} sizes="(max-width: 900px) 100vw, 33vw" />
							<figcaption>Canopy up, ready to fly</figcaption>
						</figure>
						<figure>
							<Image src="/landing/downtown.webp" alt="A school bus and patrol cars on a palm-lined downtown street" width={1280} height={720} sizes="(max-width: 900px) 100vw, 33vw" />
							<figcaption>Downtown traffic</figcaption>
						</figure>
					</div>
					<ul className="lp-tech">
						{GRAPHICS.map((item) => (
							<li key={item.title}>
								<h3>{item.title}</h3>
								<p>{item.text}</p>
							</li>
						))}
					</ul>
				</section>

				{/* ---- Story ---- */}
				<section id="story" className="lp-section lp-story" aria-labelledby="story-title">
					<div className="lp-story-copy">
						<p className="lp-kicker">The story</p>
						<h2 id="story-title" className="lp-h2">Welcome to <span className="lp-gradient-text">Orion State</span></h2>
						<p>
							A sun-bleached island state wedged between the Ghat mountains and a warm sea. The city runs on a perfect grid of palm-lined
							boulevards. A cable-stayed Sea Link reaches for the eastern shore. Out on the southern peninsula, an army air base keeps its jets
							fuelled and its gunship on the pad.
						</p>
						<p>
							And under all of it, a city that runs on favours. You arrive with nothing but a pair of sneakers and a reputation you haven&apos;t
							earned yet. Benny Kasper needs a car moved. Dez Moreno wants a patrol car, lights and all. By the time the air base is asking for you
							by name, you&apos;ll own a garage full of cars and a five-star file at Police HQ.
						</p>
						<h3 className="lp-h3">Why “OrionGenix”?</h3>
						<p>
							<strong>Orion</strong> is the hunter — the brightest constellation in the winter sky, the one almost every culture on Earth gave a
							name. <strong>Genix</strong> is genesis: a beginning. OrionGenix is our first world, World&nbsp;001 — an open world built to run
							anywhere a browser does, with no store, no install and no gatekeeper between you and the game.
						</p>
					</div>
					<ul className="lp-cast" aria-label="Characters">
						{CAST.map((person) => (
							<li key={person.name} className="lp-cast-card">
								<span className="lp-cast-initials" aria-hidden="true">{person.initials}</span>
								<div>
									<p className="lp-cast-name">{person.name}</p>
									<p className="lp-cast-role">{person.role}</p>
									<p className="lp-cast-line">{person.line}</p>
								</div>
							</li>
						))}
					</ul>
				</section>

				{/* ---- Specs ---- */}
				<section id="specs" className="lp-section" aria-labelledby="specs-title">
					<p className="lp-kicker">System requirements</p>
					<h2 id="specs-title" className="lp-h2">Can your device <span className="lp-gradient-text">handle Orion State?</span></h2>
					<p className="lp-lead">
						OrionGenix runs on most laptops made in the last six years — no graphics card required. It reads your frame time while you play and
						tunes itself across {GAME_FACTS.qualityLevels} quality levels to stay smooth. Here&apos;s what each tier looks like.
					</p>
					<DeviceCheck />
					<div className="lp-table-wrap">
						<table className="lp-table">
							<caption className="lp-visually-hidden">OrionGenix system requirements</caption>
							<thead>
								<tr>
									<th scope="col">Spec</th>
									<th scope="col">Minimum <span>Playable, 30+ fps</span></th>
									<th scope="col" className="is-recommended">Recommended <span>High, 60 fps at 1080p</span></th>
									<th scope="col">Ultra <span>Every effect on</span></th>
								</tr>
							</thead>
							<tbody>
								{REQUIREMENTS.map((row) => (
									<tr key={row.spec}>
										<th scope="row">{row.spec}</th>
										<td>{row.min}</td>
										<td className="is-recommended">{row.rec}</td>
										<td>{row.ultra}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="lp-footnote">Estimated tiers. Your result depends on browser, drivers and what else is running — close heavy tabs for the best frame rate.</p>
				</section>

				{/* ---- FAQ ---- */}
				<section id="faq" className="lp-section lp-faq" aria-labelledby="faq-title">
					<p className="lp-kicker">FAQ</p>
					<h2 id="faq-title" className="lp-h2">Questions, answered</h2>
					<div className="lp-faq-list">
						{FAQ.map((item, index) => (
							<details key={item.q} open={index === 0}>
								<summary>{item.q}</summary>
								<p>{item.a}</p>
							</details>
						))}
					</div>
				</section>

				{/* ---- Final call ---- */}
				<section className="lp-final" aria-labelledby="final-title">
					<div className="lp-final-glow" aria-hidden="true" />
					<h2 id="final-title" className="lp-final-title">Orion State is waiting.</h2>
					<p className="lp-lead">The keys are in the ignition. The gunship is fuelled. The police haven&apos;t heard of you — yet.</p>
					<div className="lp-hero-actions lp-final-actions">
						<PlayLink from="final" className="lp-button lp-button-primary lp-button-large">
							<span aria-hidden="true">▶</span> Play free now
						</PlayLink>
						<ShareButton
							label="Challenge a friend"
							className="lp-button lp-button-ghost lp-button-large"
							text="I just stole a gunship in my browser. OrionGenix is a free open-world game — no download. Bet you can't beat the Sea Link race."
						/>
					</div>
				</section>
			</main>

			<footer className="lp-footer">
				<div className="lp-footer-top">
					<Wordmark />
					<nav aria-label="Footer">
						<PlayLink from="footer" className="">Play</PlayLink>
						<a href="#game">Game</a>
						<a href="#specs">System requirements</a>
						<a href="#faq">FAQ</a>
						<Link href="/credits">Credits</Link>
					</nav>
				</div>
				<p>© 2026 OrionGenix · World 001. Every screenshot captured in-game. Contains action violence — recommended for ages 16+.</p>
			</footer>
		</div>
	);
}
