import { formatRetrievedContext, searchApprovedContent, expandMedicalQuery } from './content-search.js';
import { searchMedicalSources } from './web-search.js';
import { routedChat } from './ai-routing.js';
import type { AISection } from './ai-routing.js';
import type { Plan } from '@prisma/client';

export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

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

function answerLanguage(question: string) {
  const arabic = (question.match(/[\u0600-\u06ff]/g) || []).length;
  const latin = (question.match(/[A-Za-z]/g) || []).length;
  return arabic >= latin ? 'العربية' : 'English';
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
  const retrievalQuery = expandMedicalQuery(question);

  const driveItems = await searchApprovedContent(retrievalQuery, {
    take: 12,
    department: options?.department,
    stage: options?.stage,
    subjectName: options?.subjectName,
  });

  const driveContext = formatRetrievedContext(driveItems, 12_000);
  const useDriveContext = driveItems.length > 0 && hasSufficientGroundedContext(driveContext);
  const webResults = useDriveContext ? [] : await searchMedicalSources(retrievalQuery, undefined, 3);

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
    return answerLanguage(question) === 'English'
      ? 'I could not find approved QMRMed content or suitable medical web sources for this question. Try a more specific medical term or select the relevant section/stage.'
      : 'لم أجد محتوى معتمدًا من QMRMed أو مصادر طبية ويب مناسبة مرتبطًا بسؤالك. جرّب استخدام المصطلح الطبي بشكل أكثر تحديدًا أو اختر القسم/المرحلة المناسبة.';
  }

  const language = answerLanguage(question);
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
        `أجب باللغة نفسها التي استخدمها الطالب في السؤال: ${language}. إذا كان السؤال عربيًا فأجب بالعربية الطبية الواضحة، وإذا كان إنجليزيًا فأجب بإنجليزية طبية واضحة.`,
        'افهم المصطلحات الطبية العربية والإنجليزية والاختصارات الطبية على أنها قد تشير إلى المفهوم نفسه.',
        'استخدم عناوين واضحة وقوائم ونقاط وجداول عند الحاجة لتحسين سهولة القراءة.',
        sourceInstruction,
        'لا تضف معلومات من معرفتك العامة إذا لم يدعمها السياق المسترجع.',
        'ممنوع تمامًا كتابة أي مصدر أو مرجع أو رابط أو URL داخل متن الإجابة.',
        'ممنوع استخدام Markdown links داخل الإجابة.',
        'ممنوع كتابة عبارات مثل المصدر أو المراجع أو References أو Sources داخل الإجابة.',
        'لا تكرر اسم الموقع أو عنوان المصدر داخل الإجابة؛ سيضيف النظام المصادر المستخدمة برمجيًا في نهاية الرد.',
        'إذا كان النص المسترجع مشوهًا أو غير مكتمل، أعد صياغته اعتمادًا على المعنى المدعوم فقط.',
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
