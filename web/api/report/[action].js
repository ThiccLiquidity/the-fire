// /api/report/<action>: tester reports (send, list, status). See _lib/server.js.
import { handleRequest } from './_lib/default.js';

export const GET = (request) => handleRequest(request);
export const POST = (request) => handleRequest(request);
