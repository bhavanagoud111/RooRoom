import { Readable } from 'stream';
import { assertUuid, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { audit, countRead } from '@/lib/limits';
import { getFile, removeFile } from '@/lib/storage';

type P = { docId: string };

// Files are streamed from MinIO only after Row Level Security finds the row, and always as a
// download (never rendered as a page), so an uploaded file cannot run script in our origin.
export const GET = route<P>(async (_req, { me, params }) => {
  const id = assertUuid(params.docId);
  const doc = await withUser(me.id, async (db) => {
    const r = await db.query('SELECT id, course_id, filename, storage_key FROM documents WHERE id = $1', [id]);
    if (!r.rows[0]) throw new HttpError(404, 'Not found.');
    await countRead(db, me.id, r.rows[0].course_id, 'document_download');
    await audit(db, me.id, 'document_downloaded', { document_id: id });
    return r.rows[0];
  });
  const stream = await getFile(doc.storage_key);
  const safeName = String(doc.filename).replace(/[^\w.\- ]/g, '_');
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
});

export const DELETE = route<P>(async (_req, { me, params }) => {
  const id = assertUuid(params.docId);
  const key = await withUser(me.id, async (db) => {
    const r = await db.query('DELETE FROM documents WHERE id = $1 RETURNING storage_key', [id]);
    if (!r.rows[0]) throw new HttpError(404, 'Not found, or not yours to delete.');
    await audit(db, me.id, 'document_deleted', { document_id: id });
    return r.rows[0].storage_key as string;
  });
  await removeFile(key).catch(() => {});
  return { ok: true };
});
