import type { Plan } from '@prisma/client';
import { config } from './config.js';
import { omniChat, type AIMessage } from './omni-client.js';

export type { AIMessage } from './omni-client.js';

export type AISection = 'study' | 'cases' | 'questions' | 'ministerial' | 'exams' | 'search' | 'admin';

export function selectModelGroup(section: AISection, plan: Plan) {
  const groups: Record<AISection, string | undefined> = {
    study: process.env.OMNIROUTE_GROUP_STUDY,
    cases: process.env.OMNIROUTE_GROUP_CASES,
    questions: process.env.OMNIROUTE_GROUP_QUESTIONS,
    ministerial: process.env.OMNIROUTE_GROUP_MINISTERIAL,
    exams: process.env.OMNIROUTE_GROUP_EXAMS,
    search: process.env.OMNIROUTE_GROUP_SEARCH,
    admin: process.env.OMNIROUTE_GROUP_ADMIN,
  };
  return groups[section] ?? (plan === 'PRO' ? undefined : process.env.OMNIROUTE_GROUP_DEFAULT);
}

export async function routedChat(section: AISection, plan: Plan, messages: AIMessage[], temperature = 0.2) {
  const model = selectModelGroup(section, plan);
  return omniChat(messages, { model, temperature });
}

export function aiRoutingSummary() {
  return {
    url: config.OMNIROUTE_URL,
    defaultModel: config.OMNIROUTE_MODEL,
    groups: {
      study: process.env.OMNIROUTE_GROUP_STUDY ?? config.OMNIROUTE_MODEL,
      cases: process.env.OMNIROUTE_GROUP_CASES ?? config.OMNIROUTE_MODEL,
      questions: process.env.OMNIROUTE_GROUP_QUESTIONS ?? config.OMNIROUTE_MODEL,
      ministerial: process.env.OMNIROUTE_GROUP_MINISTERIAL ?? config.OMNIROUTE_MODEL,
      exams: process.env.OMNIROUTE_GROUP_EXAMS ?? config.OMNIROUTE_MODEL,
      search: process.env.OMNIROUTE_GROUP_SEARCH ?? config.OMNIROUTE_MODEL,
      admin: process.env.OMNIROUTE_GROUP_ADMIN ?? config.OMNIROUTE_MODEL,
    },
  };
}
