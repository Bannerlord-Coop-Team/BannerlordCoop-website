#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const local = JSON.parse(await readFile(new URL('../supabase/functions/_shared/managed-config-catalog.json', import.meta.url), 'utf8'));
const url = process.argv[2] ?? 'https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop/development/deploy/managed-config-catalog.json';
const response = await fetch(url);
if (!response.ok) throw new Error(`Could not fetch the mod catalog (${response.status})`);
const remote = await response.json();
if (remote.contentDigest !== local.contentDigest || remote.sourceCommit !== local.sourceCommit) {
  throw new Error(`Managed configuration catalog is behind the mod catalog. local=${local.contentDigest} remote=${remote.contentDigest}`);
}
console.log(`Managed configuration catalog is current at ${local.contentDigest}`);
