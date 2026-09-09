import { db } from './db.js';
import type { ContentKind } from '@prisma/client';

export type RetrievedContent = {
  title: string;
  text: string;
  kind: ContentKind;
  source: string;
  driveFileId: string;
  webViewLink?: string | null;
  department?: string | null;
  stage?: string | null;
  subjectName?: string | null;
};

function termsOf(query: string) {
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 10);
}

export async function searchApprovedContent(query: string, options?: {
  kinds?: ContentKind[];
  department?: string;
  stage?: string;
  subjectName?: string;
  take?: number;
}) {
  const terms = termsOf(query);
  if (!terms.length) return [];

  const take = Math.min(options?.take ?? 12, 30);
  const chunks = await db.contentChunk.findMany({
    where: {
      source: {
        approved: true,
        ...(options?.department ? { department: options.department } : {}),
        ...(options?.stage ? { stage: options.stage } : {}),
        ...(options?.subjectName ? { subjectName: options.subjectName } : {}),
      },
      ...(options?.kinds?.length ? { kind: { in: options.kinds } } : {}),
      OR: terms.map((term) => ({ text: { contains: term } })),
    },
    include: { source: true },
    take,
    orderBy: { updatedAt: 'desc' },
  });

  return chunks.map((chunk) => ({
    title: chunk.title,
    text: chunk.text,
    kind: chunk.kind,
    source: chunk.source.name,
    driveFileId: chunk.driveFileId,
    webViewLink: chunk.source.webViewLink,
    department: chunk.source.department,
    stage: chunk.source.stage,
    subjectName: chunk.source.subjectName,
  } satisfies RetrievedContent));
}

export function formatRetrievedContext(items: RetrievedContent[], maxChars = 12_000) {
  let context = '';
  for (const item of items) {
    const header = `[${item.kind}] ${item.title}`;
    const meta = [item.department, item.stage, item.subjectName].filter(Boolean).join(' / ');
    const block = `${header}${meta ? `\nالتصنيف: ${meta}` : ''}\nالمصدر: ${item.source}\n${item.text}`;
    if (context.length + block.length + 2 > maxChars) break;
    context += `${context ? '\n\n' : ''}${block}`;
  }
  return context;
}
