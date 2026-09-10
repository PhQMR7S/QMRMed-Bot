import { Bot } from 'grammy';
import { registerFileAiHandlers } from './file-ai.js';

const originalStart = Bot.prototype.start;
const registered = new WeakSet<object>();

Bot.prototype.start = function patchedStart(this: Bot, ...args: Parameters<typeof originalStart>) {
  if (!registered.has(this)) {
    registered.add(this);
    registerFileAiHandlers(this);
  }
  return originalStart.apply(this, args);
};
