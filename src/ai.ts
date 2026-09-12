import { formatRetrievedContext, expandMedicalQuery } from './content-search.js';
import { searchMedicalSources } from './web-search.js';
import { routedChat } from './ai-routing.js';
import type { AISection } from './ai-routing.js';
import type { Plan } from '@prisma/client';
import { assessEvidence, keywordSearchEngine } from './search-engine.js';

export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function cleanAiAnswer(text: string) {
  return text.split('\n').filter((line) => {
    const trimmed = line.trim();
    return !/^>\s*(?:\*\*)?(?:المصدر|المصادر|المراجع)(?: الطبي)?(?: الطبية)?(?: المستخدمة)?\s*:?.*$/iu.test(trimmed);
  }).join('\n').trim();
}

function answerLanguage(question: string) {
  const arabic = (question.match(/[\u0600-\u06ff]/g) || []).length;
  const latin = (question.match(/[A-Za-z]/g) || []).length;
  return arabic >= latin ? 'العربية' : 'English';
}

/** Backward-compatible helper retained for callers/tests; production retrieval uses assessEvidence(). */
export function hasSufficientGroundedContext(context: string, minimumChars = 1_000) {
  return context.trim().length >= minimumChars;
}

export async function answerMedicalQuestion(
  question: string,
  options?: { department?: string; stage?: string; subjectName?: string; section?: AISection; plan?: Plan },
) {
  const section = options?.section ?? 'study';
  const plan = options?.plan ?? 'FREE';
  const retrievalQuery = expandMedicalQuery(question);
  const driveItems = await keywordSearchEngine.search({ query: retrievalQuery, take: 12, department: options?.department, stage: options?.stage, subjectName: options?.subjectName });
  const evidence = assessEvidence(driveItems, retrievalQuery);
  const driveContext = formatRetrievedContext(driveItems, 12_000);
  const useDriveContext = evidence.sufficient && driveContext.trim().length > 0;
  const webResults = useDriveContext ? [] : await searchMedicalSources(retrievalQuery, undefined, 3);
  const webContext = webResults.length ? (() => {
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
  })() : '';
  const context = useDriveContext ? driveContext : webContext;
  if (!context) return answerLanguage(question) === 'English'
    ? 'I could not find approved QMRMed content or suitable medical web sources for this question. Try a more specific medical term or select the relevant section/stage.'
    : 'لم أجد محتوى معتمدًا من QMRMed أو مصادر طبية ويب مناسبة مرتبطًا بسؤالك. جرّب استخدام المصطلح الطبي بشكل أكثر تحديدًا أو اختر القسم/المرحلة المناسبة.';
  const language = answerLanguage(question);
  const sourceInstruction = useDriveContext
    ? `المصادر الأساسية التالية مسترجعة مباشرة من ملفات QMRMed المعتمدة. مؤشرات الأدلة: relevance=${evidence.relevance.toFixed(2)}, coverage=${evidence.coverage.toFixed(2)}, authority=${evidence.authority.toFixed(2)}. اعتمد عليها أولًا.`
    : driveItems.length
      ? 'وجدنا محتوى QMRMed محليًا لكنه لم يحقق كفاية الأدلة من حيث الصلة والتغطية والموثوقية، لذلك استُخدمت نتائج بحث ويب طبية موثوقة للاستكمال.'
      : 'لم نجد محتوى QMRMed محليًا، لذلك استُخدمت نتائج بحث ويب طبية موثوقة.';
  const answer = await routedChat(section, plan, [{ role: 'system', content: [
    'أنت المساعد الدراسي الطبي في QMRMed.',
    `أجب باللغة نفسها التي استخدمها الطالب: ${language}.`,
    'افهم المصطلحات الطبية العربية والإنجليزية والاختصارات الطبية على أنها قد تشير إلى المفهوم نفسه.',
    'استخدم عناوين واضحة وقوائم ونقاط وجداول عند الحاجة.',
    sourceInstruction,
    'لا تضف معلومات غير مدعومة بالسياق المسترجع. إذا لم تكن المعلومة موجودة، اذكر ذلك بوضوح.',
    'ممنوع كتابة أي مصدر أو رابط أو URL داخل متن الإجابة؛ سيضيف النظام المصادر المستخدمة برمجيًا.',
    'إذا كان السؤال يطلب Case أو أسئلة وزارية، استخرجها أو لخّصها من المحتوى المسترجع ولا تنشئ سؤالًا وزاريًا من عندك.',
    'هذا مساعد تعليمي وليس بديلًا عن الطبيب أو التشخيص الفردي.',
    `السياق المستخدم للإجابة:\n${context}`,
  ].join('\n\n') }, { role: 'user', content: question }], 0.2);
  if (!webResults.length) return cleanAiAnswer(answer);
  const sources = webResults.map((item, index) => `${index + 1}. ${item.title} — ${item.source ?? 'مصدر طبي'}\n   🔗 ${item.url}`).join('\n\n');
  return `${cleanAiAnswer(answer)}\n\n**المصادر الطبية المستخدمة:**\n${sources}`;
}
