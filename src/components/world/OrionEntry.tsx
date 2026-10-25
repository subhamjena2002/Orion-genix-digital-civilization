"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { fetchMe } from "@/components/account/authApi";
import { startCloudSave } from "@/engine/orion/missions/CloudSave";

import { LoadingScreen } from "./LoadingScreen";

const OrionCanvas = dynamic(() => import("./OrionCanvas"), {
  ssr: false,
  // The same screen the canvas carries on with, so the bar runs on without a jump.
  loading: () => <LoadingScreen progress={0.02} label="Loading the game" />,
});

/**
 * The game is for signed-in players: the Worker sends anyone else to /signin before this page is
 * served (worker/index.ts, playPage). This is the same check from the page, for a copy served
 * without asking the server (the offline cache, or a session that ended while the tab was open).
 * Where it can't ask (offline, or plain `npm run dev` with no API) the game carries on.
 */
function useSignedInOrLeave() {
  useEffect(() => {
    let live = true;
    void fetchMe().then((result) => {
      if (live && result.ok && !result.user) window.location.replace("/signin?return=%2Fplay");
    });
    return () => {
      live = false;
    };
  }, []);
}

export default function OrionEntry() {
  useSignedInOrLeave();
  // The cloud copy of the save: started once the page is idle, and never waited on.
  useEffect(() => startCloudSave(), []);
  return <OrionCanvas />;
}
