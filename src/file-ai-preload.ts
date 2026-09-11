import { Bot } from 'grammy';
import { registerFileAiHandlers } from './file-ai.js';
import { startMiniApp } from './miniapp.js';

startMiniApp();

const originalStart = Bot.prototype.start as (...args: any[]) => Promise<void>;
const registered = new WeakSet<object>();

Bot.prototype.start = function patchedStart(this: Bot, ...args: any[]) {
  if (!registered.has(this)) {
    registered.add(this);
    registerFileAiHandlers(this);
  }
  return originalStart.apply(this, args);
};
