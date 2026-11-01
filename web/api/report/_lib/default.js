// The live wiring: Neon (DATABASE_URL) and the owner's key (REPORTS_KEY, set in Vercel; at least 16 characters).
import { createReportServer } from './server.js';
import { neonStore } from './store.js';

let server = null;
const build = (env = process.env) => createReportServer({ store: env.DATABASE_URL ? neonStore(env.DATABASE_URL) : null, key: env.REPORTS_KEY || '' });
export const handleRequest = (req) => (server ||= build()).handle(req);
