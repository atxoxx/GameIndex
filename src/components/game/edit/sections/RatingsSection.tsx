import { Disclosure } from "../../../ui";
import { Field, FieldGrid, SectionHeader } from "../EditFields";
import { useEditGame } from "../EditGameContext";

export function RatingsSection() {
  const {
    t,
    editIgdbRating,
    setEditIgdbRating,
    editCriticRating,
    setEditCriticRating,
    editTimeToBeatMain,
    setEditTimeToBeatMain,
    editTimeToBeatExtra,
    setEditTimeToBeatExtra,
    editTimeToBeatComple,
    setEditTimeToBeatComple,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-ratings">
      <SectionHeader
        id="edit-section-ratings"
        title={t("edit.section.ratings")}
        description={t("edit.section.ratingsDesc")}
        changed={dirtyBySection.ratings}
        onReset={() => resetSection("ratings")}
      />

      <Disclosure>
      <h3 className="edit-subheading">{t("edit.ratings")}</h3>
      <FieldGrid>
        <Field label={t("edit.label.igdbRating")} htmlFor="edit-igdb-rating">
          <input
            id="edit-igdb-rating"
            className="edit-input"
            type="number"
            min={0}
            max={100}
            value={editIgdbRating || ""}
            onChange={(event) => setEditIgdbRating(Number(event.target.value))}
            placeholder="0-100"
          />
        </Field>
        <Field label={t("edit.label.criticRating")} htmlFor="edit-critic-rating">
          <input
            id="edit-critic-rating"
            className="edit-input"
            type="number"
            min={0}
            max={100}
            value={editCriticRating || ""}
            onChange={(event) => setEditCriticRating(Number(event.target.value))}
            placeholder="0-100"
          />
        </Field>
      </FieldGrid>

      <h3 className="edit-subheading">{t("edit.section.length")}</h3>
      <FieldGrid columns={3}>
        <Field label={t("edit.label.hltbMain")} htmlFor="edit-hltb-main">
          <input
            id="edit-hltb-main"
            className="edit-input"
            type="number"
            min={0}
            value={editTimeToBeatMain || ""}
            onChange={(event) => setEditTimeToBeatMain(Number(event.target.value))}
            placeholder={t("edit.placeholder.hours")}
          />
        </Field>
        <Field label={t("edit.label.hltbExtra")} htmlFor="edit-hltb-extra">
          <input
            id="edit-hltb-extra"
            className="edit-input"
            type="number"
            min={0}
            value={editTimeToBeatExtra || ""}
            onChange={(event) => setEditTimeToBeatExtra(Number(event.target.value))}
            placeholder={t("edit.placeholder.hours")}
          />
        </Field>
        <Field label={t("edit.label.hltbComple")} htmlFor="edit-hltb-comple">
          <input
            id="edit-hltb-comple"
            className="edit-input"
            type="number"
            min={0}
            value={editTimeToBeatComple || ""}
            onChange={(event) => setEditTimeToBeatComple(Number(event.target.value))}
            placeholder={t("edit.placeholder.hours")}
          />
        </Field>
      </FieldGrid>
      <p className="edit-muted-note">{t("edit.ratingsHint")}</p>
      </Disclosure>
    </section>
  );
}
