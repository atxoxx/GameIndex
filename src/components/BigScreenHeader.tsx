import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import appIconUrl from "../assets/gameindex-icon.png";
import { useLanguage } from "../context/LanguageContext";
import { useGamepad } from "../hooks/GamepadProvider";
import { useFocusable } from "../hooks/useFocusable";
import { useBigScreen } from "../hooks/useBigScreen";

interface BigScreenHeaderProps {
  onOpenSearch?: () => void;
}

interface BigScreenSection {
  path: string;
  labelKey: string;
  icon: ReactNode;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const sections: BigScreenSection[] = [
  {
    path: "/activity",
    labelKey: "nav.home",
    icon: <Icon><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></Icon>,
  },
  {
    path: "/library",
    labelKey: "nav.library",
    icon: <Icon><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 18v3" /></Icon>,
  },
  {
    path: "/store",
    labelKey: "nav.store",
    icon: <Icon><path d="M4 8h16l-1 12H5L4 8Z" /><path d="m7 8 2-5h6l2 5" /><path d="M9 12h6" /></Icon>,
  },
  {
    path: "/wishlist",
    labelKey: "nav.wishlist",
    icon: <Icon><path d="M20.8 8.8c0 5.4-8.8 10.2-8.8 10.2S3.2 14.2 3.2 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z" /></Icon>,
  },
  {
    path: "/deals",
    labelKey: "nav.deals",
    icon: <Icon><path d="M20 12a2 2 0 0 0 0-4h-1a2 2 0 0 1-2-2V5a2 2 0 0 0-4 0 2 2 0 0 1-4 0 2 2 0 0 0-4 0v1a2 2 0 0 1-2 2 2 2 0 0 0 0 4 2 2 0 0 1 2 2v1a2 2 0 0 0 4 0 2 2 0 0 1 4 0 2 2 0 0 0 4 0v-1a2 2 0 0 1 2-2Z" /><path d="m9 15 6-6" /><path d="M9 9h.01M15 15h.01" /></Icon>,
  },
  {
    path: "/friends",
    labelKey: "nav.friends",
    icon: <Icon><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5a3 3 0 0 1 0 6" /><path d="M18 14a5 5 0 0 1 3 6" /></Icon>,
  },
  {
    path: "/news",
    labelKey: "nav.news",
    icon: <Icon><path d="M5 4h14a2 2 0 0 1 2 2v14H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M7 8h10M7 12h10M7 16h6" /></Icon>,
  },
  {
    path: "/achievements",
    labelKey: "nav.achievements",
    icon: <Icon><circle cx="12" cy="8" r="5" /><path d="m8.5 12.5-1 8 4.5-2.5 4.5 2.5-1-8" /></Icon>,
  },
  {
    path: "/downloads",
    labelKey: "nav.downloads",
    icon: <Icon><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></Icon>,
  },
  {
    path: "/storage",
    labelKey: "nav.storage",
    icon: <Icon><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></Icon>,
  },
  {
    path: "/community",
    labelKey: "nav.stats",
    icon: <Icon><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></Icon>,
  },
  {
    path: "/emulators",
    labelKey: "nav.emulators",
    icon: <Icon><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M8 12h4M10 10v4M16 11h.01M18 13h.01" /></Icon>,
  },
  {
    path: "/mods",
    labelKey: "nav.mods",
    icon: <Icon><path d="M8 5h8l2 4v10H6V9l2-4Z" /><path d="M9 5v4h6V5" /><path d="M9 13h6M9 16h4" /></Icon>,
  },
  {
    path: "/docs",
    labelKey: "nav.docs",
    icon: <Icon><path d="M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v4h4M8 11h8M8 15h8" /></Icon>,
  },
  {
    path: "/settings",
    labelKey: "nav.settings",
    icon: <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-2.8-2.8.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.6 1Z" /></Icon>,
  },
];

export function getActiveTabPath(pathname: string): string {
  return sections.find((section) => pathname.startsWith(section.path))?.path ?? "/activity";
}

function SectionButton({
  section,
  active,
  onActivate,
}: {
  section: BigScreenSection;
  active: boolean;
  onActivate: () => void;
}) {
  const { t } = useLanguage();
  const focusable = useFocusable(onActivate);
  const label = t(section.labelKey);

  return (
    <NavLink
      to={section.path}
      {...focusable}
      className={`bigscreen-v2-section${active ? " is-active" : ""}`}
      aria-label={label}
      aria-current={active ? "page" : undefined}
    >
      <span className="bigscreen-v2-section-icon">{section.icon}</span>
      <span className="bigscreen-v2-section-label">{label}</span>
    </NavLink>
  );
}

export default function BigScreenHeader({ onOpenSearch }: BigScreenHeaderProps) {
  const { t } = useLanguage();
  const { connected, virtualMouse, toggleVirtualMouse, registerTabCycler } = useGamepad();
  const { setBigScreen } = useBigScreen();
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const [time, setTime] = useState("");

  const activePath = getActiveTabPath(location.pathname);
  const activeIndex = useMemo(
    () => Math.max(0, sections.findIndex((section) => section.path === activePath)),
    [activePath],
  );

  useEffect(() => {
    const update = () => {
      setTime(new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date()));
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>(".is-active");
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activePath]);

  useEffect(() => {
    return registerTabCycler((direction) => {
      const next = direction === "forward"
        ? (activeIndex + 1) % sections.length
        : (activeIndex - 1 + sections.length) % sections.length;
      navigate(sections[next].path);
    }, -10);
  }, [activeIndex, navigate, registerTabCycler]);

  const searchProps = useFocusable(() => onOpenSearch?.());
  const pointerProps = useFocusable(toggleVirtualMouse);
  const exitProps = useFocusable(() => setBigScreen(false));

  return (
    <header className="bigscreen-v2-header">
      <div className="bigscreen-v2-brand" aria-label="GameIndex Big Screen">
        <span className="bigscreen-v2-brand-mark">
          <img src={appIconUrl} alt="" aria-hidden="true" />
        </span>
        <span className="bigscreen-v2-brand-copy">
          <strong>GAMEINDEX</strong>
          <small>BIG SCREEN</small>
        </span>
      </div>

      <nav ref={navRef} className="bigscreen-v2-sections" aria-label={t("bigscreen.mainSections")}>
        {sections.map((section) => (
          <SectionButton
            key={section.path}
            section={section}
            active={section.path === activePath}
            onActivate={() => navigate(section.path)}
          />
        ))}
      </nav>

      <div className="bigscreen-v2-utilities">
        <div className={`bigscreen-v2-connection${connected ? " is-connected" : ""}`} title={connected ? "Controller connected" : "Controller disconnected"}>
          <span className="bigscreen-v2-connection-dot" />
          <span>{connected ? "READY" : "NO PAD"}</span>
        </div>

        <button type="button" className={`bigscreen-v2-utility${virtualMouse.visible ? " is-active" : ""}`} {...pointerProps} aria-pressed={virtualMouse.visible} aria-label="Toggle virtual mouse">
          <Icon><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></Icon>
          <span>{virtualMouse.visible ? "POINTER" : "FOCUS"}</span>
        </button>
        <button type="button" className="bigscreen-v2-utility" {...searchProps} aria-label={t("bigscreen.search")}>
          <Icon><circle cx="11" cy="11" r="6" /><path d="m16 16 5 5" /></Icon>
          <span>SEARCH</span>
        </button>
        <span className="bigscreen-v2-clock">{time}</span>
        <button type="button" className="bigscreen-v2-exit" {...exitProps} aria-label={t("bigscreen.exitBigScreen")}>
          <Icon><path d="M9 6H5v12h4" /><path d="m13 8 4 4-4 4" /><path d="M17 12H9" /></Icon>
        </button>
      </div>
    </header>
  );
}
