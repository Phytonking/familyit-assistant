"use client";

import dynamic from "next/dynamic";

// The call UI touches browser-only APIs (media devices, speech) at construction time.
const LiveHelpApp = dynamic(() => import("./LiveHelpApp"), {
  ssr: false,
  loading: () => <div className="h-dvh w-full bg-zinc-950" />,
});

export default function ClientRoot() {
  return <LiveHelpApp />;
}
