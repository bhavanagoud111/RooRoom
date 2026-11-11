import 'server-only';

// Embeddings come from the worker's local model (bge-small, 384 dimensions). Every chunk and
// every question uses this same model, so similarity scores stay meaningful, and student text
// never leaves the stack for this step.

export async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${process.env.WORKER_URL}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': process.env.WORKER_TOKEN ?? '' },
    body: JSON.stringify({ texts }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`embedding failed (${res.status})`);
  return ((await res.json()) as { vectors: number[][] }).vectors;
}

export async function embedOne(text: string): Promise<number[]> {
  return (await embed([text]))[0];
}

export async function queueIngest(documentId: string): Promise<void> {
  const res = await fetch(`${process.env.WORKER_URL}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': process.env.WORKER_TOKEN ?? '' },
    body: JSON.stringify({ document_id: documentId }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`could not queue ingestion (${res.status})`);
}
