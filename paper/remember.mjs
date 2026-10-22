#!/usr/bin/env node
// Memory: after an issue is approved, save what ran (headlines by section and writer) and any new running jokes, so
// the next nights' writers can call back to them and don't repeat themselves.
//   node paper/remember.mjs --date YYYY-MM-DD   |   node paper/remember.mjs <issue.json>
import { appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PAPER_DIR, args, issueDate, readJson, writeJson } from "./lib/util.mjs";

export function remember(issue, dir = resolve(PAPER_DIR, "memory")) {
  const file = resolve(dir, "past-issues.json");
  const past = existsSync(file) ? readJson(file) : [];
  const entry = {
    date: issue.date,
    number: issue.number,
    stories: issue.pages.flatMap((p) => (p.stories ?? []).map((s) => ({ section: p.section, byline: s.byline, headline: s.headline, roast: Boolean(s.roast) }))),
    runningJokes: issue.runningJokes ?? [],
  };
  const out = past.filter((p) => p.date !== issue.date).concat(entry).slice(-60);
  writeJson(file, out);
  if (entry.runningJokes.length) appendFileSync(resolve(dir, "running-jokes.md"), entry.runningJokes.map((j) => `- (${issue.date}, No. ${issue.number}) ${j}`).join("\n") + "\n");
  return entry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const file = a._[0] ?? resolve(PAPER_DIR, "out", issueDate(a.date), "issue.json");
  const e = remember(readJson(file));
  console.log(`remembered No. ${e.number}: ${e.stories.length} stories, ${e.runningJokes.length} new running jokes`);
}
