// The live wiring: storage, chain and settings from the environment, built once per function instance.
import { readConfig } from './config.js';
import { viemChain } from './chain.js';
import { createGameServer } from './server.js';
import { neonStore } from './store-neon.js';

let server = null;
function build() {
  const config = readConfig(process.env);
  const store = config.databaseUrl ? neonStore(config.databaseUrl) : null;
  let chain = null;
  try {
    if (config.signerKey && config.gamesAddress) chain = viemChain(config);
  } catch {
    console.warn(JSON.stringify({ event: 'chain-config-invalid' })); // never echo the key
  }
  return createGameServer({ store, chain, config });
}
export const handleRequest = (req) => (server ||= build()).handle(req);
