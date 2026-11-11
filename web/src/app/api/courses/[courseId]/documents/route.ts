import { randomUUID } from 'crypto';
import { assertUuid, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { requireMember } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { queueIngest } from '@/lib/embed';
import { audit, countRead, spend } from '@/lib/limits';
import { putFile } from '@/lib/storage';

type P = { courseId: string };
const KINDS = ['module', 'syllabus', 'assignment', 'quiz'] as const;
const MAX_BYTES = 25 * 1024 * 1024;

export const GET = route<P>(async (_req, { me, params }) => {
  const courseId = assertUuid(params.courseId);
  return withUser(me.id, async (db) => {
    await requireMember(db, courseId);
    await countRead(db, me.id, courseId, 'documents');
    // RLS returns class documents plus this user's own private uploads, and nothing else.
    const r = await db.query(
      `SELECT d.id, d.title, d.kind, d.module, d.visibility, d.filename, d.size_bytes, d.status, d.status_note,
              d.page_count, d.created_at, d.author_role, (d.uploader_id = app_uid()) AS mine
         FROM documents d WHERE d.course_id = $1 ORDER BY d.kind = 'syllabus' DESC, d.module NULLS LAST, d.created_at`,
      [courseId]);
    return { documents: r.rows };
  });
});

// Professor uploads go to the whole class. Student uploads stay private to the uploader, so the
// app never redistributes course material a student had no right to share. RLS enforces this too.
export const POST = route<P>(async (req, { me, params }) => {
  const courseId = assertUuid(params.courseId);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Choose a PDF to upload.');
  if (file.size > MAX_BYTES) throw new HttpError(400, 'PDFs up to 25 MB.');
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, 'Only PDF files are supported.');
  const kind = String(form.get('kind') ?? 'module') as (typeof KINDS)[number];
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Unknown document type.');
  const title = String(form.get('title') ?? '').trim().slice(0, 140) || file.name.replace(/\.pdf$/i, '');
  const moduleName = String(form.get('module') ?? '').trim().slice(0, 60) || null;

  const doc = await withUser(me.id, async (db) => {
    const c = await requireMember(db, courseId);
    await spend(db, me.id, 'upload', courseId);
    const visibility = c.is_prof && form.get('visibility') !== 'private' ? 'class' : 'private';
    const id = randomUUID();
    const key = `${courseId}/${id}.pdf`;
    await putFile(key, buf, 'application/pdf');
    await db.query(
      `INSERT INTO documents (id, course_id, uploader_id, author_role, visibility, kind, title, module, filename, storage_key, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, courseId, me.id, c.is_prof ? 'professor' : 'student', visibility, kind, title, moduleName,
       file.name.slice(0, 200), key, buf.length]);
    await audit(db, me.id, 'document_uploaded', { course_id: courseId, document_id: id, visibility, kind });
    return { id, visibility };
  });
  await queueIngest(doc.id);
  return { ok: true, ...doc };
});
