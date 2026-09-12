import type { Bot } from 'grammy';
import type { MessageEntity } from 'grammy/types';

type EmojiEntry = { id: string; alt: string; set: string; animated: boolean; video: boolean };
type Catalog = { normalized: Map<string, EmojiEntry>; matches: string[]; total: number };
type TextMatch = { start: number; end: number; entry: EmojiEntry };

export type CapturedCustomEmoji = { customEmojiId: string; offset: number; length: number; fallbackText: string; source: 'message_text' };

export function captureCustomEmojiEntities(text: string, entities?: MessageEntity[]): CapturedCustomEmoji[] {
  if (!entities?.length) return [];
  return entities.filter((e): e is MessageEntity & { custom_emoji_id: string } => e.type === 'custom_emoji' && typeof e.custom_emoji_id === 'string').map(e => ({ customEmojiId: e.custom_emoji_id, offset: e.offset, length: e.length, fallbackText: text.slice(e.offset, e.offset + e.length), source: 'message_text' }));
}

export function logCapturedCustomEmoji(emoji: CapturedCustomEmoji, telegramUserId?: number) {
  console.log(JSON.stringify({ event: 'telegram_custom_emoji_captured', telegramUserId: telegramUserId ?? null, ...emoji }));
}

const SETS = ['TgAndroidIcons', 'IconsInTg', 'NewsEmoji', 'CenterOfEmoji61682288'] as const;
const SET_PRIORITY: Record<string, number> = { TgAndroidIcons: 0, IconsInTg: 1, NewsEmoji: 2, CenterOfEmoji61682288: 3 };
const PREFERRED_BY_FALLBACK: Record<string, string> = {
  '🏠': 'TgAndroidIcons', '👤': 'TgAndroidIcons', '⚙️': 'TgAndroidIcons', '⚙': 'TgAndroidIcons', '⬅️': 'TgAndroidIcons', '⬅': 'TgAndroidIcons', '➡️': 'TgAndroidIcons', '➡': 'TgAndroidIcons', '🔙': 'TgAndroidIcons', '🔒': 'TgAndroidIcons', '🔓': 'TgAndroidIcons', '📊': 'TgAndroidIcons', '🎯': 'TgAndroidIcons', '💎': 'TgAndroidIcons', '🎁': 'TgAndroidIcons',
  '📁': 'IconsInTg', '📄': 'IconsInTg', '📎': 'IconsInTg', '📝': 'IconsInTg', '🔍': 'IconsInTg', '🛠️': 'IconsInTg', '🛠': 'IconsInTg', '🧰': 'IconsInTg',
  '🧠': 'CenterOfEmoji61682288', '🩺': 'CenterOfEmoji61682288', '📚': 'CenterOfEmoji61682288', '🎓': 'CenterOfEmoji61682288', '🔬': 'CenterOfEmoji61682288', '🧪': 'CenterOfEmoji61682288', '💡': 'CenterOfEmoji61682288', '❓': 'CenterOfEmoji61682288',
  '📰': 'NewsEmoji', '📢': 'NewsEmoji', '🔔': 'NewsEmoji', '🚨': 'NewsEmoji', '⚠️': 'NewsEmoji', '⚠': 'NewsEmoji', 'ℹ️': 'NewsEmoji', 'ℹ': 'NewsEmoji', '✅': 'NewsEmoji', '❌': 'NewsEmoji', '⏳': 'NewsEmoji', '🔄': 'NewsEmoji',
};
let catalogPromise: Promise<Catalog> | undefined;

function normalizeEmoji(value: string) { return value.replace(/[\uFE0E\uFE0F]/g, ''); }
function utf16Offset(text: string, index: number) { return Array.from(text).slice(0, index).join('').length; }
function overlaps(entity: MessageEntity, start: number, length: number) { return start < entity.offset + entity.length && start + length > entity.offset; }

function chooseEntry(current: EmojiEntry | undefined, candidate: EmojiEntry) {
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
    const normalized = new Map<string, EmojiEntry>(); let total = 0;
    for (const setName of SETS) {
      try {
        const result = await bot.api.raw.getStickerSet({ name: setName });
        const entries: EmojiEntry[] = (result.stickers ?? []).filter((s: any) => s.type === 'custom_emoji' && typeof s.custom_emoji_id === 'string' && typeof s.emoji === 'string').map((s: any) => ({ id: s.custom_emoji_id, alt: s.emoji.trim(), set: setName, animated: Boolean(s.is_animated), video: Boolean(s.is_video) })).filter(e => e.alt.length > 0);
        total += entries.length;
        console.log(JSON.stringify({ event: 'telegram_custom_emoji_set_loaded', set: setName, count: entries.length, animated: entries.filter(e => e.animated).length, video: entries.filter(e => e.video).length }));
        for (const entry of entries) normalized.set(normalizeEmoji(entry.alt), chooseEntry(normalized.get(normalizeEmoji(entry.alt)), entry));
      } catch (error) { console.warn(JSON.stringify({ event: 'telegram_custom_emoji_set_failed', set: setName, error: error instanceof Error ? error.message : String(error) })); }
    }
    const matches = [...normalized.keys()].sort((a, b) => b.length - a.length);
    console.log(JSON.stringify({ event: 'telegram_custom_emoji_catalog_ready', sets: SETS.length, total, preferred: normalized.size, normalized: normalized.size }));
    return { normalized, matches, total };
  })();
  return catalogPromise;
}

function findMatch(text: string, start: number, catalog: Catalog): TextMatch | undefined {
  const remaining = text.slice(start); const normalizedRemaining = normalizeEmoji(remaining);
  const key = catalog.matches.find(candidate => normalizedRemaining.startsWith(candidate));
  if (!key) return undefined;
  const entry = catalog.normalized.get(key); if (!entry) return undefined;
  let normalizedConsumed = ''; let count = 0;
  for (const point of Array.from(remaining)) { normalizedConsumed += normalizeEmoji(point); count++; if (normalizedConsumed.length >= key.length) break; }
  if (normalizedConsumed !== key) return undefined;
  const source = Array.from(remaining).slice(0, count).join('');
  return { start, end: start + source.length, entry };
}

function addEntities(text: string, existing: MessageEntity[] | undefined, catalog: Catalog): { text: string; entities: MessageEntity[] } {
  const entities = Array.isArray(existing) ? [...existing] : [];
  const found: TextMatch[] = [];
  const points = Array.from(text);
  for (let i = 0; i < points.length; i++) {
    const match = findMatch(text, utf16Offset(text, i), catalog); if (!match) continue;
    if (!entities.some(e => overlaps(e, match.start, match.end - match.start))) found.push(match);
    i += Array.from(text.slice(match.start, match.end)).length - 1;
  }
  let nextText = text;
  for (let i = found.length - 1; i >= 0; i--) {
    const m = found[i]; nextText = nextText.slice(0, m.start) + m.entry.alt + nextText.slice(m.end);
  }
  for (const entity of entities) {
    const shift = found.reduce((sum, m) => entity.offset >= m.end ? sum + m.entry.alt.length - (m.end - m.start) : sum, 0);
    entity.offset += shift;
  }
  for (const m of found) {
    const shift = found.filter(other => other.start < m.start).reduce((sum, other) => sum + other.entry.alt.length - (other.end - other.start), 0);
    entities.push({ type: 'custom_emoji', offset: m.start + shift, length: m.entry.alt.length, custom_emoji_id: m.entry.id });
  }
  return { text: nextText, entities };
}

function decorateKeyboard(markup: any, catalog: Catalog) {
  if (!markup?.inline_keyboard) return markup;
  return { ...markup, inline_keyboard: markup.inline_keyboard.map((row: any[]) => row.map((button: any) => {
    if (!button?.text || button.icon_custom_emoji_id) return button;
    const match = Array.from(button.text as string).map((_, i) => findMatch(button.text as string, utf16Offset(button.text as string, i), catalog)).find(Boolean) as TextMatch | undefined;
    if (!match) return button;
    return { ...button, text: ((button.text as string).slice(0, match.start) + (button.text as string).slice(match.end)).trim(), icon_custom_emoji_id: match.entry.id };
  })) };
}

function transformPayload(method: string, payload: any, catalog: Catalog) {
  const next = { ...payload };
  if (typeof next.text === 'string') { const x = addEntities(next.text, next.entities, catalog); next.text = x.text; next.entities = x.entities; }
  if (typeof next.caption === 'string') { const x = addEntities(next.caption, next.caption_entities, catalog); next.caption = x.text; next.caption_entities = x.entities; }
  if (next.reply_markup) next.reply_markup = decorateKeyboard(next.reply_markup, catalog);
  if (method === 'sendMediaGroup' && Array.isArray(next.media)) next.media = next.media.map((item: any) => { if (typeof item.caption !== 'string') return item; const x = addEntities(item.caption, item.caption_entities, catalog); return { ...item, caption: x.text, caption_entities: x.entities }; });
  return next;
}

export function installTelegramCustomEmoji(bot: Bot) { bot.api.config.use(async (prev, method, payload, signal) => prev(method, transformPayload(method, payload, await loadCatalog(bot)), signal)); }
export async function preloadTelegramCustomEmojiCatalog(bot: Bot) { await loadCatalog(bot); }
