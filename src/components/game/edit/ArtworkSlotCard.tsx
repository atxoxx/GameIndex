import { Image as ImageIcon, Search, Trash2, Upload } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";

export function ArtworkSlotCard({
  slot,
  label,
  subtitle,
  imageUrl,
  transparent,
  aspect,
  selected,
  fetching,
  onSelect,
  onPick,
  onFetch,
  onRemove,
}: {
  slot: "icon" | "cover" | "hero" | "logo";
  label: string;
  subtitle: string;
  imageUrl: string;
  transparent?: boolean;
  aspect: string;
  selected: boolean;
  fetching: boolean;
  onSelect: () => void;
  onPick: () => void;
  onFetch: () => void;
  onRemove: () => void;
}) {
  const { t } = useLanguage();

  return (
    <article
      id={`edit-artwork-${slot}`}
      className={[
        "edit-artwork-slot",
        `edit-artwork-slot--${slot}`,
        imageUrl ? "has-image" : "is-empty",
        selected ? "is-selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className={`edit-artwork-preview${transparent ? " is-transparent" : ""}`}
        style={{ aspectRatio: aspect }}
        onClick={onSelect}
        aria-pressed={selected}
        title={t("edit.artwork.showSources", { slot: label })}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={label} loading="lazy" />
        ) : (
          <span className="edit-artwork-placeholder">
            <ImageIcon size={22} aria-hidden="true" />
            <span>{t("edit.artwork.empty")}</span>
          </span>
        )}
      </button>

      <div className="edit-artwork-meta">
        <div className="edit-artwork-heading">
          <span className="edit-artwork-label">{label}</span>
          <span className={`edit-artwork-status${imageUrl ? " is-set" : ""}`}>
            {imageUrl ? t("edit.artwork.set") : t("edit.artwork.notSet")}
          </span>
        </div>
        <span className="edit-artwork-sub">{subtitle}</span>
      </div>

      <div className="edit-artwork-actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={onPick}
          leftIcon={<Upload size={13} />}
        >
          {t("editImage.file")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onFetch}
          disabled={fetching}
          isLoading={fetching}
          leftIcon={!fetching ? <Search size={13} /> : undefined}
        >
          {t("editImage.fetch")}
        </Button>
        {imageUrl && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onRemove}
            aria-label={t("edit.artwork.remove", { slot: label })}
            title={t("edit.artwork.remove", { slot: label })}
            leftIcon={<Trash2 size={14} />}
          />
        )}
      </div>
    </article>
  );
}
