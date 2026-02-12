import { NextRequest, NextResponse } from 'next/server';
import { syncWorkspaceDMs } from '@/lib/slack/dm-sync';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;
    const body = await request.json().catch(() => ({}));
    const force = body.force === true;
    const result = await syncWorkspaceDMs(workspaceId, { force });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'DM sync failed', message: error.message },
      { status: 500 }
    );
  }
}
