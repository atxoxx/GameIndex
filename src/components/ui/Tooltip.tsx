import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** The element that triggers the tooltip on hover/focus. */
  children: ReactNode;
  /** Tooltip content. */
  content: ReactNode;
  /** Preferred placement (flips top↔bottom if no room). */
  placement?: TooltipPlacement;
  /** Delay before showing, in ms. */
  delay?: number;
  /** Max width for the tooltip bubble. */
  maxWidth?: number;
}

const TOOLTIP_ID = "ui-tooltip-active";

export function Tooltip({
  children,
  content,
  placement = "top",
  delay = 400,
  maxWidth = 240,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [flipped, setFlipped] = useState<TooltipPlacement>(placement);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clean up pending timer on unmount
  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  // Measure the bubble and clamp it into the viewport on every show/resize.
  useLayoutEffect(() => {
    if (!visible) return;
    const tip = tipRef.current;
    const trigger = triggerRef.current;
    if (!tip || !trigger) return;

    const bubble = tip.getBoundingClientRect();
    const rect = trigger.getBoundingClientRect();
    const margin = 8;

    let place: TooltipPlacement = placement;
    if (placement === "top" && rect.top < bubble.height + margin + 8) place = "bottom";
    if (placement === "bottom" && window.innerHeight - rect.bottom < bubble.height + margin + 8) {
      place = "top";
    }
    if (placement === "left" && rect.left < bubble.width + margin) place = "right";
    if (placement === "right" && window.innerWidth - rect.right < bubble.width + margin) {
      place = "left";
    }

    let x = rect.left + rect.width / 2;
    let y = rect.top - margin;

    if (place === "top" || place === "bottom") {
      const half = bubble.width / 2;
      x = Math.min(Math.max(x, margin + half), window.innerWidth - margin - half);
      y = place === "top" ? rect.top - margin : rect.bottom + margin;
    } else if (place === "left") {
      x = rect.left - margin;
      y = rect.top + rect.height / 2;
    } else {
      x = rect.right + margin;
      y = rect.top + rect.height / 2;
    }

    if (place === "top") y = Math.max(y, bubble.height + margin);
    if (place === "bottom") y = Math.min(y, window.innerHeight - margin - bubble.height);

    setFlipped(place);
    setPos({ x, y });
  }, [visible, placement, content, maxWidth]);

  const tooltip = visible ? (
    <div
      ref={tipRef}
      className={`ui-tooltip ui-tooltip--${flipped}`}
      style={{
        left: pos.x,
        top: pos.y,
        maxWidth,
      }}
      role="tooltip"
      id={TOOLTIP_ID}
    >
      <div className="ui-tooltip__arrow" />
      <div className="ui-tooltip__content">{content}</div>
    </div>
  ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className="ui-tooltip__trigger"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={visible ? TOOLTIP_ID : undefined}
      >
        {children}
      </span>
      {createPortal(tooltip, document.body)}
    </>
  );
}
