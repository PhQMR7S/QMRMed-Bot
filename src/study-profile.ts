import { db } from './db.js';

export async function getStudyProfile(userId: number) {
  return db.user.findUniqueOrThrow({ where: { id: userId }, select: { department: true, stage: true } });
}
