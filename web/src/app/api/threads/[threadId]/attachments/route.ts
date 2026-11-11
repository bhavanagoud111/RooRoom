import { randomUUID } from 'crypto';
import { assertUuid, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { sealBuffer } from '@/lib/crypto';
import { withUser } from '@/lib/db';
import { checkAttachment, MAX_ATTACHMENT_BYTES } from '@/lib/features/attachments';
import { sendAttachment, threadMeta } from '@/lib/features/chat';
import { putFile, removeFile } from '@/lib/storage';

type P = { threadId: string };

// Share one file in a study-buddy chat, with an optional caption. Membership is checked before
// anything is stored; the file is encrypted before it reaches object storage.
export const POST = route<P>(async (req, { me, params }) => {
  const threadId = assertUuid(params.threadId);
  // Refuse an oversized upload before reading it (the form adds a little on top of the file).
  if (Number(req.headers.get('content-length') ?? 0) > MAX_ATTACHMENT_BYTES + 64 * 1024) {
    throw new HttpError(413, 'Files up to 10 MB can be shared in chat.');
  }
  const form = await req.formData().catch(() => { throw new HttpError(400, 'That upload could not be read. Try again.'); });
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Choose a file to share.');
  if (file.size > MAX_ATTACHMENT_BYTES) throw new HttpError(400, 'Files up to 10 MB can be shared in chat.');
  const caption = String(form.get('body') ?? '').trim().slice(0, 2000);
  const filename = (file.name || 'file').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);
  const buf = Buffer.from(await file.arrayBuffer());
  const { type } = checkAttachment(filename, buf);

  await withUser(me.id, (db) => threadMeta(db, threadId), { readOnly: true });
  const id = randomUUID();
  const storageKey = `chat/${threadId}/${id}`;
  await putFile(storageKey, sealBuffer(buf), 'application/octet-stream');
  try {
    const message = await withUser(me.id, (db) =>
      sendAttachment(db, me, threadId, caption, { id, filename, contentType: type, size: buf.length, storageKey }));
    return { message };
  } catch (e) {
    await removeFile(storageKey).catch(() => {});
    throw e;
  }
});
