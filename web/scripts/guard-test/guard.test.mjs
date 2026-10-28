// The wallet gate (src/lib/guard.ts): what the site may ask a wallet to sign, and everything it must refuse.
// Bundled with rolldown (the TypeScript source, as the site uses it). Run: npm run test:guard (from web/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = fileURLToPath(new URL('../../', import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'guard-')), 'guard.mjs');
execFileSync(join(web, 'node_modules/.bin/rolldown'), ['src/lib/guard.ts', '--format', 'esm', '--platform', 'node', '--file', out], { cwd: web, stdio: 'pipe' });
const { checkCall, MAX_APPROVAL } = await import(pathToFileURL(out).href);
const KYBER_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'; // kyber.ts

const dep = JSON.parse(readFileSync(join(web, '../deployments/46630.json'), 'utf8'));
const C = dep.contracts, I = dep.inputs;
const me = '0x1111111111111111111111111111111111111111', thief = '0x2222222222222222222222222222222222222222';
const ok = (call) => assert.doesNotThrow(() => checkCall(call, me, dep));
const blocked = (call) => assert.throws(() => checkCall(call, me, dep), { name: 'Blocked' });

test('the site\'s own calls go through', () => {
  ok({ address: C.FireSale, functionName: 'buy', args: [1n, 0n, 1n, 0n, 0n, 0n, {}] });
  ok({ address: C.FireSale, functionName: 'buyWithEthAll', args: [], value: 10n ** 15n });
  ok({ address: C.FireCards, functionName: 'open', args: [] });
  ok({ address: C.FirePsa, functionName: 'protect', args: [], value: 1n });
  ok({ address: C.FireCredits, functionName: 'suggest', args: ['Theme: x', 1n] });
  ok({ address: C.FireProfiles, functionName: 'setProfile', args: [] });
  ok({ address: C.OpenDrandRouter, functionName: 'fulfill', args: [1n, '0x'] });
  ok({ address: I.PAPER, functionName: 'approve', args: [C.FireSale, 10n ** 18n] });
  ok({ address: I.PLANK, functionName: 'approve', args: [I.V2_ROUTER, 10n ** 24n] });
  ok({ address: I.USDG, functionName: 'approve', args: [KYBER_ROUTER, 5n * 10n ** 6n] });
  ok({ address: I.V2_ROUTER, functionName: 'swapETHForExactTokens', args: [1n, [I.WETH, I.PAPER], me, 0n], value: 1n });
});

test('approvals: never unlimited, never for someone else, never "approve all"', () => {
  blocked({ address: I.PAPER, functionName: 'approve', args: [C.FireSale, MAX_APPROVAL] });
  blocked({ address: I.PAPER, functionName: 'approve', args: [C.FireSale, 2n ** 256n - 1n] });
  blocked({ address: I.PAPER, functionName: 'approve', args: [thief, 1n] });
  blocked({ address: I.PAPER, functionName: 'approve', args: [C.PaperBurner, 1n] }); // ours, but it never takes payments
  blocked({ address: I.PLANK, functionName: 'approve', args: [C.FireCards, 1n] });
  blocked({ address: I.PAPER, functionName: 'increaseAllowance', args: [C.FireSale, 1n] });
  blocked({ address: I.PAPER, functionName: 'permit', args: [] });
  blocked({ address: C.FireCards, functionName: 'setApprovalForAll', args: [thief, true] });
  blocked({ address: C.FirePacks, functionName: 'setApprovalForAll', args: [thief, true] });
});

test('moving coins or cards anywhere is refused', () => {
  blocked({ address: I.PAPER, functionName: 'transfer', args: [thief, 1n] });
  blocked({ address: I.PLANK, functionName: 'transferFrom', args: [me, thief, 1n] });
  blocked({ address: C.FireCards, functionName: 'safeTransferFrom', args: [me, thief, 1n] });
  blocked({ address: C.FireCards, functionName: 'transferFrom', args: [me, thief, 1n] });
  blocked({ address: C.FirePacks, functionName: 'safeTransferFrom', args: [me, thief, 1n, 1n, '0x'] });
  blocked({ address: thief, functionName: 'claim', args: [], value: 10n ** 18n });
  blocked({ address: I.PAPER, functionName: 'approve', args: [C.FireSale, 1n], value: 1n });
});

test('never more than 0.5 ETH in one transaction', () => {
  ok({ address: C.FireSale, functionName: 'buyWithEthAll', args: [], value: 5n * 10n ** 17n });
  blocked({ address: C.FireSale, functionName: 'buyWithEthAll', args: [], value: 5n * 10n ** 17n + 1n });
  blocked({ address: I.V2_ROUTER, functionName: 'swapETHForExactTokens', args: [1n, [I.WETH, I.PAPER], me, 0n], value: 10n ** 18n });
});

test('owner-only and unknown functions on our own contracts are refused', () => {
  blocked({ address: C.FireSale, functionName: 'withdraw', args: [] });
  blocked({ address: C.FireCards, functionName: 'transferOwnership', args: [thief] });
  blocked({ address: C.PaperBurner, functionName: 'burn', args: [] });
});

test('swaps: only PAPER, only into your own wallet', () => {
  blocked({ address: I.V2_ROUTER, functionName: 'swapETHForExactTokens', args: [1n, [I.WETH, I.PAPER], thief, 0n], value: 1n });
  blocked({ address: I.V2_ROUTER, functionName: 'swapETHForExactTokens', args: [1n, [I.WETH, I.PLANK], me, 0n], value: 1n });
  blocked({ address: I.V2_ROUTER, functionName: 'removeLiquidity', args: [] });
  const desc = (o) => ({ srcToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', dstToken: I.PAPER, srcReceivers: [], srcAmounts: [], feeReceivers: [], feeAmounts: [], dstReceiver: me, amount: 5n, minReturnAmount: 1n, flags: 0n, permit: '0x', ...o });
  const kyber = (o, value = 5n) => ({ address: KYBER_ROUTER, functionName: 'swap', args: [{ callTarget: thief, approveTarget: thief, targetData: '0x', desc: desc(o), clientData: '0x' }], value });
  ok(kyber({}));
  blocked(kyber({ dstReceiver: thief }));
  blocked(kyber({ dstToken: I.PLANK }));
  blocked(kyber({ feeReceivers: [thief], feeAmounts: [1n] }));
  blocked(kyber({}, 6n));
  blocked(kyber({ srcToken: thief }, 0n));
});
