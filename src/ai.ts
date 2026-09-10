import { config } from './config.js';
import { formatRetrievedContext, searchApprovedContent } from './content-search.js';
import { routedChat, type AISection } from './ai-routing.js';
import type { Plan } from '@prisma/client';

export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function endpoint(path: string) {
  return `${config.OMNIROUTE_URL.replace(/\/$/, '')}${path}`;
}

export async function omniChat(messages: AIMessage[], options?: { model?: string; temperature?: number }) {
  if (!config.OMNIROUTE_API_KEY) throw new Error('OMNIROUTE_API_KEY is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.OMNIROUTE_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint('/v1/chat/completions'), {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${config.OMNIROUTE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: options?.model ?? config.OMNIROUTE_MODEL, messages, temperature: options?.temperature ?? 0.2 }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`OmniRoute ${response.status}: ${raw.slice(0, 500)}`);
    const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('OmniRoute returned an empty response');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export async function answerMedicalQuestion(
  question: string,
  options?: {
    department?: string;
    stage?: string;
    subjectName?: string;
    section?: AISection;
    plan?: Plan;
  },
) {
  const section = options?.section ?? 'study';
  const plan = options?.plan ?? 'FREE';
  const driveItems = await searchApprovedContent(question, {
    take: 12,
    department: options?.department,
    stage: options?.stage,
    subjectName: options?.subjectName,
  });
  const trustedContext = formatRetrievedContext(driveItems, 12_000);
  if (!trustedContext) {
    return 'لم أجد محتوى معتمدًا من QMRMed مرتبطًا بسؤالك ضمن إعدادات الدراسة الحالية. جرّب كلمات أكثر تحديدًا أو غيّر القسم/المرحلة.';
  }

  return routedChat(section, plan, [
    {
      role: 'system',
      content: [
        'أنت المساعد الدراسي الطبي في QMRMed.',
        'أجب بالعربية الواضحة، وكن دقيقًا ومختصرًا نسبيًا.',
        'المقاطع التالية مسترجعة مباشرة من ملفات QMRMed المعتمدة في Google Drive. اعتمد عليها حصريًا.',
        'لا تضف معلومات من معرفتك العامة إذا لم يدعمها السياق.',
        'لا تخترع مصادر أو مراجع. عند ذكر مصدر، استخدم اسم المصدر الموجود في السياق فقط.',
        'إذا كان السؤال يطلب Case أو أسئلة وزارية، استخرجها أو لخّصها من المحتوى المسترجع ولا تنشئ سؤالًا وزاريًا من عندك.',
        'إذا كان السياق غير كافٍ، اذكر ذلك بوضوح بدل التخمين.',
        'هذا مساعد تعليمي وليس بديلًا عن الطبيب أو التشخيص الفردي.',
        `السياق المعتمد من QMRMed:\n${trustedContext}`,
      ].join('\n\n'),
    },
    { role: 'user', content: question },
  ], 0.2);
}
