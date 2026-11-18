import { Skeleton } from "./ui/Skeleton";

/**
 * Content-region skeleton shown while a lazy page chunk downloads and parses.
 *
 * Rendered inside the layout's content area, below the top nav and sidebar: a
 * slow route must never replace the shell, because remounting it is both a
 * visual flash and a loss of focus/scroll context.
 */
export default function PageLoadingFallback() {
  return (
    <div className="page-fallback" aria-busy="true" role="status">
      <div className="page-fallback__header">
        <Skeleton width="260px" height="2.4em" />
        <Skeleton width="150px" height="1.3em" />
      </div>
      <div className="page-fallback__grid">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="page-fallback__tile">
            <Skeleton shape="rect" width="100%" height="130px" />
            <Skeleton width="82%" />
            <Skeleton width="58%" />
          </div>
        ))}
      </div>
    </div>
  );
}
