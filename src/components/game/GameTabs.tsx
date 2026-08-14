import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface GameTabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  count?: number | null;
}

export interface GameTabsProps<T extends string = string> {
  tabs: GameTabItem<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  className?: string;
}

export default function GameTabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  className,
}: GameTabsProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    width: number;
    opacity: number;
  }>({ left: 0, width: 0, opacity: 0 });

  // Update sliding indicator position
  useEffect(() => {
    const activeEl = tabRefs.current.get(activeTab);
    const container = containerRef.current;
    if (activeEl && container) {
      const containerRect = container.getBoundingClientRect();
      const elRect = activeEl.getBoundingClientRect();
      setIndicatorStyle({
        left: elRect.left - containerRect.left + container.scrollLeft,
        width: elRect.width,
        opacity: 1,
      });
    }
  }, [activeTab, tabs]);

  // Update indicator on window resize
  useEffect(() => {
    const handleResize = () => {
      const activeEl = tabRefs.current.get(activeTab);
      const container = containerRef.current;
      if (activeEl && container) {
        const containerRect = container.getBoundingClientRect();
        const elRect = activeEl.getBoundingClientRect();
        setIndicatorStyle({
          left: elRect.left - containerRect.left + container.scrollLeft,
          width: elRect.width,
          opacity: 1,
        });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeTab]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.findIndex((t) => t.id === activeTab);
    if (currentIndex === -1) return;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % tabs.length;
      const nextTab = tabs[nextIndex];
      onChange(nextTab.id);
      tabRefs.current.get(nextTab.id)?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      const prevTab = tabs[prevIndex];
      onChange(prevTab.id);
      tabRefs.current.get(prevTab.id)?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      const firstTab = tabs[0];
      onChange(firstTab.id);
      tabRefs.current.get(firstTab.id)?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const lastTab = tabs[tabs.length - 1];
      onChange(lastTab.id);
      tabRefs.current.get(lastTab.id)?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`game-tabs ${className || ""}`}
      role="tablist"
      aria-label="Game navigation tabs"
      onKeyDown={handleKeyDown}
    >
      {/* Animated sliding indicator */}
      <span
        className="game-tabs__indicator"
        style={{
          transform: `translateX(${indicatorStyle.left}px)`,
          width: `${indicatorStyle.width}px`,
          opacity: indicatorStyle.opacity,
        }}
        aria-hidden="true"
      />

      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.id, el);
              else tabRefs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`game-tab ${isActive ? "active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {Icon && <Icon size={15} className="game-tab-icon" />}
            <span className="game-tab-label">{tab.label}</span>
            {tab.count !== undefined && tab.count !== null && tab.count > 0 && (
              <span className="game-tab-count">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
