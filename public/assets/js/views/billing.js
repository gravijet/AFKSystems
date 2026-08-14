// Guthaben: Stand, Verbrauch, Aufladen, Gutschein einlösen, Kontoauszug.

import { api, icon, escapeHtml, credits, euro, datetime, $, $$, ok, fail, copy, formDialog } from '../ui.js';
import { state, appbar, refresh, draw } from '../app.js';

const KINDS = {
  usage: 'Verbrauch',
  topup: 'Aufladung',
  voucher: 'Gutschein',
  admin: 'Durch Admin',
  bonus: 'Startguthaben',
  refund: 'Erstattung',
};

export async function render(root) {
  const data = await api('/billing');
  const params = new URLSearchParams(location.hash.split('?')[1] || '');

  root.innerHTML = `
    ${appbar('Guthaben', `
      <button class="btn btn-sm" id="voucher">${icon('ticket')} Gutschein einlösen</button>
      <button class="btn btn-primary btn-sm" id="topup">${icon('wallet')} Aufladen</button>`,
      'Kein Abo – du bezahlst nur laufende Bots')}

    ${params.get('bezahlt') ? `<div class="note" style="margin-bottom:1.25rem">${icon('check')}<div>Danke! Sobald die Zahlung bestätigt ist, steht das Guthaben hier.</div></div>` : ''}

    <div class="grid four" style="margin-bottom:1.5rem">
      <div class="stat"><div class="k">Guthaben</div><div class="v">${credits(data.balance_mcr)}</div>
        <div class="s">${euro(Math.round((data.balance_mcr / 1000) * data.credit_cent))} Gegenwert</div></div>
      <div class="stat"><div class="k">Laufende Bots</div><div class="v">${data.running}</div>
        <div class="s">${data.rate_mcr_hour} mcr je Bot und Stunde</div></div>
      <div class="stat"><div class="k">Reicht noch</div>
        <div class="v">${data.hours_left === null ? '∞' : data.hours_left < 48 ? `${data.hours_left} h` : `${Math.round(data.hours_left / 24)} d`}</div>
        <div class="s">bei ${Math.max(data.running, 1)} Bot(s)</div></div>
      <div class="stat"><div class="k">Monat je Bot</div>
        <div class="v">${((data.rate_mcr_hour * 730) / 1000).toFixed(2).replace('.', ',')}</div>
        <div class="s">Credits bei Dauerbetrieb</div></div>
    </div>

    ${
      data.balance_mcr <= data.low_balance_mcr
        ? `<div class="note ${data.balance_mcr <= 0 ? 'bad' : 'warn'}" style="margin-bottom:1.5rem">${icon('alert')}
            <div>${
              data.balance_mcr <= 0
                ? 'Dein Guthaben ist aufgebraucht – Bots lassen sich erst nach dem Aufladen wieder starten.'
                : 'Dein Guthaben geht zur Neige. Lade nach, damit die Bots nicht mitten in der Nacht stoppen.'
            }</div></div>`
        : ''
    }

    <div class="grid two" style="align-items:start">
      <section class="panel">
        <header><h3>Verbrauch der letzten 14 Tage</h3></header>
        <div class="body">${chart(data.usage)}</div>
      </section>

      <section class="panel">
        <header><h3>Aufladen</h3></header>
        <div class="body stack">
          ${data.packages
            .map(
              (pack, index) => `<button class="row spread" data-pack="${index}"
                style="width:100%;text-align:left;padding:.7rem .9rem;border:0;cursor:pointer;
                border-radius:.75rem;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line)">
                <span>
                  <span class="strong">${credits(pack.credits_mcr, 0)} Credits</span>
                  <span class="small muted" style="display:block">
                    ${pack.bonus_mcr > 0 ? `inkl. ${credits(pack.bonus_mcr, 0)} Bonus · ` : ''}
                    ${Math.round(pack.credits_mcr / data.rate_mcr_hour / 24)} Bot-Tage</span>
                </span>
                <span class="mono strong">${euro(pack.cent)}</span>
              </button>`
            )
            .join('')}
          <p class="small muted">Möglich: ${methods(data)}. Guthaben verfällt nicht.</p>
        </div>
      </section>
    </div>

    ${
      data.topups.filter((entry) => entry.status === 'open').length
        ? `<section class="panel" style="margin-top:1.5rem">
            <header><h3>Offene Aufladungen</h3></header>
            <div class="body" style="padding:0"><div class="table-wrap"><table class="table">
              <thead><tr><th>Datum</th><th>Betrag</th><th>Weg</th><th>Verwendungszweck</th><th></th></tr></thead>
              <tbody>${data.topups
                .filter((entry) => entry.status === 'open')
                .map(
                  (entry) => `<tr>
                    <td class="small muted">${datetime(entry.created_at)}</td>
                    <td class="mono">${euro(entry.amount_cent)}</td>
                    <td class="small">${escapeHtml(entry.provider)}</td>
                    <td><span class="mono">${escapeHtml(entry.reference || '–')}</span>
                      ${entry.reference ? `<button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(entry.reference)}">${icon('copy')}</button>` : ''}</td>
                    <td style="text-align:right"><button class="btn btn-sm btn-danger" data-cancel="${entry.id}">Abbrechen</button></td>
                  </tr>`
                )
                .join('')}</tbody></table></div></div>
          </section>`
        : ''
    }

    <section class="panel" style="margin-top:1.5rem">
      <header><h3>Kontoauszug</h3>
        <span class="small muted">letzte ${data.history.length} Buchungen</span></header>
      <div class="body" style="padding:0">
        ${
          data.history.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>Zeitpunkt</th><th>Art</th><th>Beschreibung</th><th style="text-align:right">Betrag</th><th style="text-align:right">Stand</th></tr></thead>
                <tbody>${data.history
                  .map(
                    (entry) => `<tr>
                      <td class="small muted nowrap">${datetime(entry.created_at)}</td>
                      <td class="small">${escapeHtml(KINDS[entry.kind] || entry.kind)}</td>
                      <td class="small muted">${escapeHtml(entry.note || '')}</td>
                      <td class="mono" style="text-align:right;color:${entry.delta_mcr < 0 ? 'var(--text-2)' : 'var(--ok)'}">
                        ${entry.delta_mcr > 0 ? '+' : ''}${credits(entry.delta_mcr, 3)}</td>
                      <td class="mono muted" style="text-align:right">${credits(entry.balance_mcr)}</td>
                    </tr>`
                  )
                  .join('')}</tbody></table></div>`
            : '<p class="muted small" style="padding:1.25rem">Noch keine Buchungen.</p>'
        }
      </div>
    </section>`;

  $('#voucher').addEventListener('click', async () => {
    const form = await formDialog(
      'Gutschein einlösen',
      [{ key: 'code', label: 'Code', placeholder: 'ABCD-EFGH-JKLM-NPQR', value: '' }],
      { submit: 'Einlösen' }
    );
    if (!form) return;
    try {
      const result = await api('/billing/voucher', { method: 'POST', body: { code: form.code } });
      ok(`${credits(result.credits_mcr)} Credits gutgeschrieben.`);
      await refresh({ profiles: false, accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#topup').addEventListener('click', () => startTopup(data, 0));
  $$('[data-pack]').forEach((button) =>
    button.addEventListener('click', () => startTopup(data, Number(button.dataset.pack)))
  );
  $$('[data-copy]').forEach((button) =>
    button.addEventListener('click', () => copy(button.dataset.copy))
  );
  $$('[data-cancel]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api(`/billing/topup/${button.dataset.cancel}`, { method: 'DELETE' });
      draw();
    })
  );
}

function methods(data) {
  const list = [];
  if (data.methods.stripe) list.push('Kreditkarte');
  if (data.methods.transfer) list.push('Überweisung');
  if (data.methods.paypal) list.push('PayPal');
  list.push('Gutscheincode');
  return list.join(', ');
}

/** Einfaches Balkendiagramm – 14 Werte brauchen keine Bibliothek. */
function chart(usage) {
  const max = Math.max(1, ...usage.map((day) => day.mcr));
  return `<div style="display:flex;align-items:flex-end;gap:.35rem;height:9rem">
      ${usage
        .map(
          (day) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%"
            title="${day.day}: ${credits(day.mcr, 3)} Credits">
            <div style="height:${Math.max(2, (day.mcr / max) * 100)}%;border-radius:.25rem .25rem 0 0;
              background:${day.mcr ? 'var(--primary)' : 'var(--line)'};opacity:${day.mcr ? 0.85 : 1}"></div>
          </div>`
        )
        .join('')}
    </div>
    <div class="row spread small muted" style="margin-top:.5rem">
      <span>${usage[0]?.day.slice(5).replace('-', '.') || ''}</span>
      <span>heute</span>
    </div>
    <div class="small muted" style="margin-top:.35rem">Höchster Tag: ${credits(max, 3)} Credits</div>`;
}

async function startTopup(data, index) {
  const pack = data.packages[index];
  const ways = [];
  if (data.methods.stripe) ways.push({ value: 'stripe', label: 'Kreditkarte (Stripe)' });
  if (data.methods.transfer) ways.push({ value: 'transfer', label: 'Überweisung' });
  if (data.methods.paypal) ways.push({ value: 'paypal', label: 'PayPal' });

  if (!ways.length) {
    return fail(
      new Error(
        'Auf diesem Server ist kein Zahlungsweg eingerichtet. Bitte den Betreiber um einen Gutscheincode oder eine Aufbuchung.'
      )
    );
  }

  const form = await formDialog(
    `${credits(pack.credits_mcr, 0)} Credits für ${euro(pack.cent)}`,
    [{ key: 'provider', label: 'Zahlungsweg', type: 'select', value: ways[0].value, options: ways }],
    { submit: 'Weiter' }
  );
  if (!form) return;

  try {
    const result = await api('/billing/topup', {
      method: 'POST',
      body: { package: index, provider: form.provider },
    });
    if (result.redirect) {
      location.href = result.redirect;
      return;
    }
    showInstructions(result);
  } catch (error) {
    fail(error);
  }
}

function showInstructions(result) {
  const info = result.instructions;
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <header><h3>So lädst du auf</h3></header>
    <div class="body stack">
      <div class="note">${icon('info')}<div>${escapeHtml(info.note)}</div></div>
      <div class="field"><label>Betrag</label><div class="mono strong">${escapeHtml(info.amount)} €</div></div>
      <div class="field"><label>Verwendungszweck (unbedingt angeben)</label>
        <div class="row"><div class="mono strong grow" style="padding:.5rem .75rem;border-radius:.5rem;
          background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)">${escapeHtml(info.reference)}</div>
          <button class="btn btn-sm" id="copy-ref">${icon('copy')}</button></div></div>
      ${
        info.bank
          ? `<div class="field"><label>Bankverbindung</label>
              <div class="mono small">${escapeHtml(info.bank.holder || '')}<br>
              ${escapeHtml(info.bank.iban || '')}<br>${escapeHtml(info.bank.bic || '')}</div></div>`
          : ''
      }
      ${
        info.paypal
          ? `<a class="btn btn-primary btn-block" href="${escapeHtml(info.paypal)}" target="_blank" rel="noopener">
              PayPal öffnen ${icon('arrow')}</a>`
          : ''
      }
    </div>
    <footer><button class="btn btn-primary" id="close">Verstanden</button></footer>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => {
    dialog.remove();
    draw();
  });
  $('#close', dialog).addEventListener('click', () => dialog.close());
  $('#copy-ref', dialog).addEventListener('click', () => copy(info.reference));
}
