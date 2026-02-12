/**
 * Queue Worker Endpoint for Slack Event Processing
 *
 * POST /api/slack/events/process
 * Processes Slack events asynchronously from the queue.
 * Called by QStash or internal queue polling system.
 */

import { NextRequest, NextResponse } from 'next/server';
import { processSlackEvent, SlackEventPayload } from '@/lib/slack/events';
import { processJob } from '@/lib/queue';

/**
 * Verify QStash signature (if using QStash)
 * Simple verification based on Authorization header
 */
function verifyQStashSignature(req: NextRequest): boolean {
  const qstashToken = process.env.QSTASH_TOKEN;

  // If QStash is not configured, allow all requests (for local development)
  if (!qstashToken) {
    console.warn(
      '[Queue Worker] QStash not configured, skipping signature verification'
    );
    return true;
  }

  // Check for QStash signature headers
  const signature = req.headers.get('upstash-signature');

  if (!signature) {
    console.error('[Queue Worker] Missing QStash signature');
    return false;
  }

  // In production, you would verify the signature properly
  // For now, we'll do a simple token check
  const authHeader = req.headers.get('authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return token === qstashToken;
  }

  // More sophisticated signature verification would go here
  // See: https://docs.upstash.com/qstash/howto/signature
  return true;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log('[Queue Worker] Processing event job');

  // Verify QStash signature
  if (!verifyQStashSignature(req)) {
    console.error('[Queue Worker] Invalid QStash signature');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Parse request body
    const body = await req.json();

    const { jobId, type, payload } = body;

    if (!jobId) {
      console.error('[Queue Worker] Missing jobId in request');
      return NextResponse.json(
        { error: 'Missing jobId' },
        { status: 400 }
      );
    }

    console.log(`[Queue Worker] Processing job ${jobId} of type ${type}`);

    // Process the job using the queue system's processJob function
    await processJob(jobId, async (jobPayload: any) => {
      const { eventId, payload: eventPayload } = jobPayload;

      console.log(`[Queue Worker] Processing Slack event ${eventId}`);

      // Call the Slack event processor
      await processSlackEvent(eventPayload as SlackEventPayload);

      console.log(`[Queue Worker] Successfully processed event ${eventId}`);
    });

    return NextResponse.json({ ok: true, jobId });
  } catch (error) {
    console.error('[Queue Worker] Error processing job:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    // Return 500 so QStash will retry
    return NextResponse.json(
      {
        error: 'Processing failed',
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for health check
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    service: 'slack-event-processor',
    timestamp: new Date().toISOString(),
  });
}
