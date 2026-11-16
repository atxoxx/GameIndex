import type { SVGProps } from "react";
import type { PortLinkKind } from "../../types/port";

/**
 * Repository glyphs. lucide-react dropped brand marks, and the ports catalog
 * links straight at GitHub/GitLab, so the two paths live here instead of
 * pulling a whole brand-icon package for two shapes.
 */
export function GithubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden {...props}>
      <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.97 3.22 9.18 7.69 10.67.56.1.77-.24.77-.54 0-.27-.01-1.16-.02-2.1-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.94.1-.73.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.29-.5-1.44.11-3 0 0 .95-.3 3.1 1.16a10.7 10.7 0 0 1 5.64 0c2.15-1.46 3.1-1.16 3.1-1.16.61 1.56.23 2.71.11 3 .72.79 1.16 1.8 1.16 3.03 0 4.33-2.64 5.27-5.15 5.56.4.35.76 1.03.76 2.08 0 1.5-.01 2.71-.01 3.08 0 .3.2.65.78.54a11.25 11.25 0 0 0 7.68-10.67C23.25 5.48 18.27.5 12 .5Z" />
    </svg>
  );
}

export function GitlabMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden {...props}>
      <path d="m23.6 9.6-.03-.08L20.3 1.3a.85.85 0 0 0-.33-.4.88.88 0 0 0-1 .05.88.88 0 0 0-.29.43l-2.2 6.75H7.53L5.32 1.38a.86.86 0 0 0-.29-.43.88.88 0 0 0-1-.05.88.88 0 0 0-.33.4L.43 9.51l-.03.08a6.06 6.06 0 0 0 2.01 7l.02.01.03.03 4.97 3.72 2.46 1.86 1.5 1.13a1.02 1.02 0 0 0 1.23 0l1.5-1.13 2.46-1.86 5-3.74.01-.01a6.06 6.06 0 0 0 2.01-7Z" />
    </svg>
  );
}

export function RepoMark({ kind, ...props }: SVGProps<SVGSVGElement> & { kind: PortLinkKind }) {
  if (kind === "github") return <GithubMark {...props} />;
  if (kind === "gitlab") return <GitlabMark {...props} />;
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9h17M3.5 15h17M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </svg>
  );
}
