#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const path = '../supabase/functions/_shared/managed-config-catalog';
const localBytes = await readFile(new URL(path + '.json', import.meta.url));
const { sourceCommit, contentDigest } = JSON.parse(await readFile(new URL(path + '-source.json', import.meta.url), 'utf8'));
if (!/^[0-9a-f]{40}$/u.test(sourceCommit) || !/^[0-9a-f]{64}$/u.test(contentDigest)) {
  throw new Error('Managed configuration catalog producer pin is invalid');
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const local = JSON.parse(localBytes.toString('utf8'));
if (local.contentDigest !== contentDigest || hash(JSON.stringify(local.options)) !== contentDigest || localBytes.includes(13)) {
  throw new Error('Managed configuration catalog does not match the pinned content digest and LF format');
}
const generated = await readFile(new URL(path + '-generated.ts', import.meta.url), 'utf8');
if (generated !== 'export default ' + localBytes.toString('utf8').trimEnd() + ' as const;\n') {
  throw new Error('Managed configuration catalog TypeScript export does not match the LF fixture');
}
const url = `https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop/${sourceCommit}/deploy/managed-config-catalog.json`;
const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`Could not fetch the mod catalog (${response.status})`);
const remoteBytes = Buffer.from(await response.arrayBuffer());
if (!localBytes.equals(remoteBytes)) {
  throw new Error(`Managed configuration catalog bytes differ from ${sourceCommit}. local=${hash(localBytes)} remote=${hash(remoteBytes)}`);
}
console.log(`Managed configuration catalog matches ${sourceCommit}, content digest ${contentDigest}, LF SHA-256 ${hash(localBytes)}`);
