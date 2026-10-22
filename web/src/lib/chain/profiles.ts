// Profiles (FireProfiles): each wallet's name and profile picture, a card it holds, framed by a crop. Reads are
// batched (many addresses in one profilesOf call) and cached; a picture counts only while the wallet still holds the
// card (pfpOk, checked on read). On a network without FireProfiles (before its deploy) `profilesOn()` is false and the
// reads return null, so the site just hides profiles.

import { getAddress, type Address, type TransactionReceipt } from "viem";
import { profilesAbi } from "../cards";
import { NET } from "../net";
import { sendTx } from "../tx";
import { getAccount } from "../wallet";
import { pub } from "./contracts";
import { card } from "./reads";
import type { WriteOpts } from "./writes";

export { profilesAbi };

/** The picture's framing: the circle's centre (x, y: 0..1 across the card's art) and zoom (1..4). */
export type Crop = { x: number; y: number; zoom: number };
export type Profile = {
  address: Address;
  name: string;
  /** The card shown, or null: none set, or the wallet no longer holds it. */
  pfpCard: number | null;
  /** The card the profile names, held or not. */
  storedPfp: number | null;
  crop: Crop;
  /** When it was last set (unix seconds). */
  updated: number;
  /** The card's image URL (the metadata's), when pfpCard is set. */
  image: string | null;
  /** The card's material ("Paper", "Gold", "Full Art"...), when pfpCard is set: Full Art crops the whole card. */
  material: string | null;
};

export const MAX_NAME = 20;
export const ZOOM_MAX = 4;

/** Is FireProfiles deployed on this network? */
export const profilesOn = (): boolean => !!NET.deployment.contracts?.FireProfiles;
const at = (): Address => getAddress(NET.deployment.contracts!.FireProfiles!);

/** The contract's name rules: 1-20 bytes of 0x21-0x7E, single spaces between words. */
export function validName(name: string): boolean {
  if (name.length < 1 || name.length > MAX_NAME) return false;
  if (!/^[\x21-\x7e]+( [\x21-\x7e]+)*$/.test(name)) return false;
  return true;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Crop -> the contract's uint64: x | y << 16 | zoom << 32 (each 16 bits; zoom 0..65535 = 1x..4x). */
export function packCrop(c: Crop): bigint {
  const q = (v: number) => BigInt(Math.round(clamp(v, 0, 1) * 65535));
  return q(c.x) | (q(c.y) << 16n) | (q((c.zoom - 1) / (ZOOM_MAX - 1)) << 32n);
}
export function unpackCrop(v: bigint): Crop {
  const f = (s: bigint) => Number((v >> s) & 0xffffn) / 65535;
  if (v === 0n) return { x: 0.5, y: 0.5, zoom: 1 };
  return { x: f(0n), y: f(16n), zoom: 1 + f(32n) * (ZOOM_MAX - 1) };
}

type Raw = { name: string; pfpCard: bigint; crop: bigint; updated: bigint; pfpOk: boolean };
const TTL = 60_000;
const cache = new Map<string, { at: number; p: Promise<Profile | null> }>();
let queue: { a: Address; ok: (p: Profile | null) => void; no: (e: unknown) => void }[] = [];
let flushing = false;

const imgCache = new Map<number, Promise<{ image: string; material: string } | null>>();
function cardLook(serial: number) {
  let p = imgCache.get(serial);
  if (!p) {
    p = card(serial).then((c) => ({ image: c.image, material: c.material }), () => { imgCache.delete(serial); return null; });
    imgCache.set(serial, p);
  }
  return p;
}

async function toProfile(a: Address, r: Raw): Promise<Profile | null> {
  if (!r.name) return null;
  const stored = r.pfpCard ? Number(r.pfpCard) : null, held = r.pfpOk && stored ? stored : null;
  const look = held ? await cardLook(held) : null;
  return {
    address: a, name: r.name, pfpCard: look ? held : null, storedPfp: stored, crop: unpackCrop(r.crop), updated: Number(r.updated),
    image: look?.image ?? null, material: look?.material ?? null,
  };
}

async function flush() {
  flushing = false;
  const batch = queue; queue = [];
  for (let i = 0; i < batch.length; i += 100) {
    const part = batch.slice(i, i + 100);
    try {
      const raws = (await pub().readContract({ address: at(), abi: profilesAbi, functionName: "profilesOf", args: [part.map((x) => x.a)] })) as readonly Raw[];
      part.forEach((x, k) => toProfile(x.a, raws[k]).then(x.ok, x.no));
    } catch (e) { part.forEach((x) => x.no(e)); }
  }
}

/** A wallet's profile, or null (none, or no FireProfiles here). Cached for a minute; calls made together share one
 *  read. `fresh`: skip the cache. */
export function profile(address: string, fresh = false): Promise<Profile | null> {
  if (!profilesOn()) return Promise.resolve(null);
  const a = getAddress(address), k = a.toLowerCase(), hit = cache.get(k);
  if (hit && !fresh && Date.now() - hit.at < TTL) return hit.p;
  const p = new Promise<Profile | null>((ok, no) => {
    queue.push({ a, ok, no });
    if (!flushing) { flushing = true; queueMicrotask(flush); }
  });
  cache.set(k, { at: Date.now(), p });
  p.catch(() => { if (cache.get(k)?.p === p) cache.delete(k); });
  return p;
}

/** Many profiles in one read: address (lowercase) -> profile or null. */
export async function profiles(addresses: string[]): Promise<Record<string, Profile | null>> {
  const uniq = [...new Set(addresses.map((x) => x.toLowerCase()))];
  const got = await Promise.all(uniq.map((x) => profile(x)));
  return Object.fromEntries(uniq.map((x, i) => [x, got[i]]));
}

/** Who holds this name (any case), or null. */
export async function nameOwner(name: string): Promise<Address | null> {
  if (!profilesOn() || !validName(name)) return null;
  const a = (await pub().readContract({ address: at(), abi: profilesAbi, functionName: "ownerOfName", args: [name] })) as Address;
  return /^0x0{40}$/i.test(a) ? null : getAddress(a);
}

/** Forget cached profiles (one wallet, or all). */
export function forgetProfile(address?: string) {
  if (address) cache.delete(address.toLowerCase()); else cache.clear();
}

const me = (): Address => {
  const a = getAccount();
  if (a.status !== "connected" || !a.address) throw new Error("Connect your wallet first.");
  return a.address;
};

/** Set the connected wallet's name, picture (a card it holds; 0 / null = none) and the picture's framing. One
 *  transaction. Checked first: the name's rules, and that nobody else has it. */
export async function setProfile(p: { name: string; pfpCard?: number | null; crop?: Crop }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  const from = me(), name = p.name.trim();
  if (!validName(name)) throw new Error("Names are 1-20 letters, numbers or symbols, with single spaces between words.");
  const owner = await nameOwner(name);
  if (owner && owner !== getAddress(from)) throw new Error("That name is taken.");
  const label = "Save profile";
  const r = await sendTx({ address: at(), abi: profilesAbi, functionName: "setProfile", args: [name, BigInt(p.pfpCard ?? 0), packCrop(p.crop ?? { x: 0.5, y: 0.5, zoom: 1 })] },
    { label, kind: "profile", onStep: (s, h) => o.onStep?.(s, label, h) });
  forgetProfile(from);
  return r;
}

/** Remove the connected wallet's profile (its name is free again). */
export async function clearProfile(o: WriteOpts = {}): Promise<TransactionReceipt> {
  const from = me(), label = "Remove profile";
  const r = await sendTx({ address: at(), abi: profilesAbi, functionName: "clear", args: [] }, { label, kind: "profile", onStep: (s, h) => o.onStep?.(s, label, h) });
  forgetProfile(from);
  return r;
}
