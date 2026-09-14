// Offene Störungen überleben Neustarts und gelöschte Postfachmeldungen.
import { db } from './db.js';

export function get(key) {
  const row = db.prepare('SELECT * FROM notification_incidents WHERE key = ?').get(key);
  return row ? { ...row, data: JSON.parse(row.data) } : null;
}

export function open(key, data, userId = null) {
  db.prepare(`INSERT INTO notification_incidents (key,user_id,data,created_at) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET data = excluded.data`).run(key, userId, JSON.stringify(data), Date.now());
  return get(key);
}

export function markNotified(key) {
  return db.prepare('UPDATE notification_incidents SET notified_at = ? WHERE key = ? AND notified_at IS NULL')
    .run(Date.now(), key).changes > 0;
}

export function close(key) {
  const row = get(key);
  db.prepare('DELETE FROM notification_incidents WHERE key = ?').run(key);
  return row;
}

export function list(prefix) {
  return db.prepare('SELECT key FROM notification_incidents WHERE key LIKE ?').all(`${prefix}%`).map(({ key }) => get(key));
}
