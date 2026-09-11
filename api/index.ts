import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMiniAppRequest } from '../src/miniapp.js';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleMiniAppRequest(req, res);
}
