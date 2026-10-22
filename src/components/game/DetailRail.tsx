import {
  useCallback,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLanguage } from "../../context/LanguageContext";
import { usePageWidgetLayout, useSettings } from "../../context/SettingsContext";
import {
  WIDGET_CLASS,
  type InterfacePageKey,
  type PageWidgetKey,
} from "../../context/interfaceLayout";
import { PageWidgetSlot } from "../PageWidget";
import {
  SIMPLE_UI_HIDDEN_WIDGETS,
  type DetailRailGroupDef,
} from "./detailRailGroups";

const OPEN_STATE_PREFIX = "gamelib.detail_rail";

function storageKey(page: InterfacePageKey, groupId: string): string {
  return `${OPEN_STATE_PREFIX}.${page}.${groupId}`;
}

function readOpen(
  page: InterfacePageKey,
  group: DetailRailGroupDef,
): boolean {
  try {
    const raw = localStorage.getItem(storageKey(page, group.id));
    if (raw === "open") return true;
    if (raw === "closed") return false;
  } catch {
    /* localStorage unavailable — fall through to the shipped default */
  }
  return group.defaultOpen;
}

function writeOpen(
  page: InterfacePageKey,
  groupId: string,
  open: boolean,
) {
  try {
    localStorage.setItem(storageKey(page, groupId), open ? "open" : "closed");
  } catch {
    /* a blocked write only costs us the preference */
  }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`rail-group__chevron${open ? " rail-group__chevron--open" : ""}`}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

interface RailGroupProps {
  page: InterfacePageKey;
  group: DetailRailGroupDef;
  items: { key: PageWidgetKey; node: ReactNode }[];
  order: number;
}

function RailGroup({ page, group, items, order }: RailGroupProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(() => readOpen(page, group));
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  const Icon = group.icon;

  const toggle = useCallback(() => {
    setOpen((previous) => {
      const next = !previous;
      writeOpen(page, group.id, next);
      return next;
    });
  }, [page, group.id]);

  const style: CSSProperties = { order };

  return (
    <section
      className="rail-group"
      style={style}
      data-group={group.id}
      data-open={open ? "true" : "false"}
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="rail-group__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <span className="rail-group__icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <span className="rail-group__title" id={titleId}>
          {t(group.labelKey)}
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="rail-group__body" id={bodyId}>
          {items.map(({ key, node }) => (
            <PageWidgetSlot
              key={key}
              page={page}
              widget={key}
              className={`rail-group__item ${WIDGET_CLASS[key]}`}
            >
              {node}
            </PageWidgetSlot>
          ))}
        </div>
      )}
    </section>
  );
}

export interface DetailRailProps {
  page: InterfacePageKey;
  groups: DetailRailGroupDef[];
  /**
   * Builds the card for a widget, or returns `null` when this game can't offer
   * it (no Steam app id for DLC, saves disabled, …). The rail skips null cards
   * so a panel never renders a header over empty space.
   */
  renderWidget: (widget: PageWidgetKey) => ReactNode;
}

/**
 * DetailRail
 * ──────────
 * The grouped side column shared by the Library game page and the Store
 * detail page. Card visibility still comes from the Layout Studio; this
 * component only decides which panel each card belongs to and where the panel
 * sits, using the earliest stored index among its visible cards.
 */
export default function DetailRail({
  page,
  groups,
  renderWidget,
}: DetailRailProps) {
  const { isSimpleUi } = useSettings();
  const { isVisible, orderOf } = usePageWidgetLayout(page);

  const panels = groups
    .map((group) => {
      const items: { key: PageWidgetKey; node: ReactNode }[] = [];
      for (const widget of group.widgets) {
        if (!isVisible(widget)) continue;
        if (isSimpleUi && SIMPLE_UI_HIDDEN_WIDGETS.has(widget)) continue;
        const node = renderWidget(widget);
        if (node === null || node === undefined || node === false) continue;
        items.push({ key: widget, node });
      }
      const order =
        items.length > 0
          ? Math.min(...items.map((item) => orderOf(item.key)))
          : Number.MAX_SAFE_INTEGER;
      return { group, items, order };
    })
    .filter((panel) => panel.items.length > 0);

  if (panels.length === 0) return null;

  return (
    <div className="game-side-col game-rail">
      {panels.map((panel) => (
        <RailGroup
          key={panel.group.id}
          page={page}
          group={panel.group}
          items={panel.items}
          order={panel.order}
        />
      ))}
    </div>
  );
}
