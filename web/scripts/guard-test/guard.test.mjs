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
// the liquidity contract (LiquidityBurner), standing in until the testnet is redeployed with it
dep.contracts.LiquidityBurner ??= '0x3333333333333333333333333333333333333333';
dep.contracts.FireMarket ??= '0x4444444444444444444444444444444444444444'; // the market, until the redeploy
const C = dep.contracts, I = dep.inputs;
const me = '0x1111111111111111111111111111111111111111', thief = '0x2222222222222222222222222222222222222222';
const ok = (call) => assert.doesNotThrow(() => checkCall(call, me, dep));
const blocked = (call) => assert.throws(() => checkCall(call, me, dep), { name: 'Blocked' });

test('the site\'s own calls go through', () => {
  ok({ address: C.FireSale, functionName: 'buy', args: [1n, 0n, 1n, 0n, 0n, 0n, {}] });
  ok({ address: C.FireSale, functionName: 'buyWithEthAll', args: [1n, 0n, 1n, 10n ** 14n, {}], value: 10n ** 15n });
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

test('the market: "approve all" only for the market, buys only at the listed price', () => {
  const E = 10n ** 18n;
  ok({ address: C.FireCards, functionName: 'setApprovalForAll', args: [C.FireMarket, true] });
  ok({ address: C.FirePacks, functionName: 'setApprovalForAll', args: [C.FireMarket, false] });
  blocked({ address: C.FireCards, functionName: 'setApprovalForAll', args: [C.FireSale, true] }); // ours, but not the market
  blocked({ address: C.FireCards, functionName: 'setApprovalForAll', args: [C.FireMarket, true], value: 1n });
  ok({ address: C.FireMarket, functionName: 'listCard', args: [1n, E] });
  ok({ address: C.FireMarket, functionName: 'buyCard', args: [1n, 2n * E], value: 2n * E }); // over MAX_ETH: a market buy may
  blocked({ address: C.FireMarket, functionName: 'buyCard', args: [1n, E], value: 2n * E }); // not the listed price
  blocked({ address: C.FireMarket, functionName: 'buyCard', args: [1n, 11n * E], value: 11n * E }); // over MARKET_MAX_ETH
  ok({ address: C.FireMarket, functionName: 'buyPacks', args: [3n, 2n, E / 10n], value: E / 5n });
  blocked({ address: C.FireMarket, functionName: 'buyPacks', args: [3n, 2n, E / 10n], value: E / 10n });
  blocked({ address: C.FireMarket, functionName: 'listCard', args: [1n, E], value: 1n }); // nothing sent with a listing
  ok({ address: C.FireMarket, functionName: 'cancelAll', args: [] });
  blocked({ address: C.FireSale, functionName: 'buy', args: [], value: 2n * E }); // the market's cap is only the market's
  // offers: WETH wrapped and approved to the market (capped), nothing sent with an offer or an accept
  ok({ address: I.WETH, functionName: 'deposit', args: [], value: 2n * E });
  blocked({ address: I.WETH, functionName: 'deposit', args: [], value: 11n * E });
  ok({ address: I.WETH, functionName: 'withdraw', args: [E] });
  blocked({ address: I.WETH, functionName: 'transfer', args: [thief, E] });
  ok({ address: I.WETH, functionName: 'approve', args: [C.FireMarket, 2n * E] });
  blocked({ address: I.WETH, functionName: 'approve', args: [C.FireMarket, MAX_APPROVAL] });
  ok({ address: C.FireMarket, functionName: 'makeOffer', args: [0, 1n, E, 1n, 1n] });
  ok({ address: C.FireMarket, functionName: 'acceptOffer', args: [1n, 1n, 1n, E] });
  blocked({ address: C.FireMarket, functionName: 'acceptOffer', args: [1n, 1n, 1n, E], value: 1n });
  blocked({ address: I.PLANK, functionName: 'deposit', args: [], value: 1n }); // wrapping is WETH's alone
});

test('approvals: never unlimited, never for someone else, never "approve all"', () => {
  blocked({ address: I.PAPER, functionName: 'approve', args: [C.FireSale, MAX_APPROVAL] });
  blocked({ address: I.PAPER, functionName: 'approve', args: [C.FireSale, 2n ** 256n - 1n] });
  blocked({ address: I.PAPER, functionName: 'approve', args: [thief, 1n] });
  blocked({ address: I.PAPER, functionName: 'approve', args: [C.LiquidityBurner, 1n] }); // ours, but it never takes payments
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
  ok({ address: C.FireSale, functionName: 'buyWithEthAll', args: [1n, 0n, 1n, 1n, {}], value: 5n * 10n ** 17n });
  blocked({ address: C.FireSale, functionName: 'buyWithEthAll', args: [1n, 0n, 1n, 1n, {}], value: 5n * 10n ** 17n + 1n });
  blocked({ address: I.V2_ROUTER, functionName: 'swapETHForExactTokens', args: [1n, [I.WETH, I.PAPER], me, 0n], value: 10n ** 18n });
});

test('ETH alone: the PAPER it buys is capped, never above the ETH sent', () => {
  ok({ address: C.FireSale, functionName: 'buyWithEthAll', args: [1n, 0n, 1n, 0n, {}], value: 10n ** 15n }); // no PAPER to buy
  blocked({ address: C.FireSale, functionName: 'buyWithEthAll', args: [], value: 10n ** 15n });
  blocked({ address: C.FireSale, functionName: 'buyWithEthAll', args: [1n, 0n, 1n, {}], value: 10n ** 15n }); // the old shape
  blocked({ address: C.FireSale, functionName: 'buyWithEthAll', args: [1n, 0n, 1n, 10n ** 15n + 1n, {}], value: 10n ** 15n });
  blocked({ address: C.FireSale, functionName: 'buyWithEthAll', args: [1n, 0n, 1n, 2n ** 256n - 1n, {}], value: 10n ** 15n });
});

test('owner-only and unknown functions on our own contracts are refused', () => {
  blocked({ address: C.FireSale, functionName: 'withdraw', args: [] });
  blocked({ address: C.FireCards, functionName: 'transferOwnership', args: [thief] });
  blocked({ address: C.LiquidityBurner, functionName: 'run', args: [] }); // keepers only, never a visitor's wallet
  blocked({ address: C.LiquidityBurner, functionName: 'setRoutes', args: [] });
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
  blocked(kyber({ minReturnAmount: 0n })); // no minimum return: any price would do
  blocked(kyber({ minReturnAmount: undefined }));
  const simple = (o) => ({ address: KYBER_ROUTER, functionName: 'swapSimpleMode', args: [thief, desc({ srcToken: I.USDG, ...o }), '0x', '0x'], value: 0n });
  ok(simple({}));
  blocked(simple({ minReturnAmount: 0n }));
});
