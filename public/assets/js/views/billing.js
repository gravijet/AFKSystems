// Guthaben: Stand, Serverplätze, Aufladen, Gutschein einlösen, Kontoauszug.

import {
  api, icon, escapeHtml, credits, euro, datetime, date, tr, $, $$, ok, fail, toast, copy, formDialog,
  locale,
} from '../ui.js';
import { appbar, refresh, draw } from '../app.js';
import * as chart from '../charts.js';

// Ein Formatierer für die ganze Achse statt einer je Monat (siehe ui.js).
const MONTH_SHORT = new Intl.DateTimeFormat(locale, { month: 'short' });

const KIND = {
  topup: 'bill.kind.topup',
  voucher: 'bill.kind.voucher',
  plan: 'bill.kind.plan',
  addon: 'bill.kind.addon',
  refund: 'bill.kind.refund',
  admin: 'bill.kind.admin',
  bonus: 'bill.kind.bonus',
};

export async function render(root) {
  const data = await api('/billing');
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const paidSlots = data.slots.filter((slot) => !slot.free_slot).length;

  root.innerHTML = `
    ${appbar(
      tr('bill.title'),
      `<button class="btn btn-primary btn-sm" id="topup">${icon('wallet')} ${escapeHtml(tr('bill.topUp'))}</button>`,
      tr('bill.sub')
    )}

    ${
      params.get('paid')
        ? `<div class="note" style="margin-bottom:1.25rem">${icon('check')}<div>${escapeHtml(
            tr('bill.transferNote')
          )}</div></div>`
        : ''
    }

    <div class="grid four" style="margin-bottom:1.5rem">
      <div class="stat"><div class="k">${escapeHtml(tr('bill.balance'))}</div>
        <div class="v">${credits(data.balance)}</div>
        <div class="s">${escapeHtml(euro(data.balance))}</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('bill.monthly'))}</div>
        <div class="v">${credits(data.monthly_cost)}</div>
        <div class="s">${escapeHtml(euro(data.monthly_cost))}</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('bill.monthsLeft'))}</div>
        <div class="v">${data.months_left === null ? '∞' : data.months_left}</div>
        <div class="s">${escapeHtml(
          data.months_left === null ? tr('ov.monthsPlenty') : tr('bill.months', { n: data.months_left })
        )}</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('bill.slots'))}</div>
        <div class="v">${data.slots.length}</div>
        <div class="s">${escapeHtml(
          tr('bill.slotsLine', { paid: paidSlots, free: data.slots.length - paidSlots })
        )}</div></div>
    </div>

    ${
      data.monthly_cost > 0 && data.balance <= data.low_balance
        ? `<div class="note ${data.balance <= 0 ? 'bad' : 'warn'}" style="margin-bottom:1.5rem">${icon('alert')}
            <div>${escapeHtml(
              data.balance <= 0
                ? tr('ov.noCredits')
                : tr('ov.lowCredits', {
                    credits: credits(data.balance),
                    cost: credits(data.monthly_cost),
                  })
            )}</div></div>`
        : ''
    }

    <!-- Aufladen steht zuerst und quer: es ist das eine, wofür man auf diese Seite kommt.
         Vorher war es eine schmale Spalte rechts, unter der die Pakete untereinander in die
         Länge liefen, und der Kontoauszug stand ganz unten außer Sichtweite. -->
    <section class="topup-box">
      <div class="topup-head">
        <div>
          <h2>${escapeHtml(tr('bill.topUpBig'))}</h2>
          <p>${escapeHtml(tr('bill.topUpLead'))}</p>
        </div>
        <button class="btn btn-lg btn-primary" id="topup-other">${icon('wallet')} ${escapeHtml(
          tr('bill.method')
        )}</button>
      </div>
      <div class="packs">
        ${data.packages
          .map(
            (pack, index) => `<button class="pack-card ${
              index === data.packages.length - 2 ? 'is-best' : ''
            }" data-pack="${index}">
              ${
                index === data.packages.length - 2
                  ? `<span class="pack-flag">${escapeHtml(tr('bill.mostPopular'))}</span>`
                  : ''
              }
              <span class="pack-price">${escapeHtml(pack.label)}</span>
              <span class="pack-get">${credits(pack.credits)} ${escapeHtml(tr('common.creditsInline'))}</span>
              <span class="pack-plus">${
                pack.bonus > 0
                  ? `+${credits(pack.bonus)} ${escapeHtml(tr('bill.bonus'))}`
                  : '&nbsp;'
              }</span>
            </button>`
          )
          .join('')}
      </div>
      <div class="row wrap topup-foot">
        <button class="btn btn-sm" id="voucher">${icon('ticket')} ${escapeHtml(tr('bill.voucher'))}</button>
        ${data.methods.stripe ? `<span class="small muted">${escapeHtml(tr('bill.card'))}</span>` : ''}
        ${data.methods.transfer ? `<span class="small muted">${escapeHtml(tr('bill.transfer'))}</span>` : ''}
        ${data.methods.paypal ? `<span class="small muted">${escapeHtml(tr('bill.paypal'))}</span>` : ''}
      </div>
      <!-- Der Umsatzsteuerhinweis gehört unter die Beträge und nicht erst auf den Beleg: Wer auf
           einen Preis klickt, soll vorher gelesen haben, was ihn davon erwartet. -->
      <p class="small muted" style="margin:.75rem 0 0">${escapeHtml(data.vat?.note || '')}</p>
    </section>

    ${
      data.topups.filter((topup) => topup.status === 'open').length
        ? `<section class="panel" style="margin-top:1.5rem">
            <header><h3>${escapeHtml(tr('bill.open'))}</h3></header>
            <div class="body stack">
              ${data.topups
                .filter((topup) => topup.status === 'open')
                .map(
                  (topup) => `<div class="row spread">
                    <span class="small">${escapeHtml(topup.provider)} · ${credits(topup.credits)} ${escapeHtml(
                      tr('common.credits')
                    )}</span>
                    <span class="row small muted mono">${escapeHtml(topup.reference || '')}
                      ${
                        topup.reference
                          ? `<button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(
                              topup.reference
                            )}">${icon('copy')}</button>`
                          : ''
                      }</span>
                  </div>`
                )
                .join('')}
            </div>
          </section>`
        : ''
    }

    ${money(data)}

    <div class="grid two" style="margin-top:1.5rem">
      <section class="panel">
        <header><h3>${escapeHtml(tr('bill.slots'))}</h3></header>
        <div class="body" style="padding:0">
          <div class="table-wrap"><table class="table">
            <thead><tr><th>${escapeHtml(tr('common.name'))}</th><th>${escapeHtml(tr('srv.plan'))}</th>
              <th>${escapeHtml(tr('common.month'))}</th><th></th></tr></thead>
            <tbody>${
              data.slots
                .map(
                  (slot) => `<tr>
                    <td><a href="#/servers/${slot.id}/plan">${escapeHtml(slot.name)}</a></td>
                    <td class="small muted">${escapeHtml(slot.plan)}</td>
                    <td class="mono small">${
                      slot.free_slot ? escapeHtml(tr('common.free')) : credits(slot.price_credits)
                    }</td>
                    <td class="small muted">${
                      slot.suspended
                        ? `<span class="pill missing">${escapeHtml(tr('tk.status.closed'))}</span>`
                        : slot.paid_until
                          ? `${escapeHtml(tr('srv.daysLeft', { n: slot.days_left }))} · ${date(slot.paid_until)}`
                          : escapeHtml(tr('common.forever'))
                    }</td>
                  </tr>`
                )
                .join('') ||
              `<tr><td colspan="4" class="small muted" style="padding:1.25rem">${escapeHtml(
                tr('dash.noServers')
              )}</td></tr>`
            }</tbody>
          </table></div>
        </div>
      </section>

      <section class="panel">
        <header>
          <h3>${escapeHtml(tr('bill.movements'))}</h3>
          <span class="small muted">${escapeHtml(tr('bill.movementsSub'))}</span>
        </header>
        <div class="body" style="padding:0">
          ${
            data.history.length
              ? `<ul class="ledger" id="ledger">${data.history.map(ledgerRow).join('')}</ul>
                 ${
                   data.history.length > 12
                     ? `<div class="row center" style="padding:.75rem">
                         <button class="btn btn-sm" id="more">${escapeHtml(tr('bill.showAll'))}</button></div>`
                     : ''
                 }`
              : `<p class="small muted" style="padding:1.25rem">${escapeHtml(tr('bill.noHistory'))}</p>`
          }
        </div>
      </section>
    </div>

    ${receipts(data.receipts || [])}`;

  /**
   * Drei Bilder zum Geld: Verlauf, Monate, Verteilung.
   *
   * Sie beantworten drei verschiedene Fragen, deshalb drei verschiedene Formen. „Wie steht es
   * gerade“ steht als Zahl in den Kacheln oben – dafür braucht es kein Diagramm.
   *
   *   * **Verlauf des Guthabens** (Linie): geht es rauf oder runter? Eine Reihe, also keine
   *     Legende; der Titel sagt, was gezeigt wird.
   *   * **Ausgaben je Monat** (Balken): war dieser Monat teurer als der letzte?
   *   * **Kosten je Serverplatz** (waagerechte Balken): welcher Platz kostet eigentlich was?
   *     Waagerecht, weil Serverplätze Namen haben und Namen waagerecht sind.
   *
   * Wer noch nie Guthaben bewegt hat, bekommt hier gar nichts: Drei leere Achsenkreuze sind keine
   * Auskunft, sondern Fläche.
   */
  function money(data_) {
    const days = data_.balance_days || [];
    const spend = data_.spend || [];
    const slots = data_.slot_costs || [];
    const spent = spend.reduce((sum, month) => sum + month.credits, 0);
    if (!spent && !slots.length && data_.balance <= 0) return '';

    const monthName = (key) => {
      const [year, month] = key.split('-');
      return MONTH_SHORT.format(new Date(Number(year), Number(month) - 1, 1));
    };
    // Auf der Achse steht Euro, nicht Credits: Der Kunde bezahlt in Euro, und "1.200" sagt weniger
    // als "12 €". Die genauen Credits stehen in der Sprechblase am Balken.
    const asEuro = (value) => `${(value / 100).toFixed(value >= 10_000 ? 0 : 2)} €`;

    return `<div class="grid three" style="margin-top:1.5rem">
      ${chart.card({
        title: tr('bill.chart.balance'),
        value: credits(data_.balance),
        note: tr('bill.chart.days', { n: days.length }),
        chart: chart.line(
          days.map((entry) => ({ label: entry.day, short: entry.day.slice(8), value: entry.credits })),
          { format: asEuro }
        ),
        foot: escapeHtml(euro(data_.balance)),
      })}
      ${chart.card({
        title: tr('bill.chart.spend'),
        value: credits(spend[spend.length - 1]?.credits || 0),
        note: tr('bill.chart.thisMonth'),
        chart: chart.bars(
          spend.map((month) => ({ label: month.month, short: monthName(month.month), value: month.credits })),
          { format: asEuro }
        ),
        foot: escapeHtml(tr('bill.chart.spendFoot', { total: credits(spent) })),
      })}
      ${chart.card({
        title: tr('bill.chart.slots'),
        value: credits(data_.monthly_cost),
        note: tr('bill.chart.perMonth'),
        chart: slots.length
          ? chart.hbars(
              slots.map((slot) => ({ label: slot.label, value: slot.credits })),
              { format: (value) => `${credits(value)}` }
            )
          : `<p class="small muted">${escapeHtml(tr('bill.chart.noSlots'))}</p>`,
        foot: escapeHtml(euro(data_.monthly_cost)),
      })}
    </div>`;
  }

  function ledgerRow(row, index) {
    return `<li class="${index >= 12 ? 'hide extra' : ''}">
      <span class="ledger-when small muted mono">${datetime(row.created_at)}</span>
      <span class="ledger-what">
        <span class="strong">${escapeHtml(tr(KIND[row.kind] || 'bill.kind.admin'))}</span>
        ${row.note ? `<span class="small muted"> · ${escapeHtml(row.note)}</span>` : ''}
      </span>
      <span class="ledger-delta mono ${row.delta >= 0 ? 'up' : ''}">${
        row.delta >= 0 ? '+' : ''
      }${credits(row.delta)}</span>
      <span class="ledger-balance mono small muted">${credits(row.balance)}</span>
    </li>`;
  }

  /**
   * Die Belege.
   *
   * Ein Beleg entsteht in dem Moment, in dem eine Zahlung verbucht wird, und ändert sich danach
   * nie wieder – Nummer, Anschrift und Steuerhinweis stehen als Abzug an der Aufladung. Hier
   * steht die Liste; das Dokument selbst kommt vom Server (server/receipt.js).
   *
   * Aufladungen von **vor** dieser Änderung haben keine Nummer und tauchen deshalb nicht auf.
   * Das ist ehrlicher, als ihnen nachträglich eine zu geben: Eine Belegnummer, die erst Monate
   * nach der Zahlung vergeben wurde, ist keine fortlaufende Nummer mehr.
   */
  function receipts(list) {
    if (!list.length) return '';
    return `<section class="panel" style="margin-top:1.5rem">
      <header>
        <h3>${escapeHtml(tr('bill.receipts'))}</h3>
        <span class="small muted">${escapeHtml(tr('bill.receiptsSub'))}</span>
      </header>
      <div class="body" style="padding:0">
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>${escapeHtml(tr('bill.receiptNo'))}</th>
            <th>${escapeHtml(tr('common.date'))}</th>
            <th>${escapeHtml(tr('bill.amount'))}</th>
            <th></th>
          </tr></thead>
          <tbody>${list
            .map(
              (entry) => `<tr>
                <td class="mono">${escapeHtml(entry.receipt_no)}
                  ${
                    entry.status === 'refunded'
                      ? `<span class="pill missing">${escapeHtml(tr('bill.kind.refund'))}</span>`
                      : ''
                  }</td>
                <td class="small muted">${date(entry.paid_at || entry.created_at)}</td>
                <td class="mono">${euro(entry.amount_cent)}</td>
                <td class="row" style="gap:.35rem;justify-content:flex-end">
                  <button class="btn btn-ghost btn-sm" data-print-receipt="${entry.id}"
                    title="${escapeHtml(tr('bill.receiptPrint'))}">${icon('download')}</button>
                  <a class="btn btn-ghost btn-sm" href="/api/billing/receipts/${entry.id}"
                    target="_blank" rel="noopener"
                    title="${escapeHtml(tr('bill.receiptOpen'))}">${icon('external')}</a>
                </td>
              </tr>`
            )
            .join('')}</tbody>
        </table></div>
      </div>
    </section>`;
  }

  $$('[data-copy]').forEach((button) =>
    button.addEventListener('click', () => copy(button.dataset.copy))
  );

  $$('[data-print-receipt]').forEach((button) =>
    button.addEventListener('click', () => printReceipt(button.dataset.printReceipt))
  );

  $$('[data-pack]').forEach((button) =>
    button.addEventListener('click', () => startTopup(data, Number(button.dataset.pack)))
  );
  $('#topup').addEventListener('click', () => startTopup(data, data.packages.length - 1));
  $('#topup-other').addEventListener('click', () => startTopup(data, data.packages.length - 1));

  $('#more')?.addEventListener('click', (event) => {
    $$('.ledger .extra').forEach((node) => node.classList.remove('hide'));
    event.target.remove();
  });

  $('#voucher').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('bill.voucher'),
      [{ key: 'code', label: tr('bill.voucherCode'), required: true }],
      { submit: tr('bill.voucher') }
    );
    if (!answer) return;
    try {
      const result = await api('/billing/voucher', { method: 'POST', body: { code: answer.code } });
      ok(tr('bill.voucherOk', { n: credits(result.credits) }));
      await refresh({ profiles: false, accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  });
}

/**
 * Einen Beleg drucken, ohne die Seite zu verlassen.
 *
 * Das Belegdokument selbst hat **kein JavaScript** – die Content-Security-Policy dieses Servers
 * lässt kein Inline-Skript zu, und auf einem Dokument mit den Angaben eines Kunden ist das auch
 * richtig so. Der Knopf gehört deshalb hierher: Der Beleg wird in einen unsichtbaren Rahmen
 * geladen (gleiche Herkunft, also darf das Panel ihn bedienen) und von dort gedruckt. Von wo aus
 * gedruckt wird, sieht am Ende niemand – im Druckdialog steht der Beleg.
 *
 * Der Rahmen wird nach dem Drucken wieder abgeräumt. Der Zeitgeber dafür ist keine Eleganz,
 * sondern Notwendigkeit: `print()` kehrt in manchen Browsern sofort zurück, in anderen erst nach
 * dem Schließen des Dialogs – wer den Rahmen zu früh entfernt, druckt eine leere Seite.
 */
async function printReceipt(id) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.src = `/api/billing/receipts/${encodeURIComponent(id)}`;
  document.body.append(frame);
  frame.addEventListener('load', () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      // Wenn der Browser das nicht mag, bleibt der gewöhnliche Weg daneben: der Link, der den
      // Beleg in einem eigenen Tab öffnet.
      toast(tr('bill.receiptOpen'));
    }
    setTimeout(() => frame.remove(), 60_000);
  });
  frame.addEventListener('error', () => frame.remove());
}

/** Zahlweg wählen, dann je nach Anbieter weiterleiten oder die Anweisung zeigen. */
async function startTopup(data, index) {
  // Ohne eingerichtete Pakete gibt es nichts aufzuladen. Vorher lief der Knopf trotzdem los,
  // griff mit dem Index -1 ins Leere und starb an `pack.label` – für den Kunden ein Knopf, der
  // gar nichts tut, und in der Konsole ein Fehler, den er nicht sieht.
  if (!data.packages.length) return fail(new Error(tr('bill.noPackages')));
  const methods = [];
  if (data.methods.stripe) methods.push({ value: 'stripe', label: tr('bill.card') });
  if (data.methods.transfer) methods.push({ value: 'transfer', label: tr('bill.transfer') });
  if (data.methods.paypal) methods.push({ value: 'paypal', label: tr('bill.paypal') });
  if (!methods.length) return fail(new Error(tr('pricing.onRequest')));

  const pack = data.packages[Math.max(0, Math.min(data.packages.length - 1, index))];
  const answer = await formDialog(
    tr('bill.topUp'),
    [
      {
        key: 'package',
        label: tr('bill.topUp'),
        type: 'select',
        value: String(index),
        options: data.packages.map((entry, i) => ({
          value: String(i),
          label: `${entry.label} → ${entry.credits} ${tr('common.credits')}`,
        })),
      },
      {
        key: 'provider',
        label: tr('bill.method'),
        type: 'select',
        value: methods[0].value,
        options: methods,
      },
      // Die Umsatzsteuer gehört vor den Klick und nicht erst auf den Beleg.
      ...(data.vat?.note ? [{ type: 'note', label: data.vat.note }] : []),
    ],
    { submit: tr('bill.topUp'), note: `${pack.label} · ${pack.credits} ${tr('common.credits')}` }
  );
  if (!answer) return;

  try {
    const result = await api('/billing/topup', {
      method: 'POST',
      body: { package: Number(answer.package), provider: answer.provider },
    });
    if (result.redirect) return location.assign(result.redirect);
    await instructions(result);
    draw();
  } catch (error) {
    fail(error);
  }
}

/** Überweisung und PayPal: Betrag und Verwendungszweck zum Abschreiben. */
function instructions(result) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <header><h3>${escapeHtml(tr('bill.transfer'))}</h3></header>
      <div class="body stack">
        <p class="small muted">${escapeHtml(tr('bill.transferNote'))}</p>
        <div class="row spread"><span class="muted small">${escapeHtml(tr('bill.topUp'))}</span>
          <span class="mono strong">${escapeHtml(result.instructions?.amount || '')} €</span></div>
        ${
          result.instructions?.bank?.iban
            ? `<div class="row spread"><span class="muted small">IBAN</span>
                 <span class="mono">${escapeHtml(result.instructions.bank.iban)}</span></div>
               <div class="row spread"><span class="muted small">${escapeHtml(tr('common.name'))}</span>
                 <span class="mono">${escapeHtml(result.instructions.bank.holder || '')}</span></div>`
            : ''
        }
        ${
          result.instructions?.paypal
            ? `<div class="row spread"><span class="muted small">PayPal</span>
                 <span class="mono">${escapeHtml(result.instructions.paypal)}</span></div>`
            : ''
        }
        <div class="row spread"><span class="muted small">${escapeHtml(tr('bill.reference'))}</span>
          <span class="mono strong">${escapeHtml(result.topup?.reference || '')}</span></div>
      </div>
      <footer>
        <button class="btn" id="copy-ref">${icon('copy')} ${escapeHtml(tr('common.copy'))}</button>
        <button class="btn btn-primary" id="done">${escapeHtml(tr('common.close'))}</button>
      </footer>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve();
    });
    $('#copy-ref', dialog).addEventListener('click', () => copy(result.topup?.reference || ''));
    $('#done', dialog).addEventListener('click', () => dialog.close());
    dialog.showModal();
  });
}
