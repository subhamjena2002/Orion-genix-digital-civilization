"use client";

import dynamic from "next/dynamic";

import { LoadingScreen } from "./LoadingScreen";

const OrionCanvas = dynamic(() => import("./OrionCanvas"), {
  ssr: false,
  // The same screen the canvas carries on with, so the bar runs on without a jump.
  loading: () => <LoadingScreen progress={0.02} label="Loading the game" />,
});

export default function OrionEntry() {
  return <OrionCanvas />;
}