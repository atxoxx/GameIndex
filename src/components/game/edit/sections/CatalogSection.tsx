import { ArrayEditor } from "../../../ui/ArrayEditor";
import { Disclosure } from "../../../ui";
import { TagInput } from "../../../ui/TagInput";
import type { LanguageSupportInfo, ReleaseDateInfo } from "../../../../types/game";
import { Field, FieldGrid, SectionHeader } from "../EditFields";
import { useEditGame } from "../EditGameContext";
import { LANGUAGE_SUPPORT_TYPES } from "../editConstants";

export function CatalogSection() {
  const {
    t,
    editCollection,
    setEditCollection,
    editFranchise,
    setEditFranchise,
    editGameCategory,
    setEditGameCategory,
    editReleaseStatus,
    setEditReleaseStatus,
    editIsVr,
    setEditIsVr,
    editSimilarGamesNames,
    setEditSimilarGamesNames,
    editAlternativeNames,
    setEditAlternativeNames,
    editMetadataSource,
    setEditMetadataSource,
    editMetadataUrl,
    setEditMetadataUrl,
    editReleases,
    setEditReleases,
    editLanguageSupports,
    setEditLanguageSupports,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-catalog">
      <SectionHeader
        id="edit-section-catalog"
        title={t("edit.section.catalog")}
        description={t("edit.section.catalogDesc")}
        changed={dirtyBySection.catalog}
        onReset={() => resetSection("catalog")}
      />

      <Disclosure>
      <h3 className="edit-subheading">{t("edit.catalog")}</h3>
      <FieldGrid>
        <Field label={t("edit.label.series")} htmlFor="edit-collection">
          <input
            id="edit-collection"
            className="edit-input"
            type="text"
            value={editCollection}
            onChange={(event) => setEditCollection(event.target.value)}
            placeholder={t("edit.placeholder.series")}
          />
        </Field>
        <Field label={t("edit.label.franchise")} htmlFor="edit-franchise">
          <input
            id="edit-franchise"
            className="edit-input"
            type="text"
            value={editFranchise}
            onChange={(event) => setEditFranchise(event.target.value)}
            placeholder={t("edit.placeholder.franchise")}
          />
        </Field>
        <Field label={t("edit.label.gameType")} htmlFor="edit-game-category">
          <input
            id="edit-game-category"
            className="edit-input"
            type="text"
            value={editGameCategory}
            onChange={(event) => setEditGameCategory(event.target.value)}
            placeholder={t("edit.placeholder.gameType")}
          />
        </Field>
        <Field label={t("edit.label.releaseStatus")} htmlFor="edit-release-status">
          <input
            id="edit-release-status"
            className="edit-input"
            type="text"
            value={editReleaseStatus}
            onChange={(event) => setEditReleaseStatus(event.target.value)}
            placeholder={t("edit.placeholder.releaseStatus")}
          />
        </Field>
      </FieldGrid>

      <label className="edit-checkbox-row" htmlFor="edit-is-vr">
        <input
          id="edit-is-vr"
          type="checkbox"
          checked={editIsVr}
          onChange={(event) => setEditIsVr(event.target.checked)}
        />
        <span>{t("edit.label.isVr")}</span>
      </label>

      <FieldGrid>
        <Field label={t("edit.label.similarGames")} htmlFor="edit-similar-games">
          <TagInput
            id="edit-similar-games"
            value={editSimilarGamesNames}
            onChange={setEditSimilarGamesNames}
            placeholder={t("edit.placeholder.similarGame")}
            ariaLabel={t("edit.label.similarGames")}
          />
        </Field>
        <Field
          label={t("edit.label.alternativeNames")}
          htmlFor="edit-alternative-names"
        >
          <TagInput
            id="edit-alternative-names"
            value={editAlternativeNames}
            onChange={setEditAlternativeNames}
            placeholder={t("edit.placeholder.alias")}
            ariaLabel={t("edit.label.alternativeNames")}
          />
        </Field>
      </FieldGrid>

      <h3 className="edit-subheading">{t("edit.metadata")}</h3>
      <FieldGrid>
        <Field label={t("edit.label.metadataSource")} htmlFor="edit-metadata-source">
          <input
            id="edit-metadata-source"
            className="edit-input"
            type="text"
            value={editMetadataSource}
            onChange={(event) => setEditMetadataSource(event.target.value)}
            placeholder={t("edit.placeholder.metadataSource")}
          />
        </Field>
        <Field label={t("edit.label.metadataUrl")} htmlFor="edit-metadata-url">
          <input
            id="edit-metadata-url"
            className="edit-input"
            type="text"
            value={editMetadataUrl}
            onChange={(event) => setEditMetadataUrl(event.target.value)}
            placeholder="https://..."
          />
        </Field>
      </FieldGrid>

      <h3 className="edit-subheading">{t("edit.structuredData")}</h3>
      <Field label={t("edit.label.releases")} className="edit-field--full">
        <div id="edit-releases">
          <ArrayEditor<ReleaseDateInfo>
            value={editReleases}
            onChange={setEditReleases}
            createEmpty={() => ({ platform: "", dateStr: "", region: "" })}
            addLabel="edit.release.add"
            emptyText="edit.release.empty"
            columns={[
              {
                key: "platform",
                label: t("edit.release.platform"),
                placeholder: "PC",
                width: "40%",
              },
              {
                key: "dateStr",
                label: t("edit.release.date"),
                placeholder: "YYYY-MM-DD",
                width: "30%",
              },
              {
                key: "region",
                label: t("edit.release.region"),
                placeholder: t("edit.release.regionPlaceholder"),
                width: "30%",
              },
            ]}
          />
        </div>
      </Field>

      <Field label={t("edit.label.supportedLanguages")} className="edit-field--full">
        <div id="edit-languages">
          <ArrayEditor<LanguageSupportInfo>
            value={editLanguageSupports}
            onChange={setEditLanguageSupports}
            createEmpty={() => ({ language: "", supportType: "" })}
            addLabel="edit.language.add"
            emptyText="edit.language.empty"
            columns={[
              {
                key: "language",
                label: t("edit.language.language"),
                placeholder: t("edit.language.languagePlaceholder"),
                width: "55%",
              },
              {
                key: "supportType",
                label: t("edit.language.support"),
                type: "select",
                options: LANGUAGE_SUPPORT_TYPES,
                width: "45%",
              },
            ]}
          />
        </div>
      </Field>
      </Disclosure>
    </section>
  );
}
