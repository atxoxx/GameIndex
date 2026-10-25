import { Button } from "../../../ui";
import { PLAY_STATUS_DETAILS, type PlayStatus } from "../../../../types/game";
import { Field, FieldGrid, SectionHeader } from "../EditFields";
import { useEditGame } from "../EditGameContext";

export function IdentitySection() {
  const {
    t,
    game,
    editName,
    setEditName,
    editDisplayName,
    setEditDisplayName,
    editPlayStatus,
    setEditPlayStatus,
    editPlatform,
    setEditPlatform,
    editVersion,
    setEditVersion,
    cachedVersion,
    detectingVersion,
    handleDetectVersion,
    editReleaseDate,
    setEditReleaseDate,
    editDeveloper,
    setEditDeveloper,
    editPublisher,
    setEditPublisher,
    editDescription,
    setEditDescription,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-identity">
      <SectionHeader
        id="edit-section-identity"
        title={t("edit.section.identity")}
        description={t("edit.section.identityDesc")}
        changed={dirtyBySection.identity}
        onReset={() => resetSection("identity")}
      />

      <FieldGrid>
        <Field label={t("edit.label.name")} htmlFor="edit-name">
          <input
            id="edit-name"
            className="edit-input"
            type="text"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            placeholder={t("edit.placeholder.name")}
          />
        </Field>

        <Field
          label={t("edit.label.displayName")}
          htmlFor="edit-display-name"
          hint={t("edit.label.displayNameHint")}
        >
          <input
            id="edit-display-name"
            className="edit-input"
            type="text"
            value={editDisplayName}
            onChange={(event) => setEditDisplayName(event.target.value)}
            placeholder={game.name}
          />
        </Field>

        <Field label={t("edit.label.playStatus")} htmlFor="edit-play-status">
          <select
            id="edit-play-status"
            className="edit-input edit-select"
            value={editPlayStatus}
            onChange={(event) => setEditPlayStatus(event.target.value as PlayStatus)}
          >
            {Object.entries(PLAY_STATUS_DETAILS).map(([key, details]) => (
              <option key={key} value={key}>
                {t(details.labelKey)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("edit.label.platform")} htmlFor="edit-platform">
          <input
            id="edit-platform"
            className="edit-input"
            type="text"
            value={editPlatform}
            onChange={(event) => setEditPlatform(event.target.value)}
            placeholder={t("edit.placeholder.platform")}
          />
        </Field>

        <Field label={t("edit.label.version")} htmlFor="edit-version">
          <div className="edit-inline-row">
            <input
              id="edit-version"
              className="edit-input"
              type="text"
              value={editVersion}
              onChange={(event) => setEditVersion(event.target.value)}
              placeholder={cachedVersion || t("edit.versionPlaceholder")}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDetectVersion}
              disabled={detectingVersion}
              isLoading={detectingVersion}
              title={t("edit.autoDetectVersionTitle")}
            >
              {detectingVersion ? t("community.detecting") : t("edit.autoDetect")}
            </Button>
            {editVersion && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditVersion("")}
                title={t("common.clear")}
              >
                {t("common.clear")}
              </Button>
            )}
          </div>
        </Field>

        <Field label={t("edit.label.releaseDate")} htmlFor="edit-release-date">
          <input
            id="edit-release-date"
            className="edit-input"
            type="text"
            value={editReleaseDate}
            onChange={(event) => setEditReleaseDate(event.target.value)}
            placeholder={t("edit.placeholder.releaseDate")}
          />
        </Field>

        <Field label={t("edit.label.developer")} htmlFor="edit-developer">
          <input
            id="edit-developer"
            className="edit-input"
            type="text"
            value={editDeveloper}
            onChange={(event) => setEditDeveloper(event.target.value)}
            placeholder={t("edit.placeholder.developer")}
          />
        </Field>

        <Field label={t("edit.label.publisher")} htmlFor="edit-publisher">
          <input
            id="edit-publisher"
            className="edit-input"
            type="text"
            value={editPublisher}
            onChange={(event) => setEditPublisher(event.target.value)}
            placeholder={t("edit.placeholder.publisher")}
          />
        </Field>
      </FieldGrid>

      <Field
        label={t("edit.label.description")}
        htmlFor="edit-description"
        className="edit-field--full"
      >
        <textarea
          id="edit-description"
          className="edit-input edit-textarea"
          value={editDescription}
          onChange={(event) => setEditDescription(event.target.value)}
          placeholder={t("edit.placeholder.description")}
          rows={4}
        />
      </Field>
    </section>
  );
}
