import { personalLayoutData } from '@/lib/server/personal-layout-fixture';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const projection = await personalLayoutData(request);
    if (projection)
      return Response.json(projection, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    /* Локальная проекция никогда не мешает чтению настоящего разбора. */
  }
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
}
