import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StoreGameSummary } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import {
  COMPARE_MAX,
  bestIndexes,
  sharedValues,
  type CompareRow,
  type CompareValue,
} from "./storeCompare";

interface StoreCompareModalProps {
  games: StoreGameSummary[];
  /** Catalogue games offered by the in-modal "add game" picker. */
  availableGames?: StoreGameSummary[];
  isInLibrary?: (game: StoreGameSummary) => boolean;
  onClose: () => void;
  onOpenGame: (game: StoreGameSummary) => void;
  onRemove: (slug: string) => void;
  onAdd: (game: StoreGameSummary) => void;
  onClear: () => void;
}

interface ChipRow {
  key: string;
  label: string;
  list: (game: StoreGameSummary) => string[] | undefined;
}

const PICKER_LIMIT = 6;

function formatDate(value: CompareValue, locale: string): string {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatNumber(value: CompareValue, locale: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * StoreCompareModal: side-by-side comparison of up to {@link COMPARE_MAX}
 * pinned store games. Numeric rows flag the best value (ties included),
 * list rows highlight values shared by every column, and games can be
 * added or removed without leaving the modal.
 */
export default function StoreCompareModal({
  games,
  availableGames = [],
  isInLibrary,
  onClose,
  onOpenGame,
  onRemove,
  onAdd,
  onClear,
}: StoreCompareModalProps) {
  const { t, language } = useLanguage();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const root = modalRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, []);

  const rows = useMemo<CompareRow[]>(
    () => [
      {
        key: "inLibrary",
        label: t("store.compare.inLibrary"),
        value: (g) =>
          isInLibrary
            ? isInLibrary(g)
              ? t("store.compare.yes")
              : t("store.compare.no")
            : null,
      },
      {
        key: "rating",
        label: t("store.compare.rating"),
        better: "high",
        value: (g) => g.rating,
      },
      {
        key: "critics",
        label: t("store.compare.critics"),
        better: "high",
        value: (g) => g.aggregatedRating,
      },
      {
        key: "released",
        label: t("store.compare.released"),
        value: (g) => g.firstReleaseDate,
      },
      {
        key: "ratingsCount",
        label: t("store.compare.ratingsCount"),
        better: "high",
        value: (g) => g.totalRatingCount,
      },
      {
        key: "followers",
        label: t("store.compare.followers"),
        better: "high",
        value: (g) => g.hypes,
      },
      {
        key: "series",
        label: t("store.compare.series"),
        value: (g) => g.collection || g.franchise || null,
      },
    ],
    [t, isInLibrary]
  );

  const chipRows: ChipRow[] = useMemo(
    () => [
      { key: "genres", label: t("store.compare.genres"), list: (g) => g.genres },
      { key: "platforms", label: t("store.compare.platforms"), list: (g) => g.platforms },
      { key: "modes", label: t("store.compare.modes"), list: (g) => g.gameModes },
      { key: "themes", label: t("store.compare.themes"), list: (g) => g.themes },
    ],
    [t]
  );

  const winnerByRow = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const row of rows) map.set(row.key, bestIndexes(games, row));
    return map;
  }, [rows, games]);

  const sharedByRow = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of chipRows) map.set(row.key, sharedValues(games, row.list));
    return map;
  }, [chipRows, games]);

  const pickerResults = useMemo(() => {
    const pinned = new Set(games.map((g) => g.slug));
    const query = pickerQuery.trim().toLowerCase();
    return availableGames
      .filter(
        (g) =>
          !pinned.has(g.slug) &&
          (query === "" || g.name.toLowerCase().includes(query))
      )
      .slice(0, PICKER_LIMIT);
  }, [availableGames, games, pickerQuery]);

  const renderCellValue = (row: CompareRow, game: StoreGameSummary): string => {
    const value = row.value(game);
    if (row.key === "released") return formatDate(value, language);
    if (row.key === "ratingsCount" || row.key === "followers") {
      return formatNumber(value, language);
    }
    if (row.key === "rating" || row.key === "critics") {
      return typeof value === "number" && Number.isFinite(value)
        ? `${Math.round(value)}/100`
        : "—";
    }
    return typeof value === "string" && value ? value : "—";
  };

  const columns = `minmax(104px, 132px) repeat(${games.length}, minmax(158px, 1fr))${
    games.length < COMPARE_MAX ? " 150px" : ""
  }`;

  return createPortal(
    <div className="store-compare-modal-scrim ui-complete-only" onClick={onClose}>
      <div
        ref={modalRef}
        className="store-compare-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("store.compare.gamesAria")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="store-compare-modal-header">
          <h2>
            {t("store.compare.title")}
            <span className="store-compare-modal-count">
              {games.length}/{COMPARE_MAX}
            </span>
          </h2>
          <div className="store-compare-modal-header-actions">
            <button
              type="button"
              className={`store-compare-add-toggle${pickerOpen ? " active" : ""}`}
              onClick={() => setPickerOpen((v) => !v)}
              disabled={games.length >= COMPARE_MAX}
              title={
                games.length >= COMPARE_MAX
                  ? t("store.compare.full", { max: COMPARE_MAX })
                  : t("store.compare.addGame")
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>{t("store.compare.addGame")}</span>
            </button>
            <button
              ref={closeRef}
              type="button"
              className="store-compare-modal-close"
              onClick={onClose}
              aria-label={t("store.compare.close")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {pickerOpen && (
          <div className="store-compare-picker">
            <input
              type="text"
              className="store-compare-picker-input"
              placeholder={t("store.compare.searchGames")}
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              autoFocus
            />
            <div className="store-compare-picker-results">
              {pickerResults.length === 0 ? (
                <p className="store-compare-picker-empty">
                  {t("store.compare.noSuggestions")}
                </p>
              ) : (
                pickerResults.map((g) => (
                  <button
                    key={g.slug}
                    type="button"
                    className="store-compare-picker-item"
                    onClick={() => {
                      onAdd(g);
                      setPickerQuery("");
                      setPickerOpen(false);
                    }}
                  >
                    {g.coverUrl && <img src={g.coverUrl} alt="" loading="lazy" />}
                    <span>{g.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <div className="store-compare-scroll">
          <div
            className="store-compare-grid"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="store-compare-corner" />
            {games.map((g) => (
              <div key={g.slug} className="store-compare-col-head">
                <button
                  type="button"
                  className="store-compare-col-cover-btn"
                  onClick={() => onOpenGame(g)}
                  title={t("store.compare.openGame")}
                >
                  {g.coverUrl ? (
                    <img src={g.coverUrl} alt="" className="store-compare-col-cover" />
                  ) : (
                    <div className="store-compare-col-cover store-compare-col-cover--empty" />
                  )}
                </button>
                <button
                  type="button"
                  className="store-compare-col-name"
                  onClick={() => onOpenGame(g)}
                  title={g.name}
                >
                  {g.name}
                </button>
                <button
                  type="button"
                  className="store-compare-col-remove"
                  onClick={() => onRemove(g.slug)}
                  aria-label={t("store.compare.removeFromCompare", { name: g.name })}
                  title={t("store.compare.removeFromCompare", { name: g.name })}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}

            {games.length < COMPARE_MAX && (
              <div className="store-compare-add-col">
                <button
                  type="button"
                  className="store-compare-add-col-btn"
                  onClick={() => setPickerOpen(true)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>{t("store.compare.addGame")}</span>
                </button>
              </div>
            )}

            {rows.map((row) => {
              const winners = winnerByRow.get(row.key) ?? new Set<number>();
              return (
                <div key={row.key} className="store-compare-row-contents">
                  <div className="store-compare-row-label">{row.label}</div>
                  {games.map((g, i) => {
                    const isBest = winners.has(i);
                    const value = row.value(g);
                    const isScore =
                      (row.key === "rating" || row.key === "critics") &&
                      typeof value === "number" &&
                      Number.isFinite(value);
                    return (
                      <div
                        key={g.slug}
                        className={`store-compare-cell${isBest ? " is-best" : ""}`}
                        title={isBest ? t("store.compare.best") : undefined}
                      >
                        {isScore ? (
                          <div className="store-compare-score">
                            <span className="store-compare-score-value">
                              {Math.round(value as number)}
                              <span className="store-compare-score-max">/100</span>
                            </span>
                            <span className="store-compare-score-meter" aria-hidden="true">
                              <span
                                className="store-compare-score-fill"
                                style={{ width: `${Math.min(100, Math.max(0, value as number))}%` }}
                              />
                            </span>
                          </div>
                        ) : (
                          <span className="store-compare-cell-text">
                            {renderCellValue(row, g)}
                          </span>
                        )}
                        {isBest && (
                          <span className="store-compare-best-badge" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {games.length < COMPARE_MAX && <div className="store-compare-cell is-spacer" />}
                </div>
              );
            })}

            {chipRows.map((row) => {
              const shared = sharedByRow.get(row.key) ?? new Set<string>();
              return (
                <div key={row.key} className="store-compare-row-contents">
                  <div className="store-compare-row-label">{row.label}</div>
                  {games.map((g) => {
                    const values = row.list(g) ?? [];
                    return (
                      <div key={g.slug} className="store-compare-cell store-compare-cell--chips">
                        {values.length === 0 ? (
                          <span className="store-compare-cell-text">—</span>
                        ) : (
                          values.slice(0, 8).map((value) => (
                            <span
                              key={value}
                              className={`store-compare-chip${shared.has(value) ? " is-shared" : ""}`}
                              title={shared.has(value) ? t("store.compare.shared") : undefined}
                            >
                              {value}
                            </span>
                          ))
                        )}
                      </div>
                    );
                  })}
                  {games.length < COMPARE_MAX && <div className="store-compare-cell is-spacer" />}
                </div>
              );
            })}

            <div className="store-compare-row-contents">
              <div className="store-compare-row-label">{t("store.compare.summary")}</div>
              {games.map((g) => (
                <div key={g.slug} className="store-compare-cell store-compare-cell--summary">
                  {g.summary ? (
                    <p className="store-compare-summary" title={g.summary}>
                      {g.summary}
                    </p>
                  ) : (
                    <span className="store-compare-cell-text">—</span>
                  )}
                </div>
              ))}
              {games.length < COMPARE_MAX && <div className="store-compare-cell is-spacer" />}
            </div>
          </div>
        </div>

        <div className="store-compare-modal-footer">
          <span className="store-compare-footer-hint">
            {games.length < 2 ? t("store.compare.emptyHint") : ""}
          </span>
          <div className="store-compare-footer-actions">
            <button
              type="button"
              className="store-compare-clear"
              onClick={() => {
                onClear();
                onClose();
              }}
              disabled={games.length === 0}
            >
              {t("store.compare.clearAll")}
            </button>
            <button type="button" className="store-compare-open" onClick={onClose}>
              {t("store.compare.close")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
