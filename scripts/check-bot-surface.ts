import { Bot } from 'grammy';
import { config } from '../src/config.js';

const bot = new Bot(config.BOT_TOKEN);

const expectedCommands = [
  'start','help','study','search','ai','questions','ministerial','exams',
  'progress','plans','trial','account','settings','about','cancel','admin',
] as const;

const me = await bot.api.getMe();
if (!me.is_bot) throw new Error('Telegram identity is not a bot');
const commands = await bot.api.getMyCommands();
const actual = new Set(commands.map((c) => c.command));
const missing = expectedCommands.filter((c) => !actual.has(c));
if (missing.length) throw new Error(`Missing Telegram commands: ${missing.join(', ')}`);
console.log(`Telegram OK: @${me.username ?? 'unknown'}; ${commands.length} commands registered`);
