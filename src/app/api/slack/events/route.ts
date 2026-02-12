/**
 * Slack Events API Endpoint
 *
 * POST /api/slack/events
 * Receives events from Slack's Events API.
 *
 * CRITICAL: Must respond within 3 seconds to avoid retries.
 * Strategy: Verify signature, handle challenges, then immediately
 * enqueue events for async processing and return 200 OK.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySlackSignature, getEventId, getRetryInfo } from '@/lib/slack/verify';
import { enqueueJob, SLACK_EVENT_PROCESS } from '@/lib/queue';

// Set to track recently processed event IDs (in-memory deduplication)
const processedEvents = new Set<string>();
const MAX_PROCESSED_EVENTS = 10000;
const CLEANUP_INTERVAL = 60000; // Clean up every minute

// Periodically clean up old event IDs
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    if (processedEvents.size > MAX_PROCESSED_EVENTS) {
      // Keep only the most recent half
      const toKeep = Array.from(processedEvents).slice(-MAX_PROCESSED_EVENTS / 2);
      processedEvents.clear();
      toKeep.forEach((id) => processedEvents.add(id));
    }
  }, CLEANUP_INTERVAL);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log('[Slack Events] Received event');

  // Verify Slack signature
  const { valid, body } = await verifySlackSignature(req);

  if (!valid) {
    console.error('[Slack Events] Signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse the request body
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    console.error('[Slack Events] Failed to parse JSON:', error);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Handle URL verification challenge (one-time setup)
  if (payload.type === 'url_verification') {
    console.log('[Slack Events] URL verification challenge received');
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Handle event callbacks
  if (payload.type === 'event_callback') {
    const eventId = getEventId(payload);

    if (!eventId) {
      console.error('[Slack Events] Event missing event_id');
      return NextResponse.json(
        { error: 'Event missing event_id' },
        { status: 400 }
      );
    }

    // Get retry information
    const { retryNum, retryReason } = getRetryInfo(req);

    // Check if this is a retry and we've already processed it
    if (retryNum > 0) {
      if (processedEvents.has(eventId)) {
        console.log(
          `[Slack Events] Duplicate event ${eventId} (retry ${retryNum}), already processed`
        );
        return NextResponse.json({ ok: true });
      }

      console.log(
        `[Slack Events] Retry ${retryNum} for event ${eventId}. Reason: ${retryReason || 'unknown'}`
      );
    }

    // Add to in-memory deduplication set
    processedEvents.add(eventId);

    // Enqueue event for async processing
    // This returns immediately, so we stay within the 3-second timeout
    try {
      const jobId = await enqueueJob(SLACK_EVENT_PROCESS, {
        eventId,
        payload,
        retryNum,
      });

      console.log(
        `[Slack Events] Event ${eventId} queued for processing (job: ${jobId})`
      );

      // Return 200 OK immediately
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error('[Slack Events] Failed to enqueue event:', error);

      // Still return 200 to prevent Slack from retrying
      // The event will be lost, but that's better than cascading retries
      return NextResponse.json({ ok: true });
    }
  }

  // Handle other event types
  console.log(`[Slack Events] Unknown event type: ${payload.type}`);
  return NextResponse.json({ ok: true });
}