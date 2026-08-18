// Discords „Linked Roles“.
//
// Hier wird nur das **Schema** angemeldet: welche Bedingungen es gibt, wie sie heißen und was
// verglichen wird. Welche das sind, entscheidet der Betreiber im Panel unter
// *Administration → Einstellungen → Discord Linked Roles*; der Bot bekommt sie mit `/config` und
// reicht sie an Discord weiter. Die **Werte** je Konto schreibt das Panel, sobald jemand auf
// „Discord-Rollen auffrischen“ klickt (siehe server/oauth.js).
//
// Customer, Premium, Ultra, Partner, VIP und Team sind dagegen normale Serverrollen und werden in
// handlers/roles.js abgeglichen – dafür braucht es Discord nicht als Schiedsrichter.
//
// Einrichten in Discord: Servereinstellungen → Rollen → Rolle → Links → Anwendung wählen →
// Bedingung setzen. Die Verifizierungsadresse der Anwendung ist
// https://<panel>/api/auth/discord/start?mode=verify

const API = 'https://discord.com/api/v10';

/**
 * Das Schema bei Discord hinterlegen.
 *
 * Eine **leere** Liste ist eine gültige Angabe und bedeutet „es soll keine Bedingungen geben“ –
 * Discord räumt die alten dann weg. Nur wenn gar keine Liste ankommt (das Panel war nicht
 * erreichbar), wird nichts angefasst: sonst löschte ein Netzfehler die Einrichtung.
 */
export async function registerMetadata({ applicationId, token, fields }) {
  if (!applicationId || !token || !Array.isArray(fields)) return false;
  const body = fields.map((field) => ({
    key: field.key,
    name: field.name,
    description: field.description,
    type: field.type,
  }));

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
