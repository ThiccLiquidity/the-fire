// The live wiring: Neon, the VAPID keys and the keepers' secret from the environment (docs/push.md).
import webpush from 'web-push';
import { createPushServer } from './server.js';
import { neonStore } from './store.js';

let server = null;
function build(env = process.env) {
  const config = { publicKey: env.PUSH_VAPID_PUBLIC || '', privateKey: env.PUSH_VAPID_PRIVATE || '', subject: env.PUSH_VAPID_SUBJECT || 'mailto:hello@omnicardworks.com', sendSecret: env.PUSH_SEND_SECRET || '' };
  const store = env.DATABASE_URL ? neonStore(env.DATABASE_URL) : null;
  if (config.publicKey && config.privateKey) {
    try { webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey); } catch { console.warn(JSON.stringify({ event: 'push-keys-invalid' })); config.privateKey = ''; }
  }
  const send = (s, msg) => webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, msg, { TTL: 3600, urgency: 'high' });
  return createPushServer({ store, config, send });
}
export const handleRequest = (req) => (server ||= build()).handle(req);
