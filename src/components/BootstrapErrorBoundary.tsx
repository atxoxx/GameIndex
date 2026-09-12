import { Component, type ErrorInfo, type ReactNode } from "react";

interface BootstrapErrorBoundaryProps {
  children: ReactNode;
}

interface BootstrapErrorBoundaryState {
  error: Error | null;
}

const panelStyles: Record<string, React.CSSProperties> = {
  wrap: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    background: "#08090c",
    color: "#f3f5fa",
    fontFamily:
      '"Outfit", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    overflow: "auto",
  },
  card: {
    maxWidth: 640,
    width: "100%",
    padding: "28px 32px",
    borderRadius: 14,
    background: "#12141c",
    border: "1px solid #262a38",
  },
  title: {
    margin: "0 0 8px",
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: "-0.01em",
  },
  message: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.5,
    color: "#9ea4b5",
    wordBreak: "break-word",
  },
  stack: {
    margin: "14px 0 0",
    padding: 12,
    borderRadius: 8,
    background: "#0b0d13",
    border: "1px solid #262a38",
    fontSize: 11.5,
    lineHeight: 1.55,
    color: "#a3abc0",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 280,
    overflow: "auto",
  },
  button: {
    marginTop: 18,
    padding: "9px 18px",
    borderRadius: 8,
    border: "none",
    background: "#635bff",
    color: "#ffffff",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
  },
};

/**
 * Renders a readable startup-failure panel instead of a blank window.
 * The App chunk may be exactly what failed to load, so no theme CSS is
 * guaranteed here — colors are inlined deliberately.
 */
export function BootstrapErrorPanel({ error }: { error: Error }) {
  return (
    <div style={panelStyles.wrap} role="alert">
      <div style={panelStyles.card}>
        <h2 style={panelStyles.title}>GameIndex failed to start</h2>
        <p style={panelStyles.message}>{error.message}</p>
        {error.stack && <pre style={panelStyles.stack}>{error.stack}</pre>}
        <button
          type="button"
          style={panelStyles.button}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

/**
 * Top-level error boundary mounted in `main.tsx` around the whole App.
 *
 * The provider tree in `App.tsx` has no boundary above it — MainContent's
 * ErrorBoundary only wraps the routed page subtree. An uncaught render or
 * lifecycle throw inside a provider (e.g. GameProvider on a first-run
 * profile) used to unmount the entire React tree, leaving an empty white
 * window — the classic "white screen on boot". This boundary turns that
 * into a visible error panel with the failing message.
 */
export class BootstrapErrorBoundary extends Component<
  BootstrapErrorBoundaryProps,
  BootstrapErrorBoundaryState
> {
  state: BootstrapErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BootstrapErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[BootstrapErrorBoundary] Fatal startup error:", error);
    if (info.componentStack) {
      // eslint-disable-next-line no-console
      console.error(
        "[BootstrapErrorBoundary] Component stack:",
        info.componentStack,
      );
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <BootstrapErrorPanel error={error} />;
  }
}