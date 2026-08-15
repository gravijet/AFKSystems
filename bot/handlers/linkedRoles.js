// Discords „Linked Roles“.
//
// Damit lässt sich in Discord eine Rolle bauen, die eine Bedingung an unsere Anwendung stellt –
// „hat ein verknüpftes AFKSystems-Konto“, „Tarifstufe mindestens 1“, „gehört zum Team“. Discord
// fragt dafür nicht bei uns nach, sondern liest, was wir zu diesem Nutzer hinterlegt haben.
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
    console.warn(`[linked roles] Schema abgelehnt (${response.status}): ${text.slice(0, 200)}`);
    return false;
  }
  console.log(`[linked roles] ${body.length} Felder angemeldet`);
  return true;
}
