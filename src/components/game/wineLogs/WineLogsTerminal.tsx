import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import { Copy } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { copyTextToClipboard } from "../../../utils/clipboard";
import {
  formatCount,
  splitHighlight,
  type LogRow,
} from "./logAnalysis";
import { useVirtualRows } from "./useVirtualRows";

/** Fixed row height while wrapping is off; also the virtualisation step. */
const ROW_HEIGHT = 20;
/** Wrapped rows have no fixed height, so rendering is capped instead. */
const MAX_WRAPPED_ROWS = 5000;
/** Below this many rows virtualisation costs more than it saves. */
const VIRTUALIZE_ABOVE = 300;

export interface WineLogsTerminalHandle {
  /** Scroll to a position in the visible row list. */
  jumpToPosition: (position: number) => void;
}

interface WineLogsTerminalProps {
  rows: LogRow[];
  query: string;
  wrap: boolean;
  autoScroll: boolean;
  /** Raw line index of the focused match, if any. */
  activeIndex: number | null;
  ariaLabel: string;
  onCopyLineResult?: (ok: boolean) => void;
}

export const WineLogsTerminal = forwardRef<WineLogsTerminalHandle, WineLogsTerminalProps>(
  function WineLogsTerminal(
    { rows, query, wrap, autoScroll, activeIndex, ariaLabel, onCopyLineResult },
    ref
  ) {
    const { t } = useLanguage();
    const stickToBottomRef = useRef(true);
    const previousAutoScrollRef = useRef(autoScroll);

    const virtualization = useVirtualRows({
      count: rows.length,
      rowHeight: ROW_HEIGHT,
      enabled: !wrap && rows.length > VIRTUALIZE_ABOVE,
    });
    const scrollRef: RefObject<HTMLDivElement | null> = virtualization.scrollRef;

    const renderedRows = wrap ? rows.slice(0, MAX_WRAPPED_ROWS) : rows;
    const hiddenCount = wrap ? Math.max(0, rows.length - MAX_WRAPPED_ROWS) : 0;
    const windowRows = virtualization.enabled
      ? renderedRows.slice(virtualization.start, virtualization.end)
      : renderedRows;

    const lastRowText = rows.length > 0 ? rows[rows.length - 1].text : "";

    // Horizontal scroll width is pinned from the longest line instead of
    // `max-content`, so virtualisation cannot make the scrollbar jump around
    // while the visible window changes. Monospace makes `ch` exact; the cap
    // keeps a pathological 200k-character line from creating a huge canvas.
    const contentChars = useMemo(() => {
      if (wrap) return 0;
      let longest = 0;
      for (const row of rows) {
        if (row.text.length > longest) longest = row.text.length;
      }
      return Math.min(longest + 2, 4000);
    }, [rows, wrap]);

    useEffect(() => {
      const el = scrollRef.current;
      if (!el || !autoScroll || !stickToBottomRef.current) return;
      el.scrollTop = el.scrollHeight;
    }, [rows.length, lastRowText, wrap, autoScroll, scrollRef]);

    useEffect(() => {
      if (autoScroll && !previousAutoScrollRef.current) {
        stickToBottomRef.current = true;
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
      previousAutoScrollRef.current = autoScroll;
    }, [autoScroll, scrollRef]);

    useImperativeHandle(
      ref,
      () => ({
        jumpToPosition(position: number) {
          const el = scrollRef.current;
          if (!el) return;
          // Jumping means the reader is inspecting a specific line, so live
          // tailing must not pull the viewport back to the bottom.
          stickToBottomRef.current = false;
          if (virtualization.enabled) {
            virtualization.scrollToIndex(position);
            return;
          }
          const target = el.querySelector<HTMLElement>(
            `[data-row-position="${position}"]`
          );
          if (!target) return;
          if (typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ block: "center" });
          } else {
            el.scrollTop = Math.max(0, target.offsetTop - Math.floor(el.clientHeight / 2));
          }
        },
      }),
      [scrollRef, virtualization]
    );

    function handleScroll() {
      const el = scrollRef.current;
      if (el) {
        stickToBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }
      virtualization.onScroll();
    }

    async function handleCopyLine(text: string) {
      const ok = await copyTextToClipboard(text);
      onCopyLineResult?.(ok);
    }

    return (
      <div
        ref={scrollRef}
        className={`wine-logs-terminal${wrap ? " is-wrapped" : ""}`}
        data-wrap={wrap ? "true" : "false"}
        role="log"
        aria-live="off"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={handleScroll}
      >
        <div
          className="wine-logs-rows"
          style={contentChars > 0 ? { minWidth: `${contentChars}ch` } : undefined}
        >
          {virtualization.enabled && virtualization.topSpacer > 0 ? (
            <div
              className="wine-logs-spacer"
              style={{ height: virtualization.topSpacer }}
              aria-hidden
            />
          ) : null}

          {windowRows.map((row, offset) => {
            const position = virtualization.enabled
              ? virtualization.start + offset
              : offset;
            const segments = splitHighlight(row.text, query);
            return (
              <div
                key={row.index}
                className={[
                  "wine-logs-row",
                  `wine-logs-row--${row.severity}`,
                  activeIndex === row.index ? "is-active-match" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-row-position={position}
                data-severity={row.severity}
                title={`#${row.index + 1}`}
              >
                <span className="wine-logs-row-gutter" aria-hidden />
                <span className="wine-logs-row-text">
                  {segments.map((segment, index) =>
                    segment.match ? (
                      <mark className="wine-logs-mark" key={index}>
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    )
                  )}
                </span>
                <button
                  type="button"
                  className="wine-logs-row-copy"
                  onClick={() => void handleCopyLine(row.text)}
                  title={t("wineLogs.copyLine")}
                  aria-label={t("wineLogs.copyLine")}
                >
                  <Copy size={11} />
                </button>
              </div>
            );
          })}

          {virtualization.enabled && virtualization.bottomSpacer > 0 ? (
            <div
              className="wine-logs-spacer"
              style={{ height: virtualization.bottomSpacer }}
              aria-hidden
            />
          ) : null}

          {hiddenCount > 0 ? (
            <div className="wine-logs-notice">
              {t("wineLogs.hiddenLines", { count: formatCount(hiddenCount) })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }
);
