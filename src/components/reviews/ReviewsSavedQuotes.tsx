import { useMemo, useState } from "react";
import { Bookmark, Copy, Quote, Trash2 } from "lucide-react";
import { Badge, Button } from "../ui";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { ReviewQuote } from "../../types/reviewQuote";
import { GameTabEmpty, GameTabSkeleton } from "../game/tabs";

export interface ReviewsSavedQuotesProps {
  quotes: ReviewQuote[];
  loading: boolean;
  onDelete: (id: string) => void;
}

/** Saved bookmarks and highlighted excerpts for this game. */
export default function ReviewsSavedQuotes({
  quotes,
  loading,
  onDelete,
}: ReviewsSavedQuotesProps) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const formatDate = useMemo(
    () =>
      new Intl.DateTimeFormat(language, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [language],
  );

  const copy = async (quote: ReviewQuote) => {
    try {
      await navigator.clipboard.writeText(quote.excerpt);
      setCopiedId(quote.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      showToast(t("reviewsTab.copyFailed"), "error");
    }
  };

  if (loading && quotes.length === 0) {
    return <GameTabSkeleton count={3} height={140} />;
  }

  if (quotes.length === 0) {
    return (
      <GameTabEmpty
        icon={<Quote size={24} />}
        title={t("review.savedEmptyTitle")}
        description={t("review.savedEmptyBody")}
      />
    );
  }

  return (
    <div className="rv-quotes">
      {quotes.map((quote) => (
        <article className="rv-quote" key={quote.id}>
          <header className="rv-quote__head">
            <span className="rv-quote__kind">
              {quote.kind === "review" ? <Bookmark size={13} /> : <Quote size={13} />}
              {quote.kind === "review"
                ? t("review.savedKindReview")
                : t("review.savedKindQuote")}
            </span>
            <span className="rv-quote__source">{quote.sourceLabel || quote.source}</span>
            {quote.rating != null && (
              <Badge variant="default" size="sm">
                {Math.round(quote.rating)}/100
              </Badge>
            )}
            <span className="rv-quote__date">
              {formatDate.format(new Date(quote.createdAt))}
            </span>
          </header>

          <blockquote className="rv-quote__text">“{quote.excerpt}”</blockquote>

          <footer className="rv-quote__foot">
            <span className="rv-quote__author">
              {quote.author || quote.sourceLabel}
              {quote.title ? ` · ${quote.title}` : ""}
            </span>
            <span className="rv-quote__spacer" />
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Copy size={13} />}
              onClick={() => void copy(quote)}
            >
              {copiedId === quote.id ? t("weblinks.copied") : t("weblinks.copy")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 size={13} />}
              onClick={() => onDelete(quote.id)}
            >
              {t("common.delete")}
            </Button>
          </footer>
        </article>
      ))}
    </div>
  );
}
