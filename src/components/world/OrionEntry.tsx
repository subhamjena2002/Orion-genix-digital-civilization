"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { startCloudSave } from "@/engine/orion/missions/CloudSave";

import { LoadingScreen } from "./LoadingScreen";

const OrionCanvas = dynamic(() => import("./OrionCanvas"), {
  ssr: false,
  // The same screen the canvas carries on with, so the bar runs on without a jump.
  loading: () => <LoadingScreen progress={0.02} label="Loading the game" />,
});

export default function OrionEntry() {
  // The cloud copy of the save: started once the page is idle, and never waited on.
  useEffect(() => startCloudSave(), []);
  return <OrionCanvas />;
}
