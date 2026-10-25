import { TagInput } from "../../../ui/TagInput";
import { Field, FieldGrid, SectionHeader } from "../EditFields";
import { useEditGame } from "../EditGameContext";
import {
  GENRE_SUGGESTIONS,
  MODE_SUGGESTIONS,
  PERSPECTIVE_SUGGESTIONS,
  THEME_SUGGESTIONS,
} from "../editConstants";

export function TagsSection() {
  const {
    t,
    editGenres,
    setEditGenres,
    editThemes,
    setEditThemes,
    editGameModes,
    setEditGameModes,
    editPlayerPerspectives,
    setEditPlayerPerspectives,
    editStoryline,
    setEditStoryline,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-tags">
      <SectionHeader
        id="edit-section-tags"
        title={t("edit.section.tags")}
        description={t("edit.section.tagsDesc")}
        changed={dirtyBySection.tags}
        onReset={() => resetSection("tags")}
      />

      <FieldGrid>
        <Field label={t("edit.label.genres")} htmlFor="edit-genres">
          <TagInput
            id="edit-genres"
            value={editGenres}
            onChange={setEditGenres}
            placeholder={t("edit.placeholder.genre")}
            suggestions={GENRE_SUGGESTIONS}
            ariaLabel={t("edit.label.genres")}
          />
        </Field>
        <Field label={t("edit.label.themes")} htmlFor="edit-themes">
          <TagInput
            id="edit-themes"
            value={editThemes}
            onChange={setEditThemes}
            placeholder={t("edit.placeholder.theme")}
            suggestions={THEME_SUGGESTIONS}
            ariaLabel={t("edit.label.themes")}
          />
        </Field>
        <Field label={t("edit.label.gameModes")} htmlFor="edit-modes">
          <TagInput
            id="edit-modes"
            value={editGameModes}
            onChange={setEditGameModes}
            placeholder={t("edit.placeholder.mode")}
            suggestions={MODE_SUGGESTIONS}
            ariaLabel={t("edit.label.gameModes")}
          />
        </Field>
        <Field label={t("edit.label.perspectives")} htmlFor="edit-perspectives">
          <TagInput
            id="edit-perspectives"
            value={editPlayerPerspectives}
            onChange={setEditPlayerPerspectives}
            placeholder={t("edit.placeholder.perspective")}
            suggestions={PERSPECTIVE_SUGGESTIONS}
            ariaLabel={t("edit.label.perspectives")}
          />
        </Field>
      </FieldGrid>

      <Field
        label={t("edit.label.storyline")}
        htmlFor="edit-storyline"
        className="edit-field--full"
      >
        <textarea
          id="edit-storyline"
          className="edit-input edit-textarea"
          value={editStoryline}
          onChange={(event) => setEditStoryline(event.target.value)}
          placeholder={t("edit.placeholder.storyline")}
          rows={4}
        />
      </Field>
    </section>
  );
}
