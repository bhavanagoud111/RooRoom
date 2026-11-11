import 'server-only';
import { Client } from 'minio';
import type { Readable } from 'stream';

// MinIO sits on the internal network with no public port. Files are only ever streamed
// through the app, after a Row Level Security check, and always as downloads.

export const BUCKET = 'course-files';

const g = globalThis as unknown as { __rrMinio?: Client };

function client(): Client {
  if (!g.__rrMinio) {
    g.__rrMinio = new Client({
      endPoint: process.env.MINIO_ENDPOINT ?? 'minio',
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY ?? '',
      secretKey: process.env.MINIO_SECRET_KEY ?? '',
    });
  }
  return g.__rrMinio;
}

export async function putFile(key: string, data: Buffer, contentType: string) {
  await client().putObject(BUCKET, key, data, data.length, { 'Content-Type': contentType });
}

export async function getFile(key: string): Promise<Readable> {
  return client().getObject(BUCKET, key);
}

export async function removeFile(key: string) {
  await client().removeObject(BUCKET, key);
}
