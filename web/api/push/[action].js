// /api/push/<action>: web push (docs/push.md): key, subscribe, unsubscribe, send (keepers only).
import { handleRequest } from './_lib/default.js';

export const GET = (request) => handleRequest(request);
export const POST = (request) => handleRequest(request);
