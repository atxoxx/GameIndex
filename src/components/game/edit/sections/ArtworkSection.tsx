import { useState } from "react";
import { MediaCandidateGallery } from "../../MediaCandidateGallery";
import { ArtworkSlotCard } from "../ArtworkSlotCard";
import { SectionHeader } from "../EditFields";
import { useEditGame } from "../EditGameContext";
import { IMAGE_SUBTAB_CONFIG, type ArtworkSlot } from "../editConstants";

const ASPECT: Record<ArtworkSlot, string> = {
  hero: "16 / 5",
  cover: "2 / 3",
  logo: "16 / 7",
  icon: "1 / 1",
};

const ORDER: ArtworkSlot[] = ["hero", "cover", "logo", "icon"];

export function ArtworkSection() {
  const {
    t,
    game,
    editName,
    editIcon,
    editCover,
    editHero,
    editLogo,
    fetchingImageKey,
    handlePickImage,
    handleFetchImage,
    handleRemoveImage,
    handleApplyFetchedImage,
    dirtyBySection,
    resetSection,
  } = useEditGame();
  const [sourceSlot, setSourceSlot] = useState<ArtworkSlot>("cover");

  const images: Record<ArtworkSlot, string> = {
    icon: editIcon,
    cover: editCover,
    hero: editHero,
    logo: editLogo,
  };

  return (
    <section className="edit-section" aria-labelledby="edit-section-artwork">
      <SectionHeader
        id="edit-section-artwork"
        title={t("edit.section.artwork")}
        description={t("edit.section.artworkDesc")}
        changed={dirtyBySection.artwork}
        onReset={() => resetSection("artwork")}
      />

      <div className="edit-artwork-board">
        {ORDER.map((slot) => {
          const config = IMAGE_SUBTAB_CONFIG[slot];
          return (
            <ArtworkSlotCard
              key={slot}
              slot={slot}
              label={t(config.labelKey)}
              subtitle={t(config.subtitleKey)}
              imageUrl={images[slot]}
              transparent={config.transparent}
              aspect={ASPECT[slot]}
              selected={sourceSlot === slot}
              fetching={fetchingImageKey === slot}
              onSelect={() => setSourceSlot(slot)}
              onPick={() => handlePickImage(slot)}
              onFetch={() => handleFetchImage(slot)}
              onRemove={() => handleRemoveImage(slot)}
            />
          );
        })}
      </div>

      <div className="edit-artwork-sources">
        <div className="edit-artwork-sources-head">
          <div>
            <h3 className="edit-subheading">{t("edit.media.fromSources")}</h3>
            <p className="edit-muted-note">{t("edit.artwork.sourcesHint")}</p>
          </div>
          <div className="edit-chip-row" role="group" aria-label={t("edit.artwork.slotPicker")}>
            {ORDER.map((slot) => (
              <button
                key={slot}
                type="button"
                className={`edit-chip edit-chip--button${sourceSlot === slot ? " is-active" : ""}`}
                aria-pressed={sourceSlot === slot}
                onClick={() => setSourceSlot(slot)}
              >
                {t(IMAGE_SUBTAB_CONFIG[slot].labelKey)}
              </button>
            ))}
          </div>
        </div>

        <MediaCandidateGallery
          key={sourceSlot}
          slot={sourceSlot}
          gameName={editName.trim() || game.name}
          steamAppId={game.steamAppId}
          onApply={(url) => handleApplyFetchedImage(sourceSlot, url)}
          variant="inline"
          showSearch={false}
        />
      </div>
    </section>
  );
}
