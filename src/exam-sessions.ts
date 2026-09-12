import { randomUUID } from 'node:crypto';
import { db } from './db.js';

export const EXAM_DURATION_MS = 10 * 60 * 1000;

export type StartExamInput = {
  userId: number;
  title: string;
  questionCount: number;
  fileId?: string;
  questions: Array<{
    prompt: string;
    options?: unknown;
    correct: string;
    explanation?: string | null;
    questionId?: number;
  }>;
  now?: Date;
  durationMs?: number;
};

export async function startExam(input: StartExamInput) {
  if (!input.questions.length || input.questions.length !== input.questionCount) throw new Error('Exam question count does not match the supplied questions.');
  const startedAt = input.now ?? new Date();
  const expiresAt = new Date(startedAt.getTime() + (input.durationMs ?? EXAM_DURATION_MS));
  return db.examSession.create({
    data: {
      id: randomUUID(),
      userId: input.userId,
      fileId: input.fileId,
      title: input.title,
      questionCount: input.questionCount,
      startedAt,
      expiresAt,
      questions: {
        create: input.questions.map((question, position) => ({
          id: randomUUID(),
          position,
          questionId: question.questionId,
          prompt: question.prompt,
          options: question.options as object | undefined,
          correct: question.correct,
          explanation: question.explanation,
        })),
      },
    },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
}

export async function getExamForUser(sessionId: string, userId: number) {
  const session = await db.examSession.findFirst({
    where: { id: sessionId, userId },
    include: { questions: { orderBy: { position: 'asc' }, include: { answers: true } }, answers: true },
  });
  if (!session) return null;
  if (session.status === 'ACTIVE' && new Date() >= session.expiresAt) {
    await db.examSession.updateMany({ where: { id: session.id, userId, status: 'ACTIVE' }, data: { status: 'EXPIRED', completedAt: new Date() } });
    return { ...session, status: 'EXPIRED' as const };
  }
  return session;
}

export async function answerExam(sessionId: string, userId: number, questionId: string, answer: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const session = await tx.examSession.findFirst({ where: { id: sessionId, userId }, include: { questions: true } });
    if (!session) throw new Error('Exam session not found.');
    if (session.status !== 'ACTIVE') throw new Error('Exam session is no longer active.');
    if (now >= session.expiresAt) {
      await tx.examSession.update({ where: { id: session.id }, data: { status: 'EXPIRED', completedAt: now } });
      throw new Error('Exam time has expired.');
    }
    const question = session.questions.find((item) => item.id === questionId);
    if (!question) throw new Error('Exam question not found.');
    const isCorrect = question.correct.trim().toLocaleLowerCase() === answer.trim().toLocaleLowerCase();
    const previous = await tx.examAnswer.findUnique({ where: { sessionId_questionId: { sessionId, questionId } } });
    if (previous) return { session, question, isCorrect: previous.isCorrect, duplicate: true };
    const elapsedMs = Math.max(0, now.getTime() - session.startedAt.getTime());
    await tx.examAnswer.create({ data: { id: randomUUID(), sessionId, questionId, answer, isCorrect, answeredAt: now, elapsedMs } });
    const answeredCount = await tx.examAnswer.count({ where: { sessionId } });
    const score = await tx.examAnswer.count({ where: { sessionId, isCorrect: true } });
    const completed = answeredCount >= session.questionCount;
    const updated = await tx.examSession.update({ where: { id: sessionId }, data: { currentIndex: Math.min(answeredCount, session.questionCount), score, status: completed ? 'COMPLETED' : 'ACTIVE', completedAt: completed ? now : null } });
    return { session: updated, question, isCorrect, duplicate: false };
  });
}

export function remainingExamSeconds(expiresAt: Date, now = new Date()) {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}
