// Guthaben: Stand, Serverplätze, Aufladen, Gutschein einlösen, Kontoauszug.

import { api, icon, escapeHtml, credits, euro, datetime, date, tr, $, $$, ok, fail, copy, formDialog } from '../ui.js';
import { state, appbar, refresh, draw } from '../app.js';

const KIND = {
  topup: 'bill.kind.topup',
  voucher: 'bill.kind.voucher',
  plan: 'bill.kind.plan',
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
      `<button class="btn btn-sm" id="voucher">${icon('ticket')} ${escapeHtml(tr('bill.voucher'))}</button>
       <button class="btn btn-primary btn-sm" id="topup">${icon('wallet')} ${escapeHtml(tr('bill.topUp'))}</button>`,
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

    <div class="grid two" style="align-items:start">
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
        <header><h3>${escapeHtml(tr('bill.topUp'))}</h3></header>
        <div class="body stack">
          ${data.packages
            .map(
              (pack, index) => `<button class="row spread pack-button" data-pack="${index}">
                <span>
                  <span class="strong">${credits(pack.credits)} ${escapeHtml(tr('common.credits'))}</span>
                  <span class="small muted" style="display:block">
                    ${pack.bonus > 0 ? `+${credits(pack.bonus)} ${escapeHtml(tr('pricing.topup.bonus'))}` : '&nbsp;'}
                  </span>
                </span>
                <span class="strong mono">${escapeHtml(pack.label)}</span>
              </button>`
            )
            .join('')}
          <p class="small muted">${escapeHtml(tr('pricing.topup.lead'))}</p>
        </div>
      </section>
    </div>

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

    <section class="panel" style="margin-top:1.5rem">
      <header><h3>${escapeHtml(tr('bill.history'))}</h3></header>
      <div class="body" style="padding:0">
        ${
          data.history.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>${escapeHtml(tr('common.status'))}</th><th></th>
                  <th style="text-align:right">${escapeHtml(tr('common.credits'))}</th>
                  <th style="text-align:right">${escapeHtml(tr('bill.balance'))}</th></tr></thead>
                <tbody>${data.history
                  .map(
                    (row) => `<tr>
                      <td class="small muted mono">${datetime(row.created_at)}</td>
                      <td>${escapeHtml(tr(KIND[row.kind] || 'bill.kind.admin'))}
                        ${row.note ? `<span class="small muted">· ${escapeHtml(row.note)}</span>` : ''}</td>
                      <td class="mono" style="text-align:right;color:${
                        row.delta >= 0 ? 'var(--ok)' : 'var(--text)'
                      }">${row.delta >= 0 ? '+' : ''}${credits(row.delta)}</td>
                      <td class="mono small muted" style="text-align:right">${credits(row.balance)}</td>
                    </tr>`
                  )
                  .join('')}</tbody>
              </table></div>`
            : `<p class="small muted" style="padding:1.25rem">${escapeHtml(tr('bill.noHistory'))}</p>`
        }
      </div>
    </section>`;

  $$('[data-copy]').forEach((button) =>
    button.addEventListener('click', () => copy(button.dataset.copy))
  );

  $$('[data-pack]').forEach((button) =>
    button.addEventListener('click', () => startTopup(data, Number(button.dataset.pack)))
  );
  $('#topup').addEventListener('click', () => startTopup(data, data.packages.length - 1));

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
  if (data.methods.stripe) methods.push({ value: 'stripe', label: tr('bill.card') });
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
