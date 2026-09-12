import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Brand identity — the "skin" of the app.
 *
 * A brand style is an axis that is completely orthogonal to the color
 * scheme (`data-theme`) and accent pick: it reshapes the UI's chrome and
 * layout (corners, shadows, shell treatment, density, tab styling) while
 * always consuming the theme's `var(--color-*)` tokens. That means every
 * brand style composes with every theme, light or dark, custom or
 * built-in, and with any accent color.
 *
 * The active style is applied to `<html>` as `data-ui-style`, which
 * `styles/brand-styles.css` reacts to. The stylesheet is intentionally
 * scoped behind `:not([data-bigscreen="true"])` so the 10-foot Big
 * Picture shell keeps its own dedicated styling.
 */

export type BrandStyleId = "classic" | "material" | "steam" | "glass" | "compact";

export interface BrandStyle {
  id: BrandStyleId;
  nameKey: string;
  descKey: string;
}

/** Well-known brand styles. "classic" is the baseline GameIndex signature. */
export const BRAND_STYLES: BrandStyle[] = [
  { id: "classic", nameKey: "settings.brandStyle.classic", descKey: "settings.brandStyle.classicDesc" },
  { id: "material", nameKey: "settings.brandStyle.material", descKey: "settings.brandStyle.materialDesc" },
  { id: "steam", nameKey: "settings.brandStyle.steam", descKey: "settings.brandStyle.steamDesc" },
  { id: "glass", nameKey: "settings.brandStyle.glass", descKey: "settings.brandStyle.glassDesc" },
  { id: "compact", nameKey: "settings.brandStyle.compact", descKey: "settings.brandStyle.compactDesc" },
];

export function isBrandStyleId(value: string): value is BrandStyleId {
  return BRAND_STYLES.some((s) => s.id === value);
}

const STORAGE_KEY = "gamelib-brand-style";
const STYLE_ATTR = "data-ui-style";

function applyBrandStyle(styleId: string) {
  document.documentElement.setAttribute(STYLE_ATTR, styleId);
}

function loadBrandStyle(): BrandStyleId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isBrandStyleId(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "classic";
}

// Persist the React context instance across Vite HMR module re-evaluations
// so lazy-loaded page chunks never lose their Provider instance.
const globalBrandObj = globalThis as unknown as {
  __gamelib_brand_style_context__?: React.Context<BrandStyleContextValue | null>;
};
const BrandStyleContext =
  globalBrandObj.__gamelib_brand_style_context__ ??
  (globalBrandObj.__gamelib_brand_style_context__ = createContext<BrandStyleContextValue | null>(null));

interface BrandStyleContextValue {
  /** Currently active brand style id. */
  currentStyle: BrandStyleId;
  /** Switch brand style by id. Persisted to localStorage. */
  setStyle: (styleId: BrandStyleId) => void;
  /** All available brand styles. */
  styles: BrandStyle[];
}

export function BrandStyleProvider({ children }: { children: ReactNode }) {
  const [currentStyle, setCurrentStyle] = useState<BrandStyleId>(loadBrandStyle);

  // Apply on mount and on change
  useEffect(() => {
    applyBrandStyle(currentStyle);
  }, [currentStyle]);

  const setStyle = useCallback((styleId: BrandStyleId) => {
    setCurrentStyle(styleId);
    try {
      localStorage.setItem(STORAGE_KEY, styleId);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<BrandStyleContextValue>(
    () => ({ currentStyle, setStyle, styles: BRAND_STYLES }),
    [currentStyle, setStyle]
  );

  return (
    <BrandStyleContext.Provider value={value}>{children}</BrandStyleContext.Provider>
  );
}

export function useBrandStyle(): BrandStyleContextValue {
  const ctx = useContext(BrandStyleContext);
  if (!ctx) {
    throw new Error("useBrandStyle must be used within a BrandStyleProvider");
  }
  return ctx;
}