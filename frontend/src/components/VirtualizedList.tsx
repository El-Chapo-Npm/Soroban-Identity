import { useMemo, useRef, useEffect, useState } from "react";

/**
 * Virtual Scrolling List Component (#713)
 * 
 * Efficient list rendering for large datasets using windowing technique.
 * Only renders visible items, significantly improving performance.
 */

interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number | ((index: number, item: T) => number);
  renderItem: (item: T, index: number) => React.ReactNode;
  containerHeight: number;
  className?: string;
  onScroll?: (scrollTop: number) => void;
  overscan?: number;
  estimatedItemHeight?: number;
}

export function VirtualizedList<T>({
  items,
  itemHeight,
  renderItem,
  containerHeight,
  className = "",
  onScroll,
  overscan = 3,
  estimatedItemHeight = 80,
}: VirtualizedListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Calculate dynamic heights if itemHeight is a function
  const itemHeights = useMemo(() => {
    if (typeof itemHeight === "number") {
      return new Array(items.length).fill(itemHeight);
    }
    return items.map((item, index) => itemHeight(index, item));
  }, [items, itemHeight]);

  // Calculate cumulative offsets for each item
  const offsets = useMemo(() => {
    const result = [0];
    for (let i = 0; i < items.length - 1; i++) {
      result.push(result[i] + itemHeights[i]);
    }
    return result;
  }, [items.length, itemHeights]);

  const totalHeight = useMemo(() => {
    return offsets[items.length - 1] + (itemHeights[items.length - 1] || 0);
  }, [offsets, itemHeights, items.length]);

  // Find visible range
  const { startIndex, endIndex, offsetY } = useMemo(() => {
    let start = 0;
    let end = items.length;

    // Binary search for start index
    for (let i = 0; i < items.length; i++) {
      if (offsets[i] + itemHeights[i] > scrollTop - overscan * estimatedItemHeight) {
        start = Math.max(0, i - overscan);
        break;
      }
    }

    // Find end index
    for (let i = start; i < items.length; i++) {
      if (offsets[i] > scrollTop + containerHeight + overscan * estimatedItemHeight) {
        end = Math.min(items.length, i + overscan);
        break;
      }
    }

    const offsetY = offsets[start] || 0;
    return { startIndex: start, endIndex: end, offsetY };
  }, [scrollTop, items.length, offsets, itemHeights, containerHeight, overscan, estimatedItemHeight]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = (e.target as HTMLDivElement).scrollTop;
    setScrollTop(newScrollTop);
    onScroll?.(newScrollTop);
  };

  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        height: containerHeight,
        overflow: "auto",
        position: "relative",
      }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div
          style={{
            transform: `translateY(${offsetY}px)`,
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map((item, i) => {
            const actualIndex = startIndex + i;
            const height = itemHeights[actualIndex];
            return (
              <div key={actualIndex} style={{ height, overflow: "hidden" }}>
                {renderItem(item, actualIndex)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Scroll-to-top button component
 */
interface ScrollToTopButtonProps {
  scrollContainerId: string;
  threshold?: number;
}

export function ScrollToTopButton({ scrollContainerId, threshold = 300 }: ScrollToTopButtonProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const container = document.getElementById(scrollContainerId);
    if (!container) return;

    const handleScroll = () => {
      setIsVisible(container.scrollTop > threshold);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [scrollContainerId, threshold]);

  const handleClick = () => {
    const container = document.getElementById(scrollContainerId);
    if (container) {
      container.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (!isVisible) return null;

  return (
    <button
      onClick={handleClick}
      aria-label="Scroll to top"
      style={{
        position: "fixed",
        bottom: "2rem",
        right: "2rem",
        width: "2.5rem",
        height: "2.5rem",
        borderRadius: "50%",
        border: "none",
        background: "var(--accent-light)",
        color: "white",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
        zIndex: 100,
        fontSize: "1.2rem",
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      ↑
    </button>
  );
}

/**
 * Performance monitoring hook for virtualized lists
 */
export function useVirtualizationMetrics() {
  const metricsRef = useRef({
    renderCount: 0,
    lastMeasure: Date.now(),
    frameDrops: 0,
    avgFrameTime: 0,
  });

  const measurePerformance = (callback: () => void) => {
    const start = performance.now();
    const startTime = Date.now();

    requestAnimationFrame(() => {
      const frameTime = performance.now() - start;
      const metrics = metricsRef.current;

      metrics.renderCount++;
      metrics.avgFrameTime = (metrics.avgFrameTime * 0.9) + (frameTime * 0.1);

      if (frameTime > 16.67) {
        // 60fps threshold
        metrics.frameDrops++;
      }

      if (Date.now() - startTime > 1000) {
        console.log("Virtualization metrics:", {
          renderCount: metrics.renderCount,
          avgFrameTime: metrics.avgFrameTime.toFixed(2),
          frameDrops: metrics.frameDrops,
          fps: Math.round(1000 / metrics.avgFrameTime),
        });
      }

      callback();
    });
  };

  return { measurePerformance, metrics: metricsRef.current };
}

/**
 * Hook to manage and restore scroll position
 */
export function useScrollPosition(key: string) {
  const scrollPositions = useRef<Record<string, number>>({});

  const saveScrollPosition = (scrollTop: number) => {
    scrollPositions.current[key] = scrollTop;
    sessionStorage.setItem(`scroll-pos:${key}`, String(scrollTop));
  };

  const restoreScrollPosition = (): number => {
    const saved = sessionStorage.getItem(`scroll-pos:${key}`);
    return saved ? parseInt(saved, 10) : 0;
  };

  const clearScrollPosition = () => {
    delete scrollPositions.current[key];
    sessionStorage.removeItem(`scroll-pos:${key}`);
  };

  return { saveScrollPosition, restoreScrollPosition, clearScrollPosition };
}
