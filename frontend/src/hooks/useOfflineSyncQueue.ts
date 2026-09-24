import { useEffect, useState, useCallback } from 'react';
import { useServiceWorker } from './useServiceWorker';
import {
  getQueuedOperations,
  removeQueuedOperation,
  updateQueuedOperation,
  type QueuedWriteOperation,
} from '../utils/offlineStorage';

export function useOfflineSyncQueue() {
  const { isOnline } = useServiceWorker();
  const [queue, setQueue] = useState<QueuedWriteOperation[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const refreshQueue = useCallback(async () => {
    try {
      const ops = await getQueuedOperations();
      setQueue(ops);
    } catch (err) {
      console.error('Failed to load queued operations:', err);
    }
  }, []);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  const processQueue = useCallback(async () => {
    if (!isOnline || isProcessing) return;

    setIsProcessing(true);
    try {
      const ops = await getQueuedOperations();
      for (const op of ops) {
        if (op.status === 'processing') continue;

        try {
          op.status = 'processing';
          await updateQueuedOperation(op);

          // Attempt retry / sync
          // If transaction handler or background worker executes, or trigger custom sync
          console.log(`Processing queued offline operation ${op.id} of type ${op.type}`);

          // Custom event dispatch for listeners handling the specific write action
          window.dispatchEvent(
            new CustomEvent('soroban_execute_queued_write', {
              detail: op,
            })
          );

          // Once processed successfully, remove from queue
          await removeQueuedOperation(op.id);
        } catch (error: unknown) {
          op.retryCount += 1;
          op.status = op.retryCount > 5 ? 'failed' : 'pending';
          op.lastError = error instanceof Error ? error.message : 'Unknown sync error';
          await updateQueuedOperation(op);
        }
      }
    } finally {
      setIsProcessing(false);
      void refreshQueue();
    }
  }, [isOnline, isProcessing, refreshQueue]);

  // When connection returns, process the sync queue
  useEffect(() => {
    if (isOnline) {
      void processQueue();
    }
  }, [isOnline, processQueue]);

  return {
    queue,
    isProcessing,
    refreshQueue,
    processQueue,
  };
}
