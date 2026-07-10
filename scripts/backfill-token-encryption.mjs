#!/usr/bin/env node
// One-time backfill: encrypt the existing plaintext share tokens in links.token.
//
// ORDERING MATTERS. Run this ONLY AFTER the encryption code (lib/token-crypto.ts
// + the decrypt path in list_links) is deployed to production. If you run it
// before deploy, the live list_links would return the "v1:..." ciphertext as if
// it were the token, showing broken share URLs until the new code ships.
// Authentication is unaffected either way (requests verify against token_hash),
// so existing share links keep working throughout.
//
// Idempotent: rows already encrypted (token LIKE 'v1:%') are skipped, so it is
// safe to re-run. Uses the same AES-GCM scheme as lib/token-crypto.ts and reads
// TOKEN_ENC_KEY + CLOUDFLARE_API_TOKEN from .dev.vars.
//
// Usage:  node scripts/backfill-token-encryption.mjs [--dry-run]

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DRY_RUN = process.argv.includes("--dry-run");

const devVars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
const getVar = (name) => {
  const m = devVars.match(new RegExp(`^${name}=(.*)$`, "m"));
  return m ? m[1].trim() : null;
};

const KEY = getVar("TOKEN_ENC_KEY");
const CF_TOKEN = getVar("CLOUDFLARE_API_TOKEN");
if (!KEY) {
  console.error("TOKEN_ENC_KEY missing from .dev.vars");
  process.exit(1);
}

const wrangler = (args) =>
  execSync(`npx wrangler ${args}`, {
    env: { ...process.env, CLOUDFLARE_API_TOKEN: CF_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

// Same scheme as lib/token-crypto.ts: AES-GCM, 12-byte IV, "v1:<b64 iv>:<b64 ct>".
async function encryptToken(plaintext, keyB64) {
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(keyB64, "base64"),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext))
  );
  const b64 = (b) => Buffer.from(b).toString("base64");
  return `v1:${b64(iv)}:${b64(ct)}`;
}

const raw = wrangler(
  `d1 execute mdshare-db --remote --json --command "SELECT id, token FROM links WHERE token IS NOT NULL AND token NOT LIKE 'v1:%'"`
);
const rows = JSON.parse(raw.slice(raw.indexOf("[")))[0].results;
console.log(`${rows.length} plaintext token(s) to encrypt`);
if (rows.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

const updates = [];
for (const r of rows) {
  // Guard: ids are nanoids and the ciphertext is base64 — neither contains a
  // single quote — so simple quoting is safe. Assert it to be certain.
  if (/['\\]/.test(r.id)) throw new Error(`unexpected char in id ${r.id}`);
  const enc = await encryptToken(r.token, KEY);
  updates.push(`UPDATE links SET token='${enc}' WHERE id='${r.id}';`);
}

if (DRY_RUN) {
  console.log(`[dry-run] would apply ${updates.length} UPDATEs. First:\n${updates[0]}`);
  process.exit(0);
}

const sqlPath = "/tmp/backfill-tokens.sql";
writeFileSync(sqlPath, updates.join("\n"));
wrangler(`d1 execute mdshare-db --remote --file ${sqlPath}`);
console.log(`Encrypted ${updates.length} token(s).`);

// Verify none remain plaintext.
const check = wrangler(
  `d1 execute mdshare-db --remote --json --command "SELECT COUNT(*) AS remaining FROM links WHERE token IS NOT NULL AND token NOT LIKE 'v1:%'"`
);
const remaining = JSON.parse(check.slice(check.indexOf("[")))[0].results[0].remaining;
console.log(`Plaintext tokens remaining: ${remaining}`);
