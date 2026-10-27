import fs from 'node:fs';
import path from 'node:path';

export function botScope(profileId, accountId) {
  if (![profileId, accountId].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0)) {
    throw new Error('Ungültiger Serverplatz oder Account für den Client-Zustand.');
  }
  return `${Number(profileId)}-${Number(accountId)}`;
}

export function clientHome(userHome, scope = null) {
  if (scope === null) return userHome; // Compatibility with unscoped, older agent jobs.
  if (!/^[1-9]\d*-[1-9]\d*$/.test(scope)) throw new Error('Ungültiger Client-Zustand.');
  return path.join(userHome, 'bots', scope);
}

/** Share renewable logins; keep Home, routes and client settings per server/account. */
export function prepareClientHome(userHome, scope) {
  const home = clientHome(userHome, scope);
  const accounts = path.join(userHome, 'afksystems', 'accounts');
  fs.mkdirSync(accounts, { recursive: true, mode: 0o700 });
  if (home === userHome) return home;
  const settings = path.join(home, 'afksystems');
  fs.mkdirSync(settings, { recursive: true, mode: 0o700 });
  const link = path.join(settings, 'accounts');
  try {
    if (!fs.lstatSync(link).isSymbolicLink() || fs.realpathSync(link) !== fs.realpathSync(accounts)) {
      throw new Error('Das Client-Kontoverzeichnis verweist nicht auf die gespeicherten Anmeldungen.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    fs.symlinkSync(path.relative(settings, accounts), link, 'dir');
  }
  // The old user-wide movement.json has no reliable server/account owner. Keep it as
  // a backup; importing it here would repeat movement on unrelated worlds/accounts.
  return home;
}
