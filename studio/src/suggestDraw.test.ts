import { describe, expect, it } from 'vitest'
import { bls12_381 as bls } from '@noble/curves/bls12-381'
import { sha256 } from '@noble/hashes/sha2'
import { checkDraw, commandOr, pickCommand, publishCommand, verifyCommand, randomnessOf, roundMessage, roundTime, type DrawFile } from './suggestDraw'

// a stand-in drand network with its own key: the same scheme as quicknet (as ops/suggestions/draw.test.mjs)
const sk = bls.utils.randomPrivateKey()
const PK = [...bls.getPublicKeyForShortSignatures(sk)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sign = (round: number) => [...bls.signShortSignature(roundMessage(round), sk)].map((x) => x.toString(16).padStart(2, '0')).join('') // quicknet's DST is the default

function draw(over: Partial<DrawFile> = {}): DrawFile {
  const round = 5000, signature = sign(round), randomness = randomnessOf(signature)
  return {
    chainId: 46630, credits: '0x1', round: 3, kind: 'look', fromBlock: '0', toBlock: '100', toBlockTime: Number(roundTime(round)) - 60,
    seed: randomness, drand: { round, signature, randomness }, count: 10, at: '', suggestions: 4, pools: { theme: 2, style: 2 },
    shortlists: { theme: [{ id: 1, by: '0xabc', title: 'Haunted diner', alsoBy: [] }], style: [{ id: 2, by: '0xdef', title: 'Woodcut', alsoBy: ['0x9'] }] },
    ...over,
  }
}

describe('suggestion draw files', () => {
  it('a real draw checks out: the round signed by the network, randomness = sha256(signature), seed = randomness, round after the close', () => {
    expect(checkDraw(draw(), PK)).toEqual([])
    expect(randomnessOf(sign(7))).toBe([...sha256(Uint8Array.from(sign(7).match(/../g)!.map((x) => parseInt(x, 16))))].map((x) => x.toString(16).padStart(2, '0')).join(''))
  })
  it('names what is wrong', () => {
    const d = draw()
    expect(checkDraw(d)).toEqual([`The drand signature isn't quicknet's for round 5000.`]) // not quicknet's key
    expect(checkDraw({ ...d, seed: '00' }, PK)).toEqual(['The seed isn\'t the drand round\'s randomness.'])
    expect(checkDraw({ ...d, drand: { ...d.drand!, round: 5001 } }, PK).length).toBeGreaterThan(0)
    expect(checkDraw({ ...d, toBlockTime: Number(roundTime(5000)) + 5 }, PK)).toEqual(['drand round 5000 came out before the wave closed.'])
    expect(checkDraw({ ...d, test: true, drand: undefined }, PK)[0]).toMatch(/TEST draw/)
    expect(checkDraw({} as DrawFile)[0]).toMatch(/isn't a draw file/)
  })
  it('the commands carry the picks', () => {
    expect(publishCommand('draw-round-3-look.json', 2, [1, 2])).toContain(`--draw 'draw-round-3-look.json' --series 2 --picks 1,2`)
    expect(verifyCommand('draw-round-3-look.json')).toBe(`node suggestions/draw.mjs --rpc <url> --verify 'draw-round-3-look.json'`)
    const c = pickCommand(2, [1, 2, 5, 6, 7], 46630)
    expect(c).toContain('deployments\\46630.json')
    expect(c).toContain('"pickSuggestions(uint256,uint256[])" 2 "[1,2,5,6,7]" --ledger')
  })
  it('no command when a file name or a number could run code in PowerShell', () => {
    for (const bad of ['$(calc).json', 'a`b.json', "it's.json", 'draw round.json', 'x";calc;".json', '..\\x.json', 'draw.json.txt', 'draw', '']) {
      expect(() => publishCommand(bad, 2, [1, 2])).toThrow(/isn't safe/)
      expect(() => verifyCommand(bad)).toThrow(/isn't safe/)
    }
    for (const bad of [-1, 1.5, NaN, Infinity, 2 ** 53, '2' as unknown as number]) {
      expect(() => publishCommand('d.json', bad, [1])).toThrow(/whole number/)
      expect(() => publishCommand('d.json', 2, [1, bad])).toThrow(/whole number/)
      expect(() => pickCommand(bad, [1], 46630)).toThrow(/whole number/)
      expect(() => pickCommand(2, [bad], 46630)).toThrow(/whole number/)
      expect(() => pickCommand(2, [1], bad)).toThrow(/whole number/)
    }
    expect(commandOr(() => publishCommand('$(calc).json', 2, [1]))).toEqual({ error: expect.stringMatching(/isn't safe/) })
    expect(commandOr(() => pickCommand(2, [0, 1], 1))).toEqual({ cmd: expect.stringContaining('"[0,1]"') })
  })
})
