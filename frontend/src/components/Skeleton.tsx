import type { CSSProperties } from "react";

interface Props {
  width?: string;
  height?: string;
  radius?: string;
  style?: CSSProperties;
}

export function Skeleton({ width = "100%", height = "1rem", radius = "6px", style }: Props) {
  return <div className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "1rem" }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}
