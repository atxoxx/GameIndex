import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

// Resolve once per session and share the result so every consumer
// (topnav badge, settings) shows the same value without N IPC calls.
let cached: string | null = null;
const load = getVersion()
  .then((v) => {
    cached = v;
  })
  .catch(() => {
    cached = "";
  });

export function useAppVersion(): string {
  const [version, setVersion] = useState(cached ?? "");
  useEffect(() => {
    void load.then(() => setVersion(cached ?? ""));
  }, []);
  return version;
}
