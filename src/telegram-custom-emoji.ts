import type { Bot } from 'grammy';
import type { MessageEntity } from 'grammy/types';

export type CapturedCustomEmoji = {
  customEmojiId: string;
  offset: number;
  length: number;
  fallbackText: string;
  source: 'message_text';
};

export function captureCustomEmojiEntities(text: string, entities?: MessageEntity[]): CapturedCustomEmoji[] {
  if (!entities?.length) return [];

  return entities
    .filter(
      (entity): entity is MessageEntity & { custom_emoji_id: string } =>
        entity.type === 'custom_emoji' && typeof entity.custom_emoji_id === 'string',
    )
    .map(entity => ({
      customEmojiId: entity.custom_emoji_id,
      offset: entity.offset,
      length: entity.length,
      fallbackText: text.slice(entity.offset, entity.offset + entity.length),
      source: 'message_text' as const,
    }));
}

export function logCapturedCustomEmoji(emoji: CapturedCustomEmoji, telegramUserId?: number) {
  console.log(JSON.stringify({ event: 'telegram_custom_emoji_captured', telegramUserId: telegramUserId ?? null, ...emoji }));
}

type EmojiEntry = {
  id: string;
  alt: string;
  set: string;
  animated: boolean;
  video: boolean;
};

type Catalog = {
  preferred: Map<string, EmojiEntry>;
  normalized: Map<string, EmojiEntry>;
  matches: string[];
  total: number;
};

const SETS = ['TgAndroidIcons', 'IconsInTg', 'NewsEmoji', 'CenterOfEmoji61682288'] as const;

const SET_PRIORITY: Record<string, number> = {
  TgAndroidIcons: 0,
  IconsInTg: 1,
  NewsEmoji: 2,
  CenterOfEmoji61682288: 3,
};

const PREFERRED_BY_FALLBACK: Record<string, string> = {
  '🏠': 'TgAndroidIcons', '👤': 'TgAndroidIcons', '⚙️': 'TgAndroidIcons', '⚙': 'TgAndroidIcons',
  '⬅️': 'TgAndroidIcons', '⬅': 'TgAndroidIcons', '➡️': 'TgAndroidIcons', '➡': 'TgAndroidIcons',
  '🔙': 'TgAndroidIcons', '🔒': 'TgAndroidIcons', '🔓': 'TgAndroidIcons', '📊': 'TgAndroidIcons',
  '🎯': 'TgAndroidIcons', '💎': 'TgAndroidIcons', '🎁': 'TgAndroidIcons',
  '📁': 'IconsInTg', '📄': 'IconsInTg', '📎': 'IconsInTg', '📝': 'IconsInTg', '🔍': 'IconsInTg',
  '🛠️': 'IconsInTg', '🛠': 'IconsInTg', '🧰': 'IconsInTg',
  '🧠': 'CenterOfEmoji61682288', '🩺': 'CenterOfEmoji61682288', '📚': 'CenterOfEmoji61682288',
  '🎓': 'CenterOfEmoji61682288', '🔬': 'CenterOfEmoji61682288', '🧪': 'CenterOfEmoji61682288',
  '💡': 'CenterOfEmoji61682288', '❓': 'CenterOfEmoji61682288',
  '📰': 'NewsEmoji', '📢': 'NewsEmoji', '🔔': 'NewsEmoji', '🚨': 'NewsEmoji',
  '⚠️': 'NewsEmoji', '⚠': 'NewsEmoji', 'ℹ️': 'NewsEmoji', 'ℹ': 'NewsEmoji',
  '✅': 'NewsEmoji', '❌': 'NewsEmoji', '⏳': 'NewsEmoji', '🔄': 'NewsEmoji',
};

let catalogPromise: Promise<Catalog> | undefined;

// Telegram's emoji fallback can contain presentation selectors (U+FE0E/U+FE0F).
// Matching ignores those selectors, while the exact catalog fallback is retained
// in the outgoing text so Telegram receives a valid custom-emoji fallback.
function normalizeEmoji(value: string): string {
  return value.replace(/[\uFE0E\uFE0F]/g, '');
}

function utf16Offset(text: string, codePointIndex: number): number {
  return Array.from(text).slice(0, codePointIndex).join('').length;
}

function isOverlapping(entity: MessageEntity, offset: number, length: number): boolean {
  return offset < entity.offset + entity.length && offset + length > entity.offset;
}

function chooseEntry(current: EmojiEntry | undefined, candidate: EmojiEntry): EmojiEntry {
  if (!current) return candidate;

  const currentWanted = PREFERRED_BY_FALLBACK[current.alt] ?? PREFERRED_BY_FALLBACK[normalizeEmoji(current.alt)];
  const candidateWanted = PREFERRED_BY_FALLBACK[candidate.alt] ?? PREFERRED_BY_FALLBACK[normalizeEmoji(candidate.alt)];

  if (candidateWanted === candidate.set && currentWanted !== current.set) return candidate;
  if (currentWanted === current.set && candidateWanted !== candidate.set) return current;
  return SET_PRIORITY[candidate.set] < SET_PRIORITY[current.set] ? candidate : current;
}

async function loadCatalog(bot: Bot): Promise<Catalog> {
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    const preferred = new Map<string, EmojiEntry>();
    const normalized = new Map<string, EmojiEntry>();
    let total = 0;

    for (const setName of SETS) {
      try {
        const result = await bot.api.raw.getStickerSet({ name: setName });
        const entries: EmojiEntry[] = (result.stickers ?? [])
          .filter((sticker: any) => sticker.type === 'custom_emoji' && typeof sticker.custom_emoji_id === 'string' && typeof sticker.emoji === 'string')
          .map((sticker: any) => ({
            id: sticker.custom_emoji_id,
            alt: sticker.emoji.trim(),
            set: setName,
            animated: Boolean(sticker.is_animated),
            video: Boolean(sticker.is_video),
          }))
          .filter(entry => entry.alt.length > 0);

        total += entries.length;
        console.log(JSON.stringify({ event: 'telegram_custom_emoji_set_loaded', set: setName, count: entries.length, animated: entries.filter(e => e.animated).length, video: entries.filter(e => e.video).length }));

        for (const entry of entries) {
          preferred.set(entry.alt, chooseEntry(preferred.get(entry.alt), entry));
          const normalizedKey = normalizeEmoji(entry.alt);
          normalized.set(normalizedKey, chooseEntry(normalized.get(normalizedKey), entry));
        }
      } catch (error) {
        console.warn(JSON.stringify({ event: 'telegram_custom_emoji_set_failed', set: setName, error: error instanceof Error ? error.message : String(error) }));
      }
    }

    const matches = [...normalized.keys()].sort((a, b) => b.length - a.length);
    console.log(JSON.stringify({ event: 'telegram_custom_emoji_catalog_ready', sets: SETS.length, total, preferred: preferred.size, normalized: normalized.size }));
    return { preferred, normalized, matches, total };
  })();

  return catalogPromise;
}

function findEntry(text: string, offset: number, catalog: Catalog): { source: string; entry: EmojiEntry } | undefined {
  const remaining = text.slice(offset);
  const match = catalog.matches.find(candidate => normalizeEmoji(remaining).startsWith(candidate));
  if (!match) return undefined;
  const entry = catalog.normalized.get(match);
  if (!entry) return undefined;
  const source = remaining.slice(0, Array.from(remaining).findIndex((_, i) => normalizeEmoji(Array.from(remaining).slice(0, i + 1).join('')) === match) + 1 || 1);
  return { source, entry };
}

function addEntities(text: string, existing: MessageEntity[] | undefined, catalog: Catalog): { text: string; entities: MessageEntity[] } {
  const entities: MessageEntity[] = Array.isArray(existing) ? [...existing] : [];
  const codePoints = Array.from(text);
  const replacements: Array<{ start: number; end: number; value: string; entry: EmojiEntry }> = [];

  for (let index = 0; index < codePoints.length; index += 1) {
    const offset = utf16Offset(text, index);
    const found = findEntry(text, offset, catalog);
    if (!found) continue;

    const sourceLength = found.source.length;
    const entryLength = found.entry.alt.length;
    if (!entities.some(entity => isOverlapping(entity, offset, sourceLength))) {
      replacements.push({ start: offset, end: offset + sourceLength, value: found.entry.alt, entry: found.entry });
    }
    index += Array.from(found.source).length - 1;
  }

  // Apply replacements from right to left so offsets remain valid while the
  // outgoing fallback is canonicalized to the sticker's actual alt text.
  let nextText = text;
  for (let i = replacements.length - 1; i >= 0; i -= 1) {
    const replacement = replacements[i];
    nextText = nextText.slice(0, replacement.start) + replacement.value + nextText.slice(replacement.end);
  }

  for (const replacement of replacements) {
    const length = replacement.value.length;
    if (!entities.some(entity => isOverlapping(entity, replacement.start, length))) {
      entities.push({ type: 'custom_emoji', offset: replacement.start, length, custom_emoji_id: replacement.entry.id });
    }
  }

  return { text: nextText, entities };
}

function decorateKeyboard(replyMarkup: any, catalog: Catalog) {
  if (!replyMarkup?.inline_keyboard) return replyMarkup;
  return {
    ...replyMarkup,
    inline_keyboard: replyMarkup.inline_keyboard.map((row: any[]) => row.map((button: any) => {
      if (!button?.text || button.icon_custom_emoji_id) return button;
      const normalizedText = normalizeEmoji(button.text as string);
      const match = catalog.matches.find(candidate => normalizedText.includes(candidate));
      const entry = match ? catalog.normalized.get(match) : undefined;
      if (!match || !entry) return button;
      const sourceIndex = normalizedText.indexOf(match);
      const originalParts = Array.from(button.text as string);
      let consumed = 0;
      let end = 0;
      for (const part of originalParts) {
        if (normalizeEmoji(originalParts.slice(0, end + 1).join('')).length > sourceIndex + match.length) break;
        consumed += part.length;
        end += 1;
        if (normalizeEmoji(originalParts.slice(0, end).join('')).length >= sourceIndex + match.length) break;
      }
      const before = (button.text as string).slice(0, sourceIndex);
      const after = (button.text as string).slice(consumed);
      return { ...button, text: `${before}${after}`.trim(), icon_custom_emoji_id: entry.id };
    })),
  };
}

function transformPayload(method: string, payload: any, catalog: Catalog) {
  const next = { ...payload };
  if (typeof next.text === 'string') {
    const transformed = addEntities(next.text, next.entities, catalog);
    next.text = transformed.text;
    next.entities = transformed.entities;
  }
  if (typeof next.caption === 'string') {
    const transformed = addEntities(next.caption, next.caption_entities, catalog);
    next.caption = transformed.text;
    next.caption_entities = transformed.entities;
  }
  if (next.reply_markup) next.reply_markup = decorateKeyboard(next.reply_markup, catalog);
  if (method === 'sendMediaGroup' && Array.isArray(next.media)) {
    next.media = next.media.map((item: any) => {
      if (typeof item.caption !== 'string') return item;
      const transformed = addEntities(item.caption, item.caption_entities, catalog);
      return { ...item, caption: transformed.text, caption_entities: transformed.entities };
    });
  }
  return next;
}

export function installTelegramCustomEmoji(bot: Bot) {
  bot.api.config.use(async (prev, method, payload, signal) => prev(method, transformPayload(method, payload, await loadCatalog(bot)), signal));
}

export async function preloadTelegramCustomEmojiCatalog(bot: Bot) {
  await loadCatalog(bot);
}
