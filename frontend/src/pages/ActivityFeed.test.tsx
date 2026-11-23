import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActivityFeed from './ActivityFeed';

const loadMore = vi.fn();

vi.mock('../hooks/useContractEvents', () => ({
  useContractEvents: () => ({
    events: [],
    loading: false,
    error: null,
    hasMore: true,
    loadMore,
  }),
}));

vi.mock('../components/CredentialTimeline', () => ({
  default: () => <div data-testid="credential-timeline" />,
}));

describe('ActivityFeed infinite scroll', () => {
  let observerCallback: IntersectionObserverCallback;

  beforeEach(() => {
    loadMore.mockReset();
    loadMore.mockResolvedValue(null);
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = '200px';
      thresholds = [0];
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  });

  it('loads the next page when the sentinel enters the viewport', async () => {
    render(<ActivityFeed />);

    await act(async () => {
      observerCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));
  });

  it('does not issue duplicate requests while a page is loading', async () => {
    let resolveLoadMore!: () => void;
    loadMore.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveLoadMore = resolve;
    }));
    render(<ActivityFeed />);

    await act(async () => {
      observerCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      observerCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(loadMore).toHaveBeenCalledTimes(1);
    await act(async () => resolveLoadMore());
  });
});
