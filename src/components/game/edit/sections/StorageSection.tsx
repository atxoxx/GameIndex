import { Button } from "../../../ui";
import { formatCost, formatSize } from "../../../../types/game";
import { Field, FieldGrid, SectionHeader } from "../EditFields";
import { useEditGame } from "../EditGameContext";
import { COST_CURRENCIES } from "../editConstants";

export function StorageSection() {
  const {
    t,
    sizeUnit,
    editSizeBytes,
    editSizeRootPath,
    detectingSize,
    openFolderAndDetectSize,
    clearSize,
    editPlaytimeHours,
    setEditPlaytimeHours,
    editPlaytimeMinutes,
    setEditPlaytimeMinutes,
    resetPlaytimeEdits,
    editCost,
    setEditCost,
    editCurrency,
    setEditCurrency,
    prefillingCost,
    handlePrefillCost,
    costSource,
    setCostSource,
    editCostPerHour,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-storage">
      <SectionHeader
        id="edit-section-storage"
        title={t("edit.section.storage")}
        description={t("edit.section.storageDesc")}
        changed={dirtyBySection.storage}
        onReset={() => resetSection("storage")}
      />

      <Field label={t("edit.label.size")} htmlFor="edit-size" className="edit-field--full">
        <div className="edit-inline-row">
          <input
            id="edit-size"
            className="edit-input edit-input--readonly"
            type="text"
            readOnly
            value={
              editSizeBytes != null ? formatSize(editSizeBytes, sizeUnit) : t("edit.notSet")
            }
            placeholder={t("edit.notSet")}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={openFolderAndDetectSize}
            disabled={detectingSize}
            isLoading={detectingSize}
          >
            {detectingSize ? t("community.detecting") : t("edit.autoDetect")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSize}
            disabled={editSizeBytes == null}
          >
            {t("common.clear")}
          </Button>
        </div>
        {editSizeRootPath && (
          <span className="edit-field-hint edit-path-hint" title={editSizeRootPath}>
            {t("edit.folderPath", { path: editSizeRootPath })}
          </span>
        )}
      </Field>

      <FieldGrid columns={3}>
        <Field label={t("edit.playtime.hours")} htmlFor="edit-playtime-hours">
          <input
            id="edit-playtime-hours"
            className="edit-input"
            type="number"
            min={0}
            step={1}
            value={editPlaytimeHours || ""}
            onChange={(event) =>
              setEditPlaytimeHours(Math.max(0, Math.floor(Number(event.target.value) || 0)))
            }
            placeholder="0"
          />
        </Field>
        <Field label={t("edit.playtime.minutes")} htmlFor="edit-playtime-minutes">
          <input
            id="edit-playtime-minutes"
            className="edit-input"
            type="number"
            min={0}
            max={59}
            step={1}
            value={editPlaytimeMinutes || ""}
            onChange={(event) =>
              setEditPlaytimeMinutes(
                Math.max(0, Math.min(59, Math.floor(Number(event.target.value) || 0))),
              )
            }
            placeholder="0"
          />
        </Field>
        <div className="edit-field edit-field--align-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={resetPlaytimeEdits}
            disabled={editPlaytimeHours === 0 && editPlaytimeMinutes === 0}
            title={t("edit.playtime.resetTitle")}
          >
            {t("common.reset")}
          </Button>
        </div>
      </FieldGrid>
      <p className="edit-muted-note">{t("edit.playtime.hint")}</p>

      <div className="edit-fieldset-card">
        <div className="edit-fieldset-card-head">
          <div>
            <h3 className="edit-subheading">{t("edit.label.purchaseCost")}</h3>
            <p className="edit-muted-note">{t("edit.section.valueDesc")}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePrefillCost}
            disabled={prefillingCost}
            isLoading={prefillingCost}
          >
            {t("edit.cost.prefill")}
          </Button>
        </div>

        <div className="edit-cost-row">
          <input
            id="edit-purchase-cost"
            className="edit-input edit-cost-amount"
            type="number"
            min={0}
            step={0.01}
            value={editCost}
            onChange={(event) => {
              setEditCost(event.target.value);
              if (costSource === "auto") setCostSource(null);
            }}
            placeholder="0.00"
            aria-label={t("edit.label.purchaseCost")}
          />
          <select
            id="edit-purchase-currency"
            className="edit-input edit-cost-currency"
            value={editCurrency}
            onChange={(event) => setEditCurrency(event.target.value)}
            aria-label={t("edit.label.purchaseCurrency")}
          >
            {COST_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
          {editCostPerHour != null && (
            <span className="edit-cost-per-hour">
              {t("edit.costPerHourPreview", {
                value: formatCost(editCostPerHour, editCurrency),
              })}
            </span>
          )}
        </div>
        <p className="edit-muted-note">
          {costSource === "auto" ? t("edit.cost.autoHint") : t("edit.cost.hint")}
        </p>
      </div>
    </section>
  );
}
