// Share previews (api/share): the link's query, the page's tags, the cards read (only ones the wallet still holds,
// best first) and the picture. No chain or IPFS: a fake reader and fake image fetches (the demo card art).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { imageUrl, label, page, parseQuery, picture, readCards, siteHref } from '../../api/share/_lib/share.js';

const ME = '0x7a3f2b9c41d0e5a6b8f9c0d1e2f3a4b5c6d7c91e', THEM = '0x1111111111111111111111111111111111111111';
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
const md = (name, material, holo, pda, file) => 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name, image: `ipfs://${CID}/${file}`,
  attributes: [{ trait_type: 'Material', value: material }, { trait_type: 'Holo', value: holo }, { trait_type: 'PDA', value: pda }] })).toString('base64');
const CHAIN = {
  11: { owner: ME, uri: md('Paper Toaster #11', 'Paper', 'None', 'Ungraded', 'toaster-paper.webp') },
  12: { owner: ME, uri: md('Gold Pigeon #12', 'Gold', 'Full', 'PDA 9', 'pigeon-gold.webp') },
  13: { owner: THEM, uri: md('Full Art Frog #13', 'Full Art', 'Full', 'PDA 10', 'frog-fullart.webp') }, // sold on: not shown
  14: { owner: ME, uri: md('Fire Lobster #14', 'Fire', 'Picture', 'Ungraded', 'lobster-fire.webp') },
};
const reader = () => ({ ownerOf: async (s) => CHAIN[s].owner, tokenURI: async (s) => CHAIN[s].uri });
const ART = new URL('../../art/factory/forge/cards/', import.meta.url);
const FILES = { 'toaster-paper.webp': 'toaster/paper-plain.webp', 'pigeon-gold.webp': 'pigeon/gold-plain.webp', 'lobster-fire.webp': 'lobster/fire-plain.webp' };
const fetcher = async (url) => { const f = FILES[url.split('/').pop()]; return f ? new Response(readFileSync(new URL(f, ART))) : new Response('', { status: 404 }); };

test('the query: only a real address, card numbers and a known net get through', () => {
  const q = parseQuery(new URLSearchParams(`show=${ME}&c=12.11.x.-3.0.12&live=testnet`));
  assert.deepEqual(q, { addr: ME, show: ME, ids: [12, 11], live: 'testnet' });
  assert.equal(siteHref(q), `/forge/?live=testnet&show=${ME}&c=12.11`);
  const bad = parseQuery(new URLSearchParams('show=<script>&c=1&live=evil'));
  assert.deepEqual(bad, { addr: null, show: null, ids: [1], live: null });
  assert.equal(siteHref(bad), '/forge/');
  assert.equal(parseQuery(new URLSearchParams('c=' + Array.from({ length: 20 }, (_, i) => i + 1).join('.'))).ids.length, 6);
});

test('the cards: only ones the wallet still holds, best first', async () => {
  const cards = await readCards(parseQuery(new URLSearchParams(`show=${ME}&c=11.12.13.14&live=testnet`)), { reader });
  assert.deepEqual(cards.map((c) => c.serial), [12, 14, 11]);
  assert.equal(label(cards[0]), 'Gold Pigeon · PDA 9');
  assert.equal(label(cards[1]), 'Fire Lobster · Holo picture');
  assert.deepEqual(await readCards(parseQuery(new URLSearchParams(`show=${ME}&c=11`)), { reader }), [], 'demo links read nothing');
});

test('the page: the tags previewers read, then on to the showcase', async () => {
  const q = parseQuery(new URLSearchParams(`show=${ME}&c=11.12&live=testnet`)), cards = await readCards(q, { reader });
  const html = page(q, cards, 'https://omni.example');
  assert.match(html, /<meta property="og:title" content="Gold Pigeon · PDA 9 \| Omni Cardworks">/);
  assert.match(html, /og:image" content="https:\/\/omni\.example\/api\/share\/img\?show=0x7a3f[^"]+&amp;c=11\.12&amp;live=testnet"/);
  assert.match(html, /http-equiv="refresh" content="0;url=\/forge\/\?live=testnet&amp;show=0x7a3f[^"]+&amp;c=11\.12"/);
  const plain = page(parseQuery(new URLSearchParams('show="><script>')), [], 'https://omni.example');
  assert.ok(!plain.includes('<script>'), 'nothing from the link is written in raw');
  assert.match(plain, /og:image" content="https:\/\/omni\.example\/forge\/ui\/og\.jpg"/);
});

test('card pictures only come from the IPFS gateways the site uses', () => {
  assert.equal(imageUrl(`ipfs://${CID}/a.webp`), `https://ipfs.filebase.io/ipfs/${CID}/a.webp`);
  assert.equal(imageUrl('https://ipfs.io/ipfs/x/a.webp'), 'https://ipfs.io/ipfs/x/a.webp');
  assert.equal(imageUrl('https://evil.example/a.webp'), null);
  assert.equal(imageUrl('http://ipfs.io/ipfs/x/a.webp'), null);
  assert.equal(imageUrl('ipfs://../../etc'), null);
});

test('the picture: 1200 x 630, with up to three cards; none loading gives null', async () => {
  const backdrop = readFileSync(new URL('../../api/share/_lib/backdrop.jpg', import.meta.url));
  for (const ids of ['11.12.14', '12.14', '12']) {
    const cards = await readCards(parseQuery(new URLSearchParams(`show=${ME}&c=${ids}&live=testnet`)), { reader });
    const jpg = await picture(cards, { backdrop, sharp, fetcher });
    const m = await sharp(jpg).metadata();
    assert.deepEqual([m.format, m.width, m.height], ['jpeg', 1200, 630]);
    if (process.env.SHARE_OUT) writeFileSync(`${process.env.SHARE_OUT}/share-${ids.split('.').length}.jpg`, jpg);
  }
  const none = await picture([{ serial: 1, image: `ipfs://${CID}/missing.webp` }], { backdrop, sharp, fetcher });
  assert.equal(none, null);
});
