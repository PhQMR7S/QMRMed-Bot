import type { Plan } from '@prisma/client';
import { config } from './config.js';
import { omniChat, type AIMessage } from './omni-client.js';

export type { AIMessage } from './omni-client.js';

export type AISection = 'study' | 'cases' | 'questions' | 'ministerial' | 'exams' | 'search' | 'admin';

const modelGroups: Record<AISection, string | undefined> = {
  study: config.OMNIROUTE_GROUP_STUDY,
  cases: config.OMNIROUTE_GROUP_CASES,
  questions: config.OMNIROUTE_GROUP_QUESTIONS,
  ministerial: config.OMNIROUTE_GROUP_MINISTERIAL,
  exams: config.OMNIROUTE_GROUP_EXAMS,
  search: config.OMNIROUTE_GROUP_SEARCH,
  admin: config.OMNIROUTE_GROUP_ADMIN,
};

export function selectModelGroup(section: AISection, plan: Plan) {
  return modelGroups[section] ?? (plan === 'PRO' ? undefined : config.OMNIROUTE_GROUP_DEFAULT);
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
      study: config.OMNIROUTE_GROUP_STUDY ?? config.OMNIROUTE_MODEL,
      cases: config.OMNIROUTE_GROUP_CASES ?? config.OMNIROUTE_MODEL,
      questions: config.OMNIROUTE_GROUP_QUESTIONS ?? config.OMNIROUTE_MODEL,
      ministerial: config.OMNIROUTE_GROUP_MINISTERIAL ?? config.OMNIROUTE_MODEL,
      exams: config.OMNIROUTE_GROUP_EXAMS ?? config.OMNIROUTE_MODEL,
      search: config.OMNIROUTE_GROUP_SEARCH ?? config.OMNIROUTE_MODEL,
      admin: config.OMNIROUTE_GROUP_ADMIN ?? config.OMNIROUTE_MODEL,
    },
  };
}
