// Guthaben: Stand, Serverplätze, Aufladen, Gutschein einlösen, Kontoauszug.

import { api, icon, escapeHtml, credits, euro, datetime, date, tr, $, $$, ok, fail, copy, formDialog } from '../ui.js';
import { appbar, refresh, draw } from '../app.js';

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
        ${
          data.methods.tebex
            ? `<span class="small muted">${escapeHtml(tr('bill.card'))}${
                data.tebex_store
                  ? ` · <a href="${escapeHtml(data.tebex_store)}" target="_blank" rel="noopener">${escapeHtml(
                      tr('bill.store')
                    )}</a>`
                  : ''
              }</span>`
            : ''
        }
        ${data.methods.transfer ? `<span class="small muted">${escapeHtml(tr('bill.transfer'))}</span>` : ''}
        ${data.methods.paypal ? `<span class="small muted">${escapeHtml(tr('bill.paypal'))}</span>` : ''}
      </div>
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
    </div>`;

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

  $$('[data-copy]').forEach((button) =>
    button.addEventListener('click', () => copy(button.dataset.copy))
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

/** Zahlweg wählen, dann je nach Anbieter weiterleiten oder die Anweisung zeigen. */
async function startTopup(data, index) {
  const methods = [];
  if (data.methods.tebex) methods.push({ value: 'tebex', label: tr('bill.card') });
  if (data.methods.transfer) methods.push({ value: 'transfer', label: tr('bill.transfer') });
  if (data.methods.paypal) methods.push({ value: 'paypal', label: tr('bill.paypal') });
  if (!methods.length) return fail(new Error(tr('pricing.onRequest')));

  const pack = data.packages[index];
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
