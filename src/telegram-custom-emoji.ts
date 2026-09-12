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
  console.log(JSON.stringify({
    event: 'telegram_custom_emoji_captured',
    telegramUserId: telegramUserId ?? null,
    ...emoji,
  }));
}
