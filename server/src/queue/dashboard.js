export async function createQueueDashboard(queues, { basePath = '/admin/queues' } = {}) {
  const [{ createBullBoard }, { BullAdapter }] = await Promise.all([
    import('@bull-board/api'),
    import('@bull-board/api/bullAdapter'),
  ]);
  const bullQueues = Object.values(queues).map(({ queue }) => new BullAdapter(queue));
  const board = createBullBoard({ queues: bullQueues, options: { uiConfig: { boardTitle: 'Soroban Identity Jobs' } } });
  return { basePath, router: board.router };
}
