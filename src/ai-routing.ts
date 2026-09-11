import type { Plan } from '@prisma/client';
import { config } from './config.js';
import { omniChat, type AIMessage } from './omni-client.js';

export type { AIMessage } from './omni-client.js';
export type AISection = 'study' | 'cases' | 'questions' | 'ministerial' | 'exams' | 'search' | 'admin';
type GroupKey = 'DEFAULT' | 'STUDY' | 'CASES' | 'QUESTIONS' | 'MINISTERIAL' | 'EXAMS' | 'SEARCH' | 'ADMIN';
const sectionGroupKey: Record<AISection, GroupKey> = { study:'STUDY', cases:'CASES', questions:'QUESTIONS', ministerial:'MINISTERIAL', exams:'EXAMS', search:'SEARCH', admin:'ADMIN' };
function configuredGroup(key: GroupKey): string | undefined {
  const envValue = process.env[`OMNIROUTE_GROUP_${key}`]?.trim();
  if (envValue) return envValue;
  const value = config[`OMNIROUTE_GROUP_${key}` as keyof typeof config];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
export function selectModelGroup(section: AISection, plan: Plan) {
  const sectionGroup = configuredGroup(sectionGroupKey[section]);
  if (sectionGroup) return sectionGroup;
  return plan === 'PRO' ? undefined : configuredGroup('DEFAULT');
}
export async function routedChat(section: AISection, plan: Plan, messages: AIMessage[], temperature = 0.2) {
  return omniChat(messages, { model: selectModelGroup(section, plan), temperature });
}
export function aiRoutingSummary() {
  return {
    url: config.OMNIROUTE_URL,
    defaultModel: config.OMNIROUTE_MODEL,
    groups: Object.fromEntries((Object.keys(sectionGroupKey) as AISection[]).map((section) => [section, selectModelGroup(section, 'FREE') ?? config.OMNIROUTE_MODEL])),
  };
}
