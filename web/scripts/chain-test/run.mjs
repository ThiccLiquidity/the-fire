// One command: npm run test:chain. Builds chain.test.ts (with the layer it imports) for node, starts a local chain
// (setup.mjs), runs the test against it, stops the chain. Needs Foundry (anvil, forge) and the contracts built.
import { build } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setupChain } from "./setup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, "../..");
const OUT = resolve(WEB, "dist-chaintest");

await build({
  root: WEB, logLevel: "warn", configFile: false,
  build: { ssr: resolve(here, "chain.test.ts"), outDir: OUT, emptyOutDir: true, target: "node20", minify: false, rollupOptions: { output: { format: "es", entryFileNames: "chain.test.mjs" } } },
});

const t0 = Date.now();
console.log("local chain: deploying (anvil, DevStack, the deploy scripts, Series 7)");
// Everyone: 3 per wallet for its first 10 minutes, then no limit (FireGroups.limitFor), so the test buys past it
const ctx = await setupChain({ log: (m) => console.log(`  ${m}`), everyone: { perWallet: 3, limitFor: 600 } });
let code = 0;
try {
  const { runTest } = await import(pathToFileURL(resolve(OUT, "chain.test.mjs")).href);
  await runTest(ctx);
  console.log(`PASS in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} catch (e) {
  console.error(`\nFAIL: ${e?.stack ?? e}`);
  code = 1;
} finally {
  ctx.stop();
}
process.exit(code);
