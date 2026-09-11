import { config } from './config.js';
import { formatRetrievedContext, searchApprovedContent } from './content-search.js';
import { searchMedicalSources } from './web-search.js';
import { routedChat, type AISection } from './ai-routing.js';
import type { Plan } from '@prisma/client';

export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function endpoint(path: string) {
  return `${config.OMNIROUTE_URL.replace(/\/$/, '')}${path}`;
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function omniChat(messages: AIMessage[], options?: { model?: string; temperature?: number }) {
  if (!config.OMNIROUTE_API_KEY) throw new Error('OMNIROUTE_API_KEY is not configured');

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.OMNIROUTE_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint('/v1/chat/completions'), {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${config.OMNIROUTE_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options?.model ?? config.OMNIROUTE_MODEL,
          messages,
          temperature: options?.temperature ?? 0.2,
        }),
      });
      const raw = await response.text();
      if (!response.ok) {
        const error = new Error(`OmniRoute ${response.status}: ${raw.slice(0, 500)}`);
        if (!isRetryableStatus(response.status) || attempt === maxAttempts) throw error;
        lastError = error;
        await sleep(500 * attempt);
        continue;
      }
      const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('OmniRoute returned an empty response');
      return content;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof TypeError) {
        await sleep(500 * attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OmniRoute request failed');
}

function cleanAiAnswer(text: string) {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !/^>\s*(?:\*\*)?(?:المصدر|المصادر|المراجع)(?: الطبي)?(?: الطبية)?(?: المستخدمة)?\s*:?.*$/iu.test(trimmed);
    })
    .join('\n')
    .trim();
}

export function hasSufficientGroundedContext(context: string, minimumChars = 1_000) {
  return context.trim().length >= minimumChars;
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

  const driveContext = formatRetrievedContext(driveItems, 12_000);
  const useDriveContext = driveItems.length > 0 && hasSufficientGroundedContext(driveContext);
  const webResults = useDriveContext ? [] : await searchMedicalSources(question, undefined, 3);

  const webContext = webResults.length
    ? (() => {
        const maxContextChars = 16_000;
        const parts: string[] = [];
        let used = 0;
        for (const [index, item] of webResults.entries()) {
          const remaining = maxContextChars - used;
          if (remaining <= 0) break;
          const prefix = `[WEB ${index + 1}] `;
          const available = remaining - prefix.length;
          if (available <= 0) break;
          parts.push(`${prefix}${item.content.slice(0, available)}`);
          used += prefix.length + Math.min(item.content.length, available);
        }
        return parts.join('\n\n');
      })()
    : '';

  const context = useDriveContext ? driveContext : webContext;
  if (!context) {
    return 'لم أجد محتوى معتمدًا من QMRMed أو مصادر طبية ويب مناسبة مرتبطًا بسؤالك. جرّب كلمات أكثر تحديدًا أو غيّر القسم/المرحلة.';
  }

  const sourceInstruction = useDriveContext
    ? 'المصادر الأساسية التالية مسترجعة مباشرة من ملفات QMRMed المعتمدة في Google Drive. اعتمد عليها أولًا، ولا تستخدم الويب إذا كانت كافية.'
    : driveItems.length
      ? 'وجدنا محتوى QMRMed محليًا لكنه غير كافٍ للإجابة، لذلك استُخدمت نتائج بحث ويب طبية موثوقة لاستكمال السياق. لا تخترع معلومات غير مدعومة بالسياق.'
      : 'لم نجد محتوى QMRMed محليًا، لذلك استُخدمت نتائج بحث ويب طبية موثوقة. لا تخترع معلومات غير مدعومة بالسياق.';

  const answer = await routedChat(section, plan, [
    {
      role: 'system',
      content: [
        'أنت المساعد الدراسي الطبي في QMRMed.',
        'أجب بالعربية الطبية الواضحة والسليمة، وكن دقيقًا ومنظمًا ومختصرًا نسبيًا.',
        'استخدم عناوين واضحة وقوائم ونقاط وجداول عند الحاجة لتحسين سهولة القراءة.',
        sourceInstruction,
        'لا تضف معلومات من معرفتك العامة إذا لم يدعمها السياق المسترجع.',
        'ممنوع تمامًا كتابة أي مصدر أو مرجع أو رابط أو URL داخل متن الإجابة.',
        'ممنوع استخدام Markdown links داخل الإجابة.',
        'ممنوع كتابة عبارات مثل المصدر أو المراجع أو References أو Sources داخل الإجابة.',
        'لا تكرر اسم الموقع أو عنوان المصدر داخل الإجابة؛ سيضيف النظام المصادر المستخدمة برمجيًا في نهاية الرد.',
        'اكتب العربية بصورة طبيعية وسليمة. ترجم العبارات الإنجليزية العادية إلى العربية، ولا تُبقِ الإنجليزية إلا لاختصار أو مصطلح طبي ضروري.',
        'إذا كان النص المسترجع مشوهًا أو غير مكتمل، أعد صياغته عربيًا اعتمادًا على المعنى المدعوم فقط.',
        'إذا كان السؤال يطلب Case أو أسئلة وزارية، استخرجها أو لخّصها من المحتوى المسترجع ولا تنشئ سؤالًا وزاريًا من عندك.',
        'إذا كان السياق غير كافٍ، اذكر ذلك بوضوح بدل التخمين.',
        'هذا مساعد تعليمي وليس بديلًا عن الطبيب أو التشخيص الفردي.',
        `السياق المستخدم للإجابة:\n${context}`,
      ].join('\n\n'),
    },
    { role: 'user', content: question },
  ], 0.2);

  if (!webResults.length) return cleanAiAnswer(answer);

  const sources = webResults
    .map((item, index) => `${index + 1}. ${item.title} — ${item.source ?? 'مصدر طبي'}\n   🔗 ${item.url}`)
    .join('\n\n');

  return `${cleanAiAnswer(answer)}\n\n**المصادر الطبية المستخدمة:**\n${sources}`;
}
