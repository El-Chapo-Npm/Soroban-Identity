import { useEffect } from 'react';

export interface OpenGraphMeta {
  title: string;
  description: string;
  url?: string;
}

function setMeta(attr: 'property' | 'name', key: string, content: string): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  const created = !el;
  const previous = el?.getAttribute('content') ?? null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return () => {
    if (created) el!.remove();
    else if (previous !== null) el!.setAttribute('content', previous);
  };
}

/**
 * Set Open Graph and Twitter Card tags for the current view, and restore the
 * previous values on unmount.
 *
 * Crawlers that don't run JavaScript (most social platforms) only see the
 * static tags in `index.html`. This hook updates the tags for crawlers that do
 * render JS, and for in-app link previews. Per-credential previews for every
 * platform need these tags rendered server-side or at the edge.
 */
export function useOpenGraphMeta(meta: OpenGraphMeta | null): void {
  useEffect(() => {
    if (!meta) return;
    const previousTitle = document.title;
    document.title = meta.title;
    const restore = [
      setMeta('property', 'og:title', meta.title),
      setMeta('property', 'og:description', meta.description),
      setMeta('name', 'twitter:title', meta.title),
      setMeta('name', 'twitter:description', meta.description),
      ...(meta.url ? [setMeta('property', 'og:url', meta.url)] : []),
    ];
    return () => {
      document.title = previousTitle;
      restore.forEach((fn) => fn());
    };
  }, [meta?.title, meta?.description, meta?.url]);
}
