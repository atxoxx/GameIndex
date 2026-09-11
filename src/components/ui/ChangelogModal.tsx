import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, CloudOff, ExternalLink, History, RefreshCw } from "lucide-react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";
import { useLanguage } from "../../context/LanguageContext";
import { useAppVersion } from "../../hooks/useAppVersion";
import {
  GITHUB_RELEASES_PAGE,
  fetchGithubReleases,
  isSafeHref,
  parseInline,
  parseReleaseNotes,
  type ReleaseBlock,
  type ReleaseEntry,
} from "../../utils/releaseNotes";

/**
 * ChangelogModal — release history dialog. Pulls every published release
 * from the GitHub Releases API on open and renders the latest notes expanded,
 * older ones collapsed.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return parseInline(text).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "link":
        return isSafeHref(token.href) ? (
          <a key={key} href={token.href} target="_blank" rel="noreferrer">
            {token.label}
          </a>
        ) : (
          <span key={key}>{token.label}</span>
        );
      case "code":
        return <code key={key}>{token.value}</code>;
      case "strong":
        return <strong key={key}>{token.value}</strong>;
      case "em":
        return <em key={key}>{token.value}</em>;
      default:
        return <span key={key}>{token.value}</span>;
    }
  });
}

function ReleaseNotes({ blocks }: { blocks: ReleaseBlock[] }) {
  return (
    <div className="changelog-notes">
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        switch (block.type) {
          case "heading":
            return (
              <div
                key={key}
                className={`changelog-heading changelog-heading--${block.level}`}
              >
                {renderInline(block.text, key)}
              </div>
            );
          case "list": {
            const items = block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>
                {renderInline(item, `${key}-${itemIndex}`)}
              </li>
            ));
            return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
          }
          case "quote":
            return <blockquote key={key}>{renderInline(block.text, key)}</blockquote>;
          case "rule":
            return <hr key={key} />;
          default:
            return <p key={key}>{renderInline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}

export interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
}

type LoadState = "idle" | "loading" | "ready" | "error";

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
  const { t } = useLanguage();
  const appVersion = useAppVersion();

  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [releases, setReleases] = useState<ReleaseEntry[]>([]);
  const [errorKind, setErrorKind] = useState<"generic" | "rateLimit">("generic");
  const [expandedTag, setExpandedTag] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoadState("loading");
    setErrorKind("generic");
    try {
      const entries = await fetchGithubReleases();
      if (requestId !== requestRef.current) return;
      setReleases(entries);
      setExpandedTag((current) =>
        current && entries.some((r) => r.tag === current) ? current : entries[0]?.tag ?? null,
      );
      setLoadState("ready");
    } catch (error) {
      if (requestId !== requestRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setErrorKind(/rate.?limit|403/i.test(message) ? "rateLimit" : "generic");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const grouped = useMemo(
    () =>
      releases.map((release) => ({
        release,
        blocks: release.body.trim() ? parseReleaseNotes(release.body) : [],
      })),
    [releases],
  );

  if (!open) return null;

  const normalizedVersion = appVersion.replace(/^v/i, "");
  const subtitle =
    loadState === "ready" && releases.length > 0
      ? t("updater.changelogCount", { count: releases.length })
      : t("updater.changelogDesc");

  let body: ReactNode;
  if (loadState === "loading" && releases.length === 0) {
    body = (
      <div className="changelog-skeleton" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div className="changelog-skeleton-row" key={i}>
            <Skeleton shape="circle" width="10px" height="10px" />
            <div className="changelog-skeleton-card">
              <Skeleton shape="rect" width="110px" height="16px" />
              <Skeleton shape="text" width="92%" />
              <Skeleton shape="text" width="74%" />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (loadState === "error" && releases.length === 0) {
    body = (
      <div className="changelog-status">
        <CloudOff className="changelog-status-icon" size={26} aria-hidden="true" />
        <p className="changelog-status-title">{t("updater.changelogError")}</p>
        <p className="changelog-status-desc">
          {errorKind === "rateLimit"
            ? t("updater.changelogRateLimited")
            : t("updater.changelogDesc")}
        </p>
        <Button
          variant="secondary"
          leftIcon={<RefreshCw size={15} />}
          onClick={() => void load()}
        >
          {t("updater.changelogRefresh")}
        </Button>
      </div>
    );
  } else if (releases.length === 0) {
    body = (
      <div className="changelog-status">
        <History className="changelog-status-icon" size={26} aria-hidden="true" />
        <p className="changelog-status-title">{t("updater.changelogEmpty")}</p>
      </div>
    );
  } else {
    body = (
      <div className="changelog-list">
        {grouped.map(({ release, blocks }, index) => {
          const isOpen = expandedTag === release.tag;
          const isCurrent =
            normalizedVersion !== "" &&
            release.tag.replace(/^v/i, "") === normalizedVersion;
          const date = release.publishedAt ? new Date(release.publishedAt) : null;
          const dateLabel =
            date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : null;

          return (
            <article
              className={`changelog-entry${isOpen ? " open" : ""}`}
              key={release.tag}
            >
              <div className="changelog-rail" aria-hidden="true">
                <span className="changelog-dot" />
              </div>
              <div className="changelog-card">
                <button
                  type="button"
                  className="changelog-head"
                  aria-expanded={isOpen}
                  onClick={() => setExpandedTag(isOpen ? null : release.tag)}
                >
                  <span className="changelog-version">{release.tag}</span>
                  {index === 0 && !release.prerelease && (
                    <Badge variant="accent">{t("updater.changelogLatest")}</Badge>
                  )}
                  {release.prerelease && (
                    <Badge variant="warning">{t("updater.changelogPrerelease")}</Badge>
                  )}
                  {isCurrent && (
                    <Badge variant="success">{t("updater.changelogCurrent")}</Badge>
                  )}
                  {dateLabel && <span className="changelog-date">{dateLabel}</span>}
                  <ChevronDown
                    className="changelog-chevron"
                    size={16}
                    aria-hidden="true"
                  />
                </button>
                {isOpen &&
                  (blocks.length ? (
                    <ReleaseNotes blocks={blocks} />
                  ) : (
                    <p className="changelog-no-notes">{t("updater.changelogNoNotes")}</p>
                  ))}
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="modal changelog-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-modal-title"
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <History aria-hidden="true" />
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="changelog-modal-title">
              {t("updater.changelog")}
            </h2>
            <p className="modal-subtitle">{subtitle}</p>
          </div>
          <a
            className="changelog-github-link"
            href={GITHUB_RELEASES_PAGE}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} aria-hidden="true" />
            {t("updater.changelogViewOnGithub")}
          </a>
        </div>

        <div className="modal-body changelog-body">{body}</div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {appVersion ? `GameIndex v${appVersion}` : "\u00A0"}
          </span>
          <div className="modal-footer-actions">
            <Button
              variant="ghost"
              leftIcon={<RefreshCw size={15} />}
              isLoading={loadState === "loading"}
              disabled={loadState === "loading"}
              onClick={() => void load()}
            >
              {t("updater.changelogRefresh")}
            </Button>
            <Button variant="primary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
