"use client";

import dynamic from "next/dynamic";

const OrionCanvas = dynamic(() => import("./OrionCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-[#162128] text-[#d5d1c6]">
      <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Loading OrionGenix</p>
    </div>
  ),
});

export default function OrionEntry() {
  return <OrionCanvas />;
}