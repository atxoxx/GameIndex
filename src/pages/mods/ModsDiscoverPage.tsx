// /mods/discover is now a deep link into the Mods workspace. Discover lives
// as a tab there, so old links (and the big-screen route) keep working.

import { Navigate, useSearchParams } from "react-router-dom";

export default function ModsDiscoverPage() {
  const [searchParams] = useSearchParams();
  const gameId = searchParams.get("gameId");
  const target = gameId
    ? `/mods?game=${encodeURIComponent(gameId)}&tab=discover`
    : "/mods?tab=discover";
  return <Navigate to={target} replace />;
}
