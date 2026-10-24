"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { onProgressChange, progressVersion, readProgress } from "@/engine/orion/missions/Progress";
import type { Shop } from "@/engine/orion/shops/ShopCatalog";
import { buy, checkItem, closeShop, currentShop, itemDetail, itemName, onShopChange, priceOf, setShopSelection } from "@/engine/orion/shops/Shops";
import { formatCash } from "./MissionHud";

/** A purchase's line stays up this long. */
const MESSAGE_MS = 2400;

/**
 * The counter of whichever shop the player's being served in (see components/world/Shops):
 * what's for sale, what it costs and whether it can be had, and the player's cash, down the side
 * while the camera shows the item chosen. ↑ ↓ to choose, Enter or E to buy, Esc to leave; or
 * click (tap) an item's price.
 */
export function ShopPanel() {
	const shop = useSyncExternalStore(onShopChange, currentShop, () => null);
	// A fresh counter (first item chosen, no message) for each shop visited.
	return shop ? <ShopCounter key={shop.id} shop={shop} /> : null;
}

function ShopCounter({ shop }: Readonly<{ shop: Shop }>) {
	useSyncExternalStore(onProgressChange, progressVersion, progressVersion);
	const [selected, setSelected] = useState(0);
	const [message, setMessage] = useState<{ text: string; ok: boolean; serial: number } | null>(null);
	// Armour and rounds live in the player's combat, not the save: re-read after each purchase.
	const [, setPurchases] = useState(0);

	const purchase = (index: number) => {
		const item = shop.items[index];
		if (!item) return;
		const result = buy(item);
		setMessage((previous) => ({ text: result.message, ok: result.ok, serial: (previous?.serial ?? 0) + 1 }));
		setPurchases((count) => count + 1);
	};

	// The camera shows whatever's chosen.
	useEffect(() => setShopSelection(selected), [selected]);

	useEffect(() => {
		if (!message) return;
		const id = window.setTimeout(() => setMessage(null), MESSAGE_MS);
		return () => window.clearTimeout(id);
	}, [message]);

	// Set up again with each render, so it always sees the item chosen now.
	useEffect(() => {
		const count = shop.items.length;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.code === "Escape" || event.code === "Backspace") {
				event.preventDefault();
				closeShop();
			} else if (event.code === "ArrowDown" || event.code === "ArrowUp") {
				event.preventDefault();
				const step = event.code === "ArrowDown" ? 1 : -1;
				setSelected((selected + step + count) % count);
			} else if ((event.code === "Enter" || event.code === "KeyE") && !event.repeat) {
				event.preventDefault();
				purchase(selected);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	});

	const cash = readProgress().cash;
	return (
		<section className={`orion-shop pointer-events-auto is-${shop.kind}`} role="dialog" aria-label={shop.name}>
			<header className="orion-shop-header">
				<div>
					<p className="orion-kicker">{shop.kind === "guns" ? "Gun shop" : "Car showroom"}</p>
					<h2 className="orion-shop-title">{shop.name}</h2>
					<p className="orion-shop-tagline">{shop.tagline}</p>
				</div>
				<span className="orion-shop-cash" aria-label={`Cash ${formatCash(cash)}`}>{formatCash(cash)}</span>
			</header>
			<ul className="orion-shop-items">
				{shop.items.map((item, index) => {
					const check = checkItem(item);
					return (
						<li key={item.id}>
							<button
								type="button"
								className={`orion-shop-item orion-focus${index === selected ? " is-selected" : ""}${check.buyable ? "" : " is-unavailable"}`}
								onMouseEnter={() => setSelected(index)}
								onClick={() => {
									setSelected(index);
									purchase(index);
								}}
							>
								<span className="orion-shop-item-name">{itemName(item)}</span>
								<span className="orion-shop-item-detail">{itemDetail(item)}</span>
								<span className="orion-shop-item-price">{check.buyable || check.reason === "Not enough cash" ? formatCash(priceOf(item)) : check.reason}</span>
							</button>
						</li>
					);
				})}
			</ul>
			{message ? (
				<p key={message.serial} className={`orion-shop-message${message.ok ? " is-ok" : ""}`} role="status">{message.text}</p>
			) : null}
			<div className="orion-shop-footer">
				<p className="orion-shop-keys">↑ ↓ choose · Enter buy · Esc leave</p>
				<button type="button" className="orion-mission-button orion-focus" onClick={() => closeShop()}>Leave · Esc</button>
			</div>
		</section>
	);
}
