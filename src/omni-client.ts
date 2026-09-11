import { config } from './config.js';

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
        headers: {
          authorization: `Bearer ${config.OMNIROUTE_API_KEY}`,
          'content-type': 'application/json',
        },
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
