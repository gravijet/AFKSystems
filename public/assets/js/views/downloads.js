// Downloads: dieselben Client-Dateien, die auf diesem Server laufen – zum Mitnehmen.

import { api, icon, escapeHtml, datetime } from '../ui.js';
import { state, appbar } from '../app.js';

const DESCRIPTION = {
  'afk-linux': 'Rust-Client für Linux – alle Protokolle in einer Datei, Auswahl über --mc.',
  'afk-linux-move': 'Rust-Client für Linux mit Bewegung (:go, :look, :home, :route).',
  'afk-windows.exe': 'Rust-Client für Windows – alle Protokolle in einer Datei.',
};

export async function render(root) {
  const data = await api('/downloads');

  const rows = data.files
    .map((file) => {
      const jar = /^afk-(.+)\.jar$/.exec(file.name);
      const text = DESCRIPTION[file.name] || (jar ? `Java-Client für Minecraft ${jar[1]}.` : '');
      return `<tr>
        <td class="mono">${escapeHtml(file.name)}</td>
        <td class="small muted">${escapeHtml(text)}</td>
        <td class="mono small muted nowrap">${(file.size / 1024 / 1024).toFixed(1)} MB</td>
        <td class="small muted nowrap">${datetime(file.changed)}</td>
        <td style="text-align:right">
          <a class="btn btn-sm" href="/api/downloads/${encodeURIComponent(file.name)}">${icon('download')} Laden</a></td>
      </tr>`;
    })
    .join('');

  root.innerHTML = `
    ${appbar('Downloads', '', `Client ${escapeHtml(data.client_version || '?')} · Release "${escapeHtml(data.tag || '–')}"`)}

    <section class="panel" style="margin-bottom:1.5rem">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Datei</th><th>Wofür</th><th>Größe</th><th>Stand</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted small" style="padding:1.25rem">Noch nichts geladen.</td></tr>'}</tbody>
      </table></div>
    </section>

    <div class="grid two">
      <section class="panel">
        <header><h3>Selbst starten</h3></header>
        <div class="body stack">
          <p class="small muted">Der Client braucht keine Konfigurationsdatei – alles steht im Startbefehl.
            Einmal anmelden, danach loslegen:</p>
          <pre class="console" style="white-space:pre-wrap"># einmalig anmelden
./afk-linux --login

# loslegen
./afk-linux mc.example.net --mc ${escapeHtml(state.meta.default_version)} -c 300:/afk</pre>
          <p class="small muted">Auf Windows entsprechend <span class="mono">afk-windows.exe</span>,
            mit Java <span class="mono">java -jar afk-${escapeHtml(state.meta.default_version)}.jar</span>.</p>
        </div>
      </section>

      <section class="panel">
        <header><h3>Ein-/Ausgabe</h3></header>
        <div class="body stack small muted">
          <div><span class="strong">Standardausgabe:</span> nur Chat, eine Zeile je Nachricht.</div>
          <div><span class="strong">Standardfehler:</span> Verbindungszustand, Login-Code, Fehler.</div>
          <div><span class="strong">Standardeingabe:</span> jede Zeile geht als Chat raus, mit „/“ als Befehl.</div>
          <p>Genau darüber steuert dieses Panel den Client – ohne eigenes Protokoll.</p>
        </div>
      </section>
    </div>`;
}
