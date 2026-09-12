import { Bot } from 'grammy';
import { registerFileAiAskBridge } from './file-ai-ask-bridge.js';
import { registerFileAiV3Handlers } from './file-ai-v3.js';
import { startMiniApp } from './miniapp.js';

startMiniApp();

const originalStart = Bot.prototype.start as (...args: any[]) => Promise<void>;
const registered = new WeakSet<object>();

Bot.prototype.start = function patchedStart(this: Bot, ...args: any[]) {
  if (!registered.has(this)) {
    registered.add(this);
    registerFileAiAskBridge(this);
    registerFileAiV3Handlers(this);
  }
  return originalStart.apply(this, args);
};
