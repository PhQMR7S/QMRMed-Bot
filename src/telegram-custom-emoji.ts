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
    .filter((entity): entity is MessageEntity & { custom_emoji_id: string } => entity.type === 'custom_emoji' && typeof entity.custom_emoji_id === 'string')
    .map(entity => ({
      customEmojiId: entity.custom_emoji_id,
      offset: entity.offset,
      length: entity.length,
      fallbackText: Array.from(text).slice(entity.offset, entity.offset + entity.length).join(''),
      source: 'message_text' as const,
    }));
}

export function logCapturedCustomEmoji(emoji: CapturedCustomEmoji, telegramUserId?: number) {
  console.log(JSON.stringify({ event: 'telegram_custom_emoji_captured', telegramUserId: telegramUserId ?? null, ...emoji }));
}

type EmojiEntry = { id: string; alt: string; set: string; animated: boolean; video: boolean };
type Catalog = { preferred: Map<string, EmojiEntry>; total: number };

const SETS = ['TgAndroidIcons', 'IconsInTg', 'NewsEmoji', 'CenterOfEmoji61682288'] as const;
const SET_PRIORITY: Record<string, number> = { TgAndroidIcons: 0, IconsInTg: 1, NewsEmoji: 2, CenterOfEmoji61682288: 3 };
const PREFERRED_BY_FALLBACK: Record<string, string> = {
  '🏠': 'TgAndroidIcons', '👤': 'TgAndroidIcons', '⚙️': 'TgAndroidIcons', '⬅️': 'TgAndroidIcons', '➡️': 'TgAndroidIcons', '🔙': 'TgAndroidIcons', '🔒': 'TgAndroidIcons', '🔓': 'TgAndroidIcons', '📊': 'TgAndroidIcons', '🎯': 'TgAndroidIcons', '💎': 'TgAndroidIcons', '🎁': 'TgAndroidIcons',
  '📁': 'IconsInTg', '📄': 'IconsInTg', '📎': 'IconsInTg', '📝': 'IconsInTg', '🔍': 'IconsInTg', '🛠️': 'IconsInTg', '🧰': 'IconsInTg',
  '🧠': 'CenterOfEmoji61682288', '🩺': 'CenterOfEmoji61682288', '📚': 'CenterOfEmoji61682288', '🎓': 'CenterOfEmoji61682288', '🔬': 'CenterOfEmoji61682288', '🧪': 'CenterOfEmoji61682288', '💡': 'CenterOfEmoji61682288', '❓': 'CenterOfEmoji61682288',
  '📰': 'NewsEmoji', '📢': 'NewsEmoji', '🔔': 'NewsEmoji', '🚨': 'NewsEmoji', '⚠️': 'NewsEmoji', 'ℹ️': 'NewsEmoji', '✅': 'NewsEmoji', '❌': 'NewsEmoji', '⏳': 'NewsEmoji', '🔄': 'NewsEmoji',
};

let catalogPromise: Promise<Catalog> | undefined;

function utf16Length(value: string) { return Array.from(value).reduce((n, ch) => n + ch.length, 0); }
function utf16Offset(text: string, index: number) { return Array.from(text).slice(0, index).reduce((n, ch) => n + ch.length, 0); }

async function loadCatalog(bot: Bot): Promise<Catalog> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const preferred = new Map<string, EmojiEntry>();
    let total = 0;
    for (const setName of SETS) {
      try {
        const result = await bot.api.raw.getStickerSet({ name: setName });
        const entries: EmojiEntry[] = (result.stickers ?? [])
          .filter((sticker: any) => sticker.type === 'custom_emoji' && typeof sticker.custom_emoji_id === 'string' && typeof sticker.emoji === 'string')
          .map((sticker: any) => ({ id: sticker.custom_emoji_id, alt: sticker.emoji.trim(), set: setName, animated: Boolean(sticker.is_animated), video: Boolean(sticker.is_video) }))
          .filter(entry => entry.alt.length > 0);
        total += entries.length;
        console.log(JSON.stringify({ event: 'telegram_custom_emoji_set_loaded', set: setName, count: entries.length, animated: entries.filter(e => e.animated).length, video: entries.filter(e => e.video).length }));
        for (const entry of entries) {
          const wanted = PREFERRED_BY_FALLBACK[entry.alt];
          if (wanted === setName || !preferred.has(entry.alt) || SET_PRIORITY[setName] < SET_PRIORITY[preferred.get(entry.alt)!.set]) preferred.set(entry.alt, entry);
        }
      } catch (error) {
        console.warn(JSON.stringify({ event: 'telegram_custom_emoji_set_failed', set: setName, error: error instanceof Error ? error.message : String(error) }));
      }
    }
    console.log(JSON.stringify({ event: 'telegram_custom_emoji_catalog_ready', sets: SETS.length, total }));
    return { preferred, total };
  })();
  return catalogPromise;
}

function addEntities(text: string, existing: any[] | undefined, catalog: Catalog) {
  const entities = Array.isArray(existing) ? [...existing] : [];
  let codePointIndex = 0;
  for (const char of Array.from(text)) {
    const entry = catalog.preferred.get(char);
    if (entry) {
      const offset = utf16Offset(text, codePointIndex);
      const length = utf16Length(char);
      const overlaps = entities.some(entity => offset < (entity.offset ?? 0) + (entity.length ?? 0) && offset + length > (entity.offset ?? 0));
      if (!overlaps) entities.push({ type: 'custom_emoji', offset, length, custom_emoji_id: entry.id });
    }
    codePointIndex += 1;
  }
  return entities;
}

function decorateKeyboard(replyMarkup: any, catalog: Catalog) {
  if (!replyMarkup?.inline_keyboard) return replyMarkup;
  return { ...replyMarkup, inline_keyboard: replyMarkup.inline_keyboard.map((row: any[]) => row.map((button: any) => {
    if (!button?.text || button.icon_custom_emoji_id) return button;
    const match = Array.from(button.text as string).find(char => catalog.preferred.has(char));
    const entry = match ? catalog.preferred.get(match) : undefined;
    if (!entry) return button;
    const text = (button.text as string).replace(match, '').trimStart();
    return { ...button, text: text || match, icon_custom_emoji_id: entry.id };
  })) };
}

function transformPayload(method: string, payload: any, catalog: Catalog) {
  const next = { ...payload };
  if (typeof next.text === 'string') next.entities = addEntities(next.text, next.entities, catalog);
  if (typeof next.caption === 'string') next.caption_entities = addEntities(next.caption, next.caption_entities, catalog);
  if (next.reply_markup) next.reply_markup = decorateKeyboard(next.reply_markup, catalog);
  if (method === 'sendMediaGroup' && Array.isArray(next.media)) {
    next.media = next.media.map((item: any) => typeof item.caption === 'string' ? { ...item, caption_entities: addEntities(item.caption, item.caption_entities, catalog) } : item);
  }
  return next;
}

export function installTelegramCustomEmoji(bot: Bot) {
  bot.api.config.use(async (prev, method, payload, signal) => prev(method, transformPayload(method, payload, await loadCatalog(bot)), signal));
}

export async function preloadTelegramCustomEmojiCatalog(bot: Bot) { await loadCatalog(bot); }
