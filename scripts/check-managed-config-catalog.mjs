#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const localBytes = await readFile(new URL('../supabase/functions/_shared/managed-config-catalog.json', import.meta.url));
const local = JSON.parse(localBytes.toString('utf8'));
if (!/^[0-9a-f]{40}$/u.test(local.sourceCommit)) throw new Error('Managed configuration catalog source commit is invalid');
const url = process.argv[2] ?? `https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop/${local.sourceCommit}/deploy/managed-config-catalog.json`;
const response = await fetch(url);
if (!response.ok) throw new Error(`Could not fetch the mod catalog (${response.status})`);
const remoteBytes = Buffer.from(await response.arrayBuffer());
const remote = JSON.parse(remoteBytes.toString('utf8'));
if (remote.sourceCommit !== local.sourceCommit) throw new Error(`Managed configuration catalog producer commit differs. local=${local.sourceCommit} remote=${remote.sourceCommit}`);
if (!localBytes.equals(remoteBytes)) {
  const digest = value => createHash('sha256').update(value).digest('hex');
  throw new Error(`Managed configuration catalog bytes differ from the pinned mod catalog. local=${digest(localBytes)} remote=${digest(remoteBytes)}`);
}
console.log(`Managed configuration catalog bytes match the pinned mod catalog at ${createHash('sha256').update(localBytes).digest('hex')}`);
