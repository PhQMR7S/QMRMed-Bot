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

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[.,!?;:()[\]{}<>"'`~@#$%^&*+=|\\/\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MEDICAL_ALIASES: Record<string, string[]> = {
  'فشل القلب': ['heart failure', 'cardiac failure', 'congestive heart failure', 'CHF'],
  'قصور القلب': ['heart failure', 'cardiac failure', 'congestive heart failure', 'CHF'],
  'احتشاء عضلة القلب': ['myocardial infarction', 'acute myocardial infarction', 'MI', 'heart attack'],
  'جلطة قلبية': ['myocardial infarction', 'acute myocardial infarction', 'MI', 'heart attack'],
  'الذبحة الصدرية': ['angina', 'angina pectoris', 'ischemic chest pain'],
  'ارتفاع ضغط الدم': ['hypertension', 'high blood pressure'],
  'انخفاض ضغط الدم': ['hypotension', 'low blood pressure'],
  'السكري': ['diabetes mellitus', 'diabetes', 'DM'],
  'داء السكري': ['diabetes mellitus', 'diabetes', 'DM'],
  'الحماض الكيتوني السكري': ['diabetic ketoacidosis', 'DKA'],
  'نقص سكر الدم': ['hypoglycemia', 'low blood glucose'],
  'ارتفاع سكر الدم': ['hyperglycemia', 'high blood glucose'],
  'إصابة الكلى الحادة': ['acute kidney injury', 'acute renal injury', 'AKI'],
  'الفشل الكلوي الحاد': ['acute kidney failure', 'acute kidney injury', 'AKI'],
  'المتلازمة النفروزية': ['nephrotic syndrome'],
  'المتلازمة النفريتية': ['nephritic syndrome'],
  'مرض الانسداد الرئوي المزمن': ['chronic obstructive pulmonary disease', 'COPD'],
  'الربو': ['asthma', 'bronchial asthma'],
  'ذات الرئة': ['pneumonia'],
  'الالتهاب الرئوي': ['pneumonia'],
  'الانسداد الرئوي': ['pulmonary embolism', 'PE'],
  'الخثار الوريدي العميق': ['deep vein thrombosis', 'DVT'],
  'الرجفان الأذيني': ['atrial fibrillation', 'AF', 'AFib'],
  'التهاب الشغاف': ['endocarditis', 'infective endocarditis'],
  'التهاب عضلة القلب': ['myocarditis'],
  'التهاب التامور': ['pericarditis'],
  'السكتة الدماغية': ['stroke', 'cerebrovascular accident', 'CVA'],
  'التهاب السحايا': ['meningitis'],
  'التهاب الدماغ': ['encephalitis'],
  'الصرع': ['epilepsy', 'seizure disorder'],
  'فقر الدم': ['anemia', 'anaemia'],
  'فقر الدم بعوز الحديد': ['iron deficiency anemia', 'iron deficiency anaemia'],
  'ابيضاض الدم': ['leukemia', 'leukaemia'],
  'سرطان الثدي': ['breast cancer', 'breast carcinoma'],
  'سرطان الرئة': ['lung cancer', 'lung carcinoma'],
  'قصور الغدة الدرقية': ['hypothyroidism'],
  'فرط نشاط الغدة الدرقية': ['hyperthyroidism'],
  'فرط الدرقية': ['hyperthyroidism', 'thyrotoxicosis'],
  'قصور الدرقية': ['hypothyroidism'],
  'الحمى': ['fever', 'pyrexia'],
  'الإنتان': ['sepsis', 'septic syndrome'],
  'الصدمة الإنتانية': ['septic shock'],
  'الجفاف': ['dehydration'],
  'التهاب البنكرياس': ['pancreatitis', 'acute pancreatitis'],
  'التهاب الكبد': ['hepatitis'],
  'تشمع الكبد': ['cirrhosis', 'liver cirrhosis'],
  'القرحة الهضمية': ['peptic ulcer disease', 'peptic ulcer'],
  'التهاب الزائدة الدودية': ['appendicitis'],
  'التهاب المرارة': ['cholecystitis'],
  'حصى المرارة': ['cholelithiasis', 'gallstones'],
  'التهاب المسالك البولية': ['urinary tract infection', 'UTI'],
  'التهاب المثانة': ['cystitis'],
  'التهاب الكلية والحويضة': ['pyelonephritis'],
  'هشاشة العظام': ['osteoporosis'],
  'التهاب المفاصل الروماتويدي': ['rheumatoid arthritis', 'RA'],
  'الذئبة': ['systemic lupus erythematosus', 'SLE', 'lupus'],
  'مرض باركنسون': ['Parkinson disease', "Parkinson's disease"],
  'الزهايمر': ['Alzheimer disease', "Alzheimer's disease"],
  'الصداع النصفي': ['migraine'],
  'المضادات الحيوية': ['antibiotics', 'antibacterial agents'],
  'المضاد الحيوي': ['antibiotic', 'antibacterial agent'],
  'الدواء': ['drug', 'medication'],
  'الأعراض': ['symptoms', 'clinical manifestations'],
  'التشخيص': ['diagnosis', 'diagnostic'],
  'العلاج': ['treatment', 'management', 'therapy'],
  'الوقاية': ['prevention', 'prophylaxis'],
  'الآلية المرضية': ['pathophysiology', 'pathogenesis'],
  'الوبائيات': ['epidemiology'],
  'عوامل الخطورة': ['risk factors'],
  'المضاعفات': ['complications'],
};

function termsOf(query: string) {
  const raw = query
    .normalize('NFKC')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term, index, all) => all.indexOf(term) === index)
    .slice(0, 12);
  const normalized = raw.map(normalizeText).filter(Boolean);
  const aliases = Object.entries(MEDICAL_ALIASES)
    .filter(([ar]) => normalizeText(query).includes(normalizeText(ar)))
    .flatMap(([, values]) => values);
  return Array.from(new Set([...raw, ...normalized, ...aliases])).slice(0, 40);
}

export function expandMedicalQuery(query: string) {
  const aliases = Object.entries(MEDICAL_ALIASES)
    .filter(([ar]) => normalizeText(query).includes(normalizeText(ar)))
    .flatMap(([, values]) => values);
  return Array.from(new Set([query, ...aliases])).join(' | ');
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

  const normalizedTerms = terms.map(normalizeText).filter((term, index, all) => all.indexOf(term) === index);
  const ranked = chunks
    .map((chunk) => {
      const haystack = normalizeText(`${chunk.title} ${chunk.text}`);
      let score = 0;
      for (const term of normalizedTerms) {
        const normalizedTerm = normalizeText(term);
        if (!normalizedTerm) continue;
        const occurrences = haystack.split(normalizedTerm).length - 1;
        score += occurrences;
        if (normalizeText(chunk.title).includes(normalizedTerm)) score += 5;
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
