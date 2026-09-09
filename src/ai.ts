import { config } from './config.js';

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

export async function answerMedicalQuestion(question: string, context = '') {
  return omniChat([
    {
      role: 'system',
      content: [
        'أنت المساعد الدراسي الطبي في QMRMed.',
        'أجب بالعربية الواضحة، وكن دقيقًا ومختصرًا نسبيًا.',
        'لا تخترع مصادر أو مراجع. إذا لم يكن السياق كافيًا فاذكر ذلك بوضوح.',
        'هذا مساعد تعليمي وليس بديلًا عن الطبيب أو التشخيص الفردي.',
        context ? `السياق المعتمد من QMRMed:\n${context}` : '',
      ].filter(Boolean).join('\n\n'),
    },
    { role: 'user', content: question },
  ]);
}
