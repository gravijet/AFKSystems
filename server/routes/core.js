// Anmeldung, eigenes Konto, Minecraft-Konten, Proxys, Downloads und die Metadaten fürs Frontend.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from '../config.js';
import { db, getSetting, audit } from '../db.js';
import * as auth from '../auth.js';
import * as mslogin from '../mslogin.js';
import * as binaries from '../binaries.js';
import * as notify from '../notify.js';
import { FEATURES } from '../features.js';
import { ACTIONS, EVENTS } from '../macros.js';
import { supervisor } from '../supervisor.js';
import { hourlyRate, packages, runtimeHours } from '../credits.js';
import { wrap, requireString, requireInt, bad, notFound, parseAddress } from '../util.js';

export const router = express.Router();

// ---------------------------------------------------------------- Metadaten

router.get(
  '/meta',
  wrap((req, res) => {
    res.json({
      brand: config.brand,
      registration_open: config.registrationOpen,
      versions: binaries.state.versions,
      default_version: binaries.state.defaultVersion,
      client_version: binaries.state.clientVersion,
      client_tag: binaries.state.tag,
      client_checked: binaries.state.checkedAt,
      movement_available: binaries.state.movement,
      runtimes: [
        { key: 'rust', label: 'Rust (empfohlen)', available: binaries.state.ready },
        { key: 'java', label: 'Java (eine Jar je Version)', available: (binaries.state.jars || []).length > 0 },
      ],
      features: FEATURES,
      actions: ACTIONS,
      events: EVENTS,
      rate_mcr_hour: Number(getSetting('rate_mcr_hour')),
      credit_cent: Number(getSetting('credit_cent')),
      packages: packages(),
      low_balance_mcr: Number(getSetting('low_balance_mcr')),
      signup_bonus_mcr: Number(getSetting('signup_bonus_mcr')),
      payment: {
        stripe: Boolean(config.stripeSecret),
        transfer: Boolean(config.bankTransfer.iban),
        paypal: Boolean(config.bankTransfer.paypal),
      },
      user: req.user ? auth.publicUser(req.user) : null,
    });
  })
);

// ---------------------------------------------------------------- Anmeldung

router.post(
  '/auth/register',
  wrap((req, res) => {
    if (!config.registrationOpen) throw bad('Die Registrierung ist gerade geschlossen.');
    const user = auth.register(req.body || {});
    auth.createSession(res, user, req);
    res.json({ user: auth.publicUser(user) });
  })
);

router.post(
  '/auth/login',
  wrap((req, res) => {
    const user = auth.login(req.body || {});
    auth.createSession(res, user, req);
    audit(user.id, 'login');
    res.json({ user: auth.publicUser(user) });
  })
);

router.post(
  '/auth/logout',
  wrap((req, res) => {
    auth.destroySession(req, res);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Eigenes Konto

router.get(
  '/me',
  auth.requireUser,
  wrap((req, res) => {
    const bots = supervisor.list(req.user.id);
    const running = bots.filter((bot) => bot.state !== 'offline' && bot.state !== 'error').length;
    res.json({
      user: auth.publicUser(req.user),
      stats: {
        accounts: db
          .prepare('SELECT COUNT(*) AS n FROM mc_accounts WHERE user_id = ?')
          .get(req.user.id).n,
        profiles: db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?').get(req.user.id)
          .n,
        bots_running: running,
        bots_online: bots.filter((bot) => bot.online).length,
        rate_mcr_hour: hourlyRate(req.user),
        hours_left: Number.isFinite(runtimeHours(req.user, running || 1))
          ? Number(runtimeHours(req.user, running || 1).toFixed(1))
          : null,
      },
    });
  })
);

router.patch(
  '/me',
  auth.requireUser,
  wrap((req, res) => {
    const body = req.body || {};
    const fields = [];
    const values = [];
    if (body.theme !== undefined) {
      if (!['light', 'dark', 'system'].includes(body.theme)) throw bad('Unbekanntes Aussehen.');
      fields.push('theme = ?');
      values.push(body.theme);
    }
    if (body.chat_limit !== undefined) {
      fields.push('chat_limit = ?');
      values.push(requireInt(body.chat_limit, 'Chatverlauf', { min: 20, max: config.chatHistoryMax }));
    }
    if (body.discord_webhook !== undefined) {
      const hook = String(body.discord_webhook || '').trim();
      if (hook && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(hook)) {
        throw bad('Das sieht nicht nach einem Discord-Webhook aus.');
      }
      fields.push('discord_webhook = ?');
      values.push(hook || null);
    }
    if (body.language !== undefined) {
      fields.push('language = ?');
      values.push(String(body.language).slice(0, 5));
    }
    if (!fields.length) throw bad('Nichts zu ändern.');
    values.push(req.user.id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    res.json({ user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  })
);

router.post(
  '/me/discord-test',
  auth.requireUser,
  wrap(async (req, res) => {
    if (!req.user.discord_webhook) throw bad('Es ist kein Webhook hinterlegt.');
    const sent = await notify.notify(
      req.user.id,
      'Testnachricht',
      'Wenn du das liest, funktioniert die Benachrichtigung.',
      { key: `test-${Date.now()}` }
    );
    if (!sent) throw bad('Discord hat die Nachricht nicht angenommen. Stimmt die Adresse noch?');
    res.json({ ok: true });
  })
);

router.post(
  '/me/password',
  auth.requireUser,
  wrap((req, res) => {
    auth.changePassword(req.user, req.body?.old_password, req.body?.new_password);
    auth.createSession(res, req.user, req);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Minecraft-Konten

const accountView = (row) => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  uuid: row.uuid,
  status: row.status,
  last_error: row.last_error,
  connections: row.connections,
  created_at: row.created_at,
  // Kopfbild aus dem öffentlichen Skin-Dienst; ohne UUID nimmt der Dienst den Namen.
  head: `https://minotar.net/helm/${encodeURIComponent(row.uuid || row.name)}/64.png`,
});

router.get(
  '/accounts',
  auth.requireUser,
  wrap((req, res) => {
    mslogin.reconcile(req.user.id);
    const rows = db
      .prepare('SELECT * FROM mc_accounts WHERE user_id = ? ORDER BY name COLLATE NOCASE')
      .all(req.user.id);
    res.json({ accounts: rows.map(accountView) });
  })
);

router.post(
  '/accounts/login',
  auth.requireUser,
  wrap((req, res) => {
    if (!binaries.state.ready) throw bad('Der Client ist noch nicht geladen. Bitte kurz warten.');
    res.json(mslogin.begin(req.user));
  })
);

router.get(
  '/accounts/login/:id',
  auth.requireUser,
  wrap((req, res) => {
    res.json(mslogin.status(req.params.id, req.user));
  })
);

router.delete(
  '/accounts/login/:id',
  auth.requireUser,
  wrap((req, res) => {
    mslogin.cancel(req.params.id, req.user);
    res.json({ ok: true });
  })
);

router.delete(
  '/accounts/:id',
  auth.requireUser,
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Konto');
    // Laufende Bots dieses Kontos zuerst anhalten.
    for (const row of db.prepare('SELECT profile_id FROM profile_accounts WHERE account_id = ?').all(id)) {
      supervisor.stop(row.profile_id, id);
    }
    res.json({ account: accountView(mslogin.removeAccount(req.user, id)) });
  })
);

// ---------------------------------------------------------------- Proxys

router.get(
  '/proxies',
  auth.requireUser,
  wrap((req, res) => {
    const rows = db
      .prepare('SELECT id, label, kind, host, port, username, created_at FROM proxies WHERE user_id = ? ORDER BY id')
      .all(req.user.id);
    res.json({
      proxies: rows,
      // Ehrlich bleiben: hinterlegen ja, benutzen kann der Client sie noch nicht.
      supported: false,
      hint: FEATURES.find((feature) => feature.key === 'proxies').text,
    });
  })
);

router.post(
  '/proxies',
  auth.requireUser,
  wrap((req, res) => {
    const body = req.body || {};
    const label = requireString(body.label, 'Bezeichnung', { max: 60 });
    const { host, port } = parseAddress(body.address || `${body.host}:${body.port}`);
    if (!port) throw bad('Ein Proxy braucht einen Port.');
    const kind = ['socks5', 'socks4', 'http'].includes(body.kind) ? body.kind : 'socks5';
    const info = db
      .prepare(
        `INSERT INTO proxies (user_id, label, kind, host, port, username, password, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        label,
        kind,
        host,
        port,
        body.username ? String(body.username).slice(0, 100) : null,
        body.password ? String(body.password).slice(0, 200) : null,
        Date.now()
      );
    res.json({ id: info.lastInsertRowid });
  })
);

router.delete(
  '/proxies/:id',
  auth.requireUser,
  wrap((req, res) => {
    db.prepare('DELETE FROM proxies WHERE id = ? AND user_id = ?').run(
      requireInt(req.params.id, 'Proxy'),
      req.user.id
    );
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Downloads

router.get(
  '/downloads',
  auth.requireUser,
  wrap((req, res) => {
    res.json({
      files: binaries.downloadable(),
      tag: binaries.state.tag,
      client_version: binaries.state.clientVersion,
    });
  })
);

router.get(
  '/downloads/:name',
  auth.requireUser,
  wrap((req, res) => {
    const name = path.basename(String(req.params.name));
    const file = path.join(paths.bin, name);
    if (name === 'manifest.json' || !fs.existsSync(file)) throw notFound('Diese Datei gibt es nicht.');
    res.download(file, name);
  })
);
