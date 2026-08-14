import { Skeleton } from "../ui/Skeleton";

interface DealsSkeletonGridProps {
  density: string;
  count?: number;
  variant?: "gamepass" | "deal" | "giveaway";
}

export default function DealsSkeletonGrid({
  density,
  count = 12,
  variant = "deal",
}: DealsSkeletonGridProps) {
  const aspectRatio =
    variant === "gamepass" ? "3 / 4" : variant === "deal" ? "16 / 9" : "16 / 9";

  return (
    <div className={`deals-grid density-${density}`}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="deals-skeleton-card"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div
            className="deals-skeleton-card-image"
            style={{ aspectRatio }}
          >
            <Skeleton shape="rect" width="100%" height="100%" />
          </div>
          <div className="deals-skeleton-card-body">
            <Skeleton shape="text" width="80%" height="1em" />
            <Skeleton shape="text" width="55%" height="0.85em" />
            {variant === "deal" && (
              <div className="deals-skeleton-card-row">
                <Skeleton shape="text" width="60px" height="1.2em" />
                <Skeleton shape="text" width="40%" height="0.75em" />
              </div>
            )}
            {variant === "gamepass" && (
              <>
                <Skeleton shape="text" width="100%" height="0.75em" />
                <div className="deals-skeleton-card-tags">
                  <Skeleton shape="rect" width="48px" height="18px" />
                  <Skeleton shape="rect" width="36px" height="18px" />
                  <Skeleton shape="rect" width="56px" height="18px" />
                </div>
              </>
            )}
            {variant === "giveaway" && (
              <div className="deals-skeleton-card-row">
                <Skeleton shape="text" width="70px" height="0.85em" />
                <Skeleton shape="text" width="80px" height="0.75em" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
