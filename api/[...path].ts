import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMiniAppRequest } from '../src/miniapp.js';

// Vercel's filesystem router needs a catch-all function for the Mini App's
// nested API endpoints: /api/me, /api/plans, /api/archive, /api/archive/:id.
// Keep the request path intact so handleMiniAppRequest can dispatch it safely.
export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleMiniAppRequest(req, res);
}
