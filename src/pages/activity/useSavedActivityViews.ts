import { useCallback, useRef, useState } from "react";
import {
  readSavedViews,
  removeSavedView,
  upsertSavedView,
  writeSavedViews,
  type SavedActivityView,
} from "../../utils/activity/savedViews";

export interface SaveActivityViewInput {
  name: string;
  tab: SavedActivityView["tab"];
  rangeKey: SavedActivityView["rangeKey"];
  from: string;
  to: string;
  source: string;
  gameId: string | null;
  filters: SavedActivityView["filters"];
}

/** Named view presets, persisted locally and capped by the pure helpers. */
export function useSavedActivityViews() {
  const [views, setViews] = useState<SavedActivityView[]>(() => readSavedViews());
  const viewsRef = useRef(views);
  viewsRef.current = views;

  const persist = useCallback((next: SavedActivityView[]) => {
    viewsRef.current = next;
    setViews(next);
    writeSavedViews(next);
  }, []);

  const save = useCallback(
    (input: SaveActivityViewInput) => {
      const next = upsertSavedView(viewsRef.current, input);
      persist(next);
      return next;
    },
    [persist],
  );

  const remove = useCallback(
    (id: string) => {
      persist(removeSavedView(viewsRef.current, id));
    },
    [persist],
  );

  return { views, save, remove };
}
