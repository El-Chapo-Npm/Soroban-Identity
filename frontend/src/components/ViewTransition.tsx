import React, { useEffect, useState } from "react";
import "../styles/transitions.css";

export interface ViewTransitionProps {
  viewKey: string;
  children: React.ReactNode;
  className?: string;
}

export default function ViewTransition({
  viewKey,
  children,
  className = "",
}: ViewTransitionProps) {
  const [currentKey, setCurrentKey] = useState(viewKey);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, []);

  useEffect(() => {
    if (viewKey !== currentKey) {
      if (prefersReducedMotion) {
        setCurrentKey(viewKey);
      } else {
        setIsTransitioning(true);
        const timeout = setTimeout(() => {
          setCurrentKey(viewKey);
          setIsTransitioning(false);
        }, 120);
        return () => clearTimeout(timeout);
      }
    }
  }, [viewKey, currentKey, prefersReducedMotion]);

  return (
    <div
      className={`view-transition-container ${
        isTransitioning ? "view-transition-exit" : "view-transition-enter"
      } ${className}`}
      data-view-key={currentKey}
      data-testid="view-transition-wrapper"
    >
      {children}
    </div>
  );
}
