import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const accountId = (value) => String(value || '').replaceAll('-', '').toLowerCase();

/** Validate complete client credentials without ever logging their contents. */
export function parseAccount(content) {
  const data = JSON.parse(content);
  if (!/^[a-f0-9]{32}$/.test(accountId(data?.minecraftProfile?.id)) ||
      !/^[A-Za-z0-9_]{1,16}$/.test(data?.minecraftProfile?.name || '') ||
      typeof data?.msaToken?.refreshToken !== 'string' || !data.msaToken.refreshToken.trim() ||
      typeof data?.minecraftToken?.token !== 'string' || !data.minecraftToken.token.trim()) {
    throw new Error('Die gespeicherte Minecraft-Anmeldung ist unvollständig.');
  }
  return data;
}

/** Atomic replacement: readers always see the old or the complete new credentials. */
export function writeAtomic(target, content) {
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export const fileHash = (content) => crypto.createHash('sha256').update(content).digest('hex');

export function olderAccount(next, current) {
  return ['msaToken', 'minecraftToken'].some((key) =>
    Number(next[key]?.expireTimeMs || 0) < Number(current[key]?.expireTimeMs || 0));
}
