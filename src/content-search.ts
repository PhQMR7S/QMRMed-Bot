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

/** Normalize common Arabic/Latin spelling and punctuation before matching. */
function normalizeText(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[.,!?;:()[\]{}<>"'`~@#$%^&*+=|\\/\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termsOf(query: string) {
  return normalizeText(query)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term, index, all) => all.indexOf(term) === index)
    .slice(0, 12);
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
        indexed: true,
        ...(options?.department ? { department: options.department } : {}),
        ...(options?.stage ? { stage: options.stage } : {}),
        ...(options?.subjectName ? { subjectName: options.subjectName } : {}),
      },
      ...(options?.kinds?.length ? { kind: { in: options.kinds } } : {}),
      OR: terms.map((term) => ({ text: { contains: term, mode: 'insensitive' } })),
    },
    include: { source: true },
    take: Math.min(take * 3, 90),
    orderBy: { updatedAt: 'desc' },
  });

  const normalizedTerms = terms.map(normalizeText);
  const ranked = chunks
    .map((chunk) => {
      const haystack = normalizeText(`${chunk.title} ${chunk.text}`);
      let score = 0;
      for (const term of normalizedTerms) {
        const occurrences = haystack.split(term).length - 1;
        score += occurrences;
        if (normalizeText(chunk.title).includes(term)) score += 5;
      }
      return { chunk, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.chunk.updatedAt.getTime() - a.chunk.updatedAt.getTime())
    .slice(0, take);

  return ranked.map(({ chunk }) => ({
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
