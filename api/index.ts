import { handleMiniAppRequest } from '../src/miniapp.js';

export default async function handler(req: any, res: any) {
  return handleMiniAppRequest(req, res);
}
