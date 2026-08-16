// Discords „Linked Roles“.
//
// Hier gibt es nur die beiden Linked-Role-Merkmale Administrator und Discord Moderator. Customer,
// Premium, Ultra, Partner, VIP und Team sind normale Serverrollen und werden in roles.js abgeglichen.
//
// Hier wird nur das **Schema** angemeldet: welche Felder es gibt und wie sie heißen. Die Werte
// schreibt das Panel, sobald jemand auf „Discord-Rollen auffrischen“ klickt (siehe oauth.js).
//
// Einrichten in Discord: Servereinstellungen → Rollen → Rolle → Links → Anwendung wählen →
// Bedingung setzen. Die Verifizierungsadresse der Anwendung ist
// https://<panel>/api/auth/discord/start?mode=verify

const API = 'https://discord.com/api/v10';

/** Datentypen, die Discord kennt. 2 = Zahl ≥, 7 = Ja/Nein. */
export async function registerMetadata({ applicationId, token, fields }) {
  if (!applicationId || !token) return false;
  const body = (fields || []).map((field) => ({
    key: field.key,
    name: field.name,
    description: field.description,
    type: field.type,
  }));
  if (!body.length) return false;

  const response = await fetch(`${API}/applications/${applicationId}/role-connections/metadata`, {
    method: 'PUT',
    headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.warn(`[linked roles] metadata rejected (${response.status}): ${text.slice(0, 200)}`);
    return false;
  }
  console.log(`[linked roles] registered ${body.length} metadata field(s)`);
  return true;
}
