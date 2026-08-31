import { logger } from './logger.js';
import { encodeCommand } from './redis-client.js';

/**
 * Job queue for asynchronous credential processing.
 * Supports job prioritization, retries with exponential backoff, and status tracking.
 * Built on Redis for reliability and scalability.
 */
export class JobQueue {
  constructor(redisClient, name = 'default', options = {}) {
    this.redisClient = redisClient;
    this.name = name;
    this.prefix = options.prefix ?? `queue:${name}`;
    
    // Job configuration
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 1000;
    this.retryBackoffMultiplier = options.retryBackoffMultiplier ?? 2; // exponential backoff
    this.processingTimeoutMs = options.processingTimeoutMs ?? 30000;
    
    // Job priorities (higher number = higher priority)
    this.priorityLevels = options.priorityLevels ?? {
      low: 0,
      normal: 1,
      high: 2,
      urgent: 3,
    };
    
    this.metrics = options.metrics ?? null;
    this.logger = options.logger ?? logger;
    
    this.jobHandlers = new Map();
    this.processingJobs = new Map();
    this.isProcessing = false;
  }

  /**
   * Add a job to the queue.
   */
  async addJob(jobType, data, options = {}) {
    if (!await this.redisClient.ping()) {
      throw new Error('Redis connection unavailable');
    }

    const jobId = options.jobId ?? `${jobType}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    const priority = this.priorityLevels[options.priority] ?? this.priorityLevels.normal;
    const delayMs = options.delayMs ?? 0;

    const job = {
      id: jobId,
      type: jobType,
      data,
      priority,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.maxRetries + 1,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scheduledAt: Date.now() + delayMs,
    };

    try {
      // Store job data
      await this.redisClient.command('SET', [
        `${this.prefix}:job:${jobId}`,
        JSON.stringify(job),
        'EX',
        '86400', // 24 hour expiry
      ]);

      // Add to priority queue (sorted by priority, then by scheduled time)
      const score = (4 - priority) * 1e10 + job.scheduledAt;
      await this.redisClient.command('ZADD', [
        `${this.prefix}:pending`,
        score,
        jobId,
      ]);

      this.logger.info({ jobId, jobType, priority }, 'Job added to queue');

      if (this.metrics?.observeJobQueued) {
        this.metrics.observeJobQueued({ type: jobType, priority });
      }

      return jobId;
    } catch (error) {
      this.logger.error({ jobId, jobType, error: error.message }, 'Failed to add job');
      throw error;
    }
  }

  /**
   * Register a handler for a job type.
   */
  onJob(jobType, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    this.jobHandlers.set(jobType, handler);
    this.logger.info({ jobType }, 'Job handler registered');
  }

  /**
   * Start processing jobs from the queue.
   */
  async startProcessing(concurrency = 1) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    this.logger.info({ queue: this.name, concurrency }, 'Starting job processor');

    for (let i = 0; i < concurrency; i++) {
      this._processJobsLoop().catch((error) => {
        this.logger.error({ error: error.message }, 'Job processor error');
      });
    }
  }

  /**
   * Main job processing loop.
   */
  async _processJobsLoop() {
    while (this.isProcessing) {
      try {
        const jobId = await this._getNextJob();
        if (!jobId) {
          // No jobs available, wait a bit before checking again
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        await this._processJob(jobId);
      } catch (error) {
        this.logger.error({ error: error.message }, 'Error in job processing loop');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Get next job from queue (respecting priority and delay).
   */
  async _getNextJob() {
    if (!await this.redisClient.ping()) {
      return null;
    }

    const now = Date.now();
    // Get job with lowest score (highest priority, earliest scheduled time)
    const result = await this.redisClient.command('ZRANGE', [
      `${this.prefix}:pending`,
      0,
      0,
      'WITHSCORES',
    ]);

    if (!result || result.length === 0) return null;

    const [jobId, score] = result;
    const scheduledAt = Math.floor(score % 1e10);

    // Check if job is scheduled to run now
    if (scheduledAt <= now) {
      // Move from pending to processing
      await this.redisClient.command('ZREM', [`${this.prefix}:pending`, jobId]);
      await this.redisClient.command('ZADD', [
        `${this.prefix}:processing`,
        now,
        jobId,
      ]);
      return jobId;
    }

    return null;
  }

  /**
   * Process a single job.
   */
  async _processJob(jobId) {
    const jobKey = `${this.prefix}:job:${jobId}`;

    try {
      const jobData = await this.redisClient.command('GET', [jobKey]);
      if (!jobData) {
        this.logger.warn({ jobId }, 'Job data not found');
        return;
      }

      const job = JSON.parse(jobData);
      const handler = this.jobHandlers.get(job.type);

      if (!handler) {
        this.logger.warn({ jobId, jobType: job.type }, 'No handler for job type');
        await this._moveJobTo(jobId, 'failed', { error: 'No handler registered' });
        return;
      }

      job.status = 'processing';
      job.updatedAt = Date.now();
      job.attempts++;

      await this.redisClient.command('SET', [jobKey, JSON.stringify(job)]);

      // Process with timeout
      const result = await Promise.race([
        handler(job.data),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Job processing timeout')), this.processingTimeoutMs)
        ),
      ]);

      job.status = 'completed';
      job.result = result;
      job.completedAt = Date.now();
      job.updatedAt = Date.now();

      await this.redisClient.command('SET', [jobKey, JSON.stringify(job)]);
      await this.redisClient.command('ZREM', [`${this.prefix}:processing`, jobId]);
      await this.redisClient.command('ZADD', [
        `${this.prefix}:completed`,
        job.completedAt,
        jobId,
      ]);

      this.logger.info({ jobId, jobType: job.type, duration: job.completedAt - job.updatedAt }, 'Job completed');

      if (this.metrics?.observeJobCompleted) {
        this.metrics.observeJobCompleted({ type: job.type, durationMs: job.completedAt - job.updatedAt });
      }
    } catch (error) {
      const jobData = await this.redisClient.command('GET', [jobKey]);
      if (jobData) {
        const job = JSON.parse(jobData);
        
        if (job.attempts < job.maxAttempts) {
          // Retry with exponential backoff
          const backoffMs = this.retryBackoffMs * Math.pow(this.retryBackoffMultiplier, job.attempts - 1);
          const retryScore = (4 - job.priority) * 1e10 + Date.now() + backoffMs;

          job.status = 'delayed';
          job.lastError = error.message;
          job.updatedAt = Date.now();

          await this.redisClient.command('SET', [jobKey, JSON.stringify(job)]);
          await this.redisClient.command('ZREM', [`${this.prefix}:processing`, jobId]);
          await this.redisClient.command('ZADD', [`${this.prefix}:pending`, retryScore, jobId]);

          this.logger.info({
            jobId,
            attempt: job.attempts,
            maxAttempts: job.maxAttempts,
            backoffMs,
            error: error.message,
          }, 'Job retry scheduled');

          if (this.metrics?.observeJobRetry) {
            this.metrics.observeJobRetry({ type: job.type, attempt: job.attempts, maxAttempts: job.maxAttempts });
          }
        } else {
          // Max retries exceeded
          await this._moveJobTo(jobId, 'failed', { error: error.message });

          this.logger.error({
            jobId,
            jobType: job.type,
            attempts: job.attempts,
            error: error.message,
          }, 'Job failed after max retries');

          if (this.metrics?.observeJobFailed) {
            this.metrics.observeJobFailed({ type: job.type, attempts: job.attempts });
          }
        }
      }
    }
  }

  /**
   * Move a job to a different status.
   */
  async _moveJobTo(jobId, status, additionalData = {}) {
    const jobKey = `${this.prefix}:job:${jobId}`;
    const jobData = await this.redisClient.command('GET', [jobKey]);

    if (jobData) {
      const job = JSON.parse(jobData);
      job.status = status;
      job.updatedAt = Date.now();
      Object.assign(job, additionalData);

      await this.redisClient.command('SET', [jobKey, JSON.stringify(job)]);
      await this.redisClient.command('ZREM', [`${this.prefix}:processing`, jobId]);
      await this.redisClient.command('ZADD', [
        `${this.prefix}:${status}`,
        job.updatedAt,
        jobId,
      ]);
    }
  }

  /**
   * Get job status.
   */
  async getJobStatus(jobId) {
    if (!await this.redisClient.ping()) {
      return null;
    }

    const jobKey = `${this.prefix}:job:${jobId}`;
    const jobData = await this.redisClient.command('GET', [jobKey]);

    return jobData ? JSON.parse(jobData) : null;
  }

  /**
   * Get queue statistics.
   */
  async getStats() {
    if (!await this.redisClient.ping()) {
      return null;
    }

    const [pending, processing, completed, failed] = await Promise.all([
      this.redisClient.command('ZCARD', [`${this.prefix}:pending`]),
      this.redisClient.command('ZCARD', [`${this.prefix}:processing`]),
      this.redisClient.command('ZCARD', [`${this.prefix}:completed`]),
      this.redisClient.command('ZCARD', [`${this.prefix}:failed`]),
    ]);

    return {
      pending: pending ?? 0,
      processing: processing ?? 0,
      completed: completed ?? 0,
      failed: failed ?? 0,
      total: (pending ?? 0) + (processing ?? 0) + (completed ?? 0) + (failed ?? 0),
    };
  }

  /**
   * Stop processing jobs.
   */
  async stop() {
    this.logger.info({ queue: this.name }, 'Stopping job processor');
    this.isProcessing = false;

    // Wait for in-flight jobs to complete (with timeout)
    const timeout = setTimeout(() => {
      this.logger.warn('Job processor stop timeout');
    }, 30000);

    while (this.processingJobs.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    clearTimeout(timeout);
    this.logger.info({ queue: this.name }, 'Job processor stopped');
  }
}

/**
 * Create a job queue for credential issuance operations.
 */
export function createCredentialIssueQueue(redisClient, options = {}) {
  return new JobQueue(redisClient, 'credential-issuance', {
    maxRetries: options.maxRetries ?? 3,
    processingTimeoutMs: options.processingTimeoutMs ?? 30000,
    ...options,
  });
}

/**
 * Create a job queue for batch verification operations.
 */
export function createBatchVerificationQueue(redisClient, options = {}) {
  return new JobQueue(redisClient, 'batch-verification', {
    maxRetries: options.maxRetries ?? 5,
    processingTimeoutMs: options.processingTimeoutMs ?? 60000,
    ...options,
  });
}
