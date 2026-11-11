import { assertUuid, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { openBuffer } from '@/lib/crypto';
import { withUser } from '@/lib/db';
import { isInlineImage } from '@/lib/features/attachments';
import { countRead } from '@/lib/limits';
import { getFile } from '@/lib/storage';

type P = { attachmentId: string };

// A chat file, only for members of that chat (Row Level Security finds the row or nothing).
// Photos are shown inline; everything else, and ?download=1, is a download. A strict sandbox and
// nosniff mean an uploaded file can never run as a page on our site.
export const GET = route<P>(async (req, { me, params }) => {
  const id = assertUuid(params.attachmentId);
  const a = await withUser(me.id, async (db) => {
    const r = await db.query(
      `SELECT a.filename, a.content_type, a.storage_key, t.course_id
         FROM message_attachments a JOIN threads t ON t.id = a.thread_id WHERE a.id = $1`, [id]);
    if (!r.rows[0]) throw new HttpError(404, 'Not found.');
    await countRead(db, me.id, r.rows[0].course_id, 'chat_file');
    return r.rows[0] as { filename: string; content_type: string; storage_key: string };
  });
  const chunks: Buffer[] = [];
  for await (const c of await getFile(a.storage_key)) chunks.push(c as Buffer);
  const data = openBuffer(Buffer.concat(chunks));
  const inline = isInlineImage(a.content_type) && req.nextUrl.searchParams.get('download') !== '1';
  const safe = a.filename.replace(/[^\w.\- ]/g, '_');
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': inline ? a.content_type : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      'Content-Length': String(data.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
