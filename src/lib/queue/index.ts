/**
 * Simple HTTP-based Queue System
 *
 * Uses QStash when available for reliable job processing,
 * falls back to database polling for local development.
 */

import { prisma } from '../db';
import type { EnqueueOptions } from '../../types';

// Job type constants
export const JOB_TYPES = {
  SLACK_EVENT_PROCESS: 'slack.event.process',
  SLACK_BACKFILL: 'slack.backfill',
  ANALYSIS_PARSE: 'analysis.parse',
} as const;

export const SLACK_EVENT_PROCESS = JOB_TYPES.SLACK_EVENT_PROCESS;
export const SLACK_BACKFILL = JOB_TYPES.SLACK_BACKFILL;
export const ANALYSIS_PARSE = JOB_TYPES.ANALYSIS_PARSE;

export type JobType = typeof JOB_TYPES[keyof typeof JOB_TYPES];

/**
 * Enqueue a job for processing
 *
 * If QSTASH_TOKEN is set, publishes to QStash for reliable delivery.
 * Otherwise, saves to database for polling-based processing.
 *
 * @param type - Job type constant
 * @param payload - Job data
 * @param options - Optional delay and max attempts configuration
 * @returns Job ID
 */
export async function enqueueJob(
  type: string,
  payload: object,
  options: EnqueueOptions = {}
): Promise<string> {
  const { delay = 0, maxAttempts = 3 } = options;

  // Calculate scheduled time
  const scheduledAt = new Date();
  if (delay > 0) {
    scheduledAt.setSeconds(scheduledAt.getSeconds() + delay);
  }

  // Create job in database
  const job = await prisma.queueJob.create({
    data: {
      type,
      payload,
      status: 'pending',
      max_attempts: maxAttempts,
      scheduled_at: scheduledAt,
    },
  });

  // If QStash is configured, publish to QStash
  const qstashToken = process.env.QSTASH_TOKEN;
  const qstashUrl = process.env.QSTASH_URL;

  if (qstashToken && qstashUrl) {
    try {
      await publishToQStash(job.id, type, payload, delay);
      console.log(`[Queue] Published job ${job.id} to QStash`);
    } catch (error) {
      console.error(`[Queue] Failed to publish to QStash:`, error);
      // Job is still in database, can be processed by polling
    }
  } else {
    console.log(
      `[Queue] Job ${job.id} queued for polling (QStash not configured)`
    );
  }

  return job.id;
}

/**
 * Process a job with error handling and retry logic
 *
 * @param jobId - Job ID to process
 * @param handler - Async function that processes the job payload
 */
export async function processJob(
  jobId: string,
  handler: (payload: any) => Promise<void>
): Promise<void> {
  // Fetch and lock the job
  const job = await prisma.queueJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Check if job is already completed or exceeded max attempts
  if (job.status === 'completed') {
    console.log(`[Queue] Job ${jobId} already completed`);
    return;
  }

  if (job.status === 'failed' && job.attempts >= job.max_attempts) {
    console.log(`[Queue] Job ${jobId} already failed with max attempts`);
    return;
  }

  // Update job status to processing
  await prisma.queueJob.update({
    where: { id: jobId },
    data: {
      status: 'processing',
      started_at: new Date(),
      attempts: { increment: 1 },
    },
  });

  try {
    // Execute the handler
    await handler(job.payload);

    // Mark job as completed
    await prisma.queueJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        completed_at: new Date(),
        error: null,
      },
    });

    console.log(`[Queue] Job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack =
      error instanceof Error ? error.stack : JSON.stringify(error);

    console.error(`[Queue] Job ${jobId} failed:`, errorMessage);

    // Check if we should retry
    const updatedJob = await prisma.queueJob.findUnique({
      where: { id: jobId },
    });

    const shouldRetry =
      updatedJob && updatedJob.attempts < updatedJob.max_attempts;

    await prisma.queueJob.update({
      where: { id: jobId },
      data: {
        status: shouldRetry ? 'pending' : 'failed',
        error: `${errorMessage}\n\nStack:\n${errorStack}`,
        // Schedule retry with exponential backoff
        scheduled_at: shouldRetry
          ? new Date(
              Date.now() + Math.pow(2, updatedJob?.attempts || 0) * 1000
            )
          : undefined,
      },
    });

    if (shouldRetry) {
      console.log(
        `[Queue] Job ${jobId} will be retried (attempt ${updatedJob?.attempts}/${updatedJob?.max_attempts})`
      );
    } else {
      console.error(
        `[Queue] Job ${jobId} failed permanently after ${updatedJob?.attempts} attempts`
      );
    }

    // Re-throw error if this was the last attempt
    if (!shouldRetry) {
      throw error;
    }
  }
}

/**
 * Get pending jobs ready to be processed
 *
 * Used for polling-based job processing when QStash is not available
 *
 * @param limit - Maximum number of jobs to fetch
 * @returns Array of job IDs ready to process
 */
export async function getPendingJobs(limit: number = 10): Promise<string[]> {
  const jobs = await prisma.queueJob.findMany({
    where: {
      status: 'pending',
      scheduled_at: {
        lte: new Date(),
      },
    },
    orderBy: {
      scheduled_at: 'asc',
    },
    take: limit,
    select: {
      id: true,
    },
  });

  return jobs.map((job) => job.id);
}

/**
 * Get job statistics
 *
 * @returns Object with counts by status
 */
export async function getJobStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}> {
  const [pending, processing, completed, failed, total] = await Promise.all([
    prisma.queueJob.count({ where: { status: 'pending' } }),
    prisma.queueJob.count({ where: { status: 'processing' } }),
    prisma.queueJob.count({ where: { status: 'completed' } }),
    prisma.queueJob.count({ where: { status: 'failed' } }),
    prisma.queueJob.count(),
  ]);

  return { pending, processing, completed, failed, total };
}

/**
 * Clean up old completed jobs
 *
 * @param olderThanDays - Delete jobs completed more than N days ago
 * @returns Number of jobs deleted
 */
export async function cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const result = await prisma.queueJob.deleteMany({
    where: {
      status: 'completed',
      completed_at: {
        lt: cutoffDate,
      },
    },
  });

  console.log(`[Queue] Cleaned up ${result.count} old jobs`);
  return result.count;
}

/**
 * Retry a failed job
 *
 * @param jobId - Job ID to retry
 */
export async function retryJob(jobId: string): Promise<void> {
  await prisma.queueJob.update({
    where: { id: jobId },
    data: {
      status: 'pending',
      error: null,
      scheduled_at: new Date(),
    },
  });

  console.log(`[Queue] Job ${jobId} scheduled for retry`);
}

/**
 * Publish job to QStash
 *
 * @param jobId - Job ID
 * @param type - Job type
 * @param payload - Job payload
 * @param delay - Delay in seconds
 */
async function publishToQStash(
  jobId: string,
  type: string,
  payload: object,
  delay: number = 0
): Promise<void> {
  const qstashToken = process.env.QSTASH_TOKEN;
  const qstashUrl = process.env.QSTASH_URL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;

  if (!qstashToken || !qstashUrl) {
    throw new Error('QStash not configured');
  }

  if (!appUrl) {
    throw new Error('APP_URL not configured for QStash callback');
  }

  // QStash callback URL
  const callbackUrl = `${appUrl}/api/queue/process`;

  const headers: HeadersInit = {
    Authorization: `Bearer ${qstashToken}`,
    'Content-Type': 'application/json',
    'Upstash-Forward-Job-Id': jobId,
    'Upstash-Forward-Job-Type': type,
  };

  if (delay > 0) {
    headers['Upstash-Delay'] = `${delay}s`;
  }

  const response = await fetch(`${qstashUrl}/v2/publish/${callbackUrl}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`QStash publish failed: ${response.status} ${errorText}`);
  }
}
