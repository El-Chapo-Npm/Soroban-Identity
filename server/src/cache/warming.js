export async function warmCacheOnStartup({
  entries,
  concurrency = 4,
  logger = console,
} = {}) {
  const startedAt = Date.now();
  const safeEntries = Array.isArray(entries) ? entries : [];

  if (safeEntries.length === 0) {
    const completedAt = Date.now();
    const stats = {
      warmed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      startedAt,
      completedAt,
    };
    logger.info?.({ stats }, 'Cache warmup skipped: no entries');
    return stats;
  }

  const queue = [...safeEntries];
  const stats = {
    warmed: 0,
    failed: 0,
    skipped: 0,
    total: queue.length,
    startedAt,
    completedAt: startedAt,
  };

  const worker = async (entry) => {
    try {
      const value = await entry.load();
      if (value == null) {
        stats.skipped += 1;
        return;
      }
      stats.warmed += 1;
    } catch (error) {
      stats.failed += 1;
      logger.warn?.({ error, key: entry.key, metadata: entry.metadata }, 'Cache warmup failed');
    }
  };

  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), queue.length || 1) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) continue;
      await worker(next);
    }
  });

  await Promise.allSettled(workers);
  stats.completedAt = Date.now();

  logger.info?.(
    {
      warmed: stats.warmed,
      failed: stats.failed,
      skipped: stats.skipped,
      total: stats.total,
      durationMs: stats.completedAt - stats.startedAt,
    },
    'Cache warmup complete',
  );

  return stats;
}

export async function warmPopularDids({ dids = [], resolver, logger = console, concurrency = 4 }) {
  return warmCacheOnStartup({
    entries: dids.map((did) => ({
      key: did,
      load: () => resolver(did),
      metadata: { type: 'did' },
    })),
    concurrency,
    logger,
  });
}

export default warmCacheOnStartup;
