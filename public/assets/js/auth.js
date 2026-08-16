// Anmelden, Konto anlegen, Passwort vergessen, neues Passwort, E-Mail bestätigen.
//
// Fünf Seiten, ein Modul: die Vorlagen sind so gebaut, dass immer dieselben Felder-IDs
// vorkommen. Welche Seite gerade offen ist, steht in der Adresse.

import { api, tr, url, $ } from './ui.js';

const page = location.pathname.split('/')[2] || 'login';
const form = $('#form');
const errorBox = $('#error');
const query = new URLSearchParams(location.search);

function showError(message) {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.classList.remove('hide');
}

/** Absenden mit gesperrtem Knopf, damit nichts doppelt losläuft. */
function onSubmit(handler) {
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    errorBox?.classList.add('hide');
    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = tr('auth.working');
    try {
      await handler();
    } catch (problem) {
      showError(problem.message);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
}

const sameOrError = (a, b) => {
  if (a !== b) throw new Error(tr('auth.register.mismatch'));
};

// ---------------------------------------------------------------- Anmelden

/**
 * Die Knöpfe für Discord und Google einblenden.
 *
 * Welche Anbieter es gibt, steht in `meta.oauth` – je Anbieter `available` (eingerichtet) und
 * `login` (freigeschaltet). Vorher fragte diese Datei `meta.discord`, das es dort nie gab: der
 * Knopf blieb deshalb immer versteckt, auch wenn Discord vollständig eingerichtet war.
 *
 * Derselbe Weg dient dem Anmelden und dem Registrieren: gibt es zu der Identität noch kein Konto,
 * legt der Server eines an (siehe oauth.js).
 */
function showOauth(meta) {
  const providers = meta.oauth || {};
  let any = false;
  for (const key of ['discord', 'google']) {
    if (!providers[key]?.login) continue;
    $(`#oauth-${key}`)?.classList.remove('hide');
    any = true;
  }
  if (any) $('#oauth')?.classList.remove('hide');
}

if (page === 'login') {
  api('/meta').then(showOauth).catch(() => {});

  onSubmit(async () => {
    const result = await api('/auth/login', {
      method: 'POST',
      body: { login: $('#login').value, password: $('#password').value },
    });
    if (result.verify_pending) return location.assign(url('/verify'));
    location.assign(query.get('next') || url('/app'));
  });
}

// ---------------------------------------------------------------- Konto anlegen

if (page === 'register') {
  api('/meta')
    .then((meta) => {
      if (!meta.registration_open) {
        $('#closed')?.classList.remove('hide');
        form?.classList.add('hide');
        return; // ist zu, dann auch über Discord und Google
      }
      showOauth(meta);
    })
    .catch(() => {});

  onSubmit(async () => {
    sameOrError($('#password').value, $('#password2').value);
    const email = $('#email').value.trim();
    const result = await api('/auth/register', {
      method: 'POST',
      body: {
        email,
        username: $('#username').value.trim(),
        password: $('#password').value,
        password2: $('#password2').value,
      },
    });
    if (!result.verify_pending) return location.assign(url('/app'));
    $('#card').classList.add('hide');
    $('#sent').classList.remove('hide');
    $('#sent-text').textContent = tr('auth.register.checkMail.text', { email });
  });

  $('#resend')?.addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      await api('/auth/verify/resend', { method: 'POST' });
    } catch (problem) {
      showError(problem.message);
    }
  });
}

// ---------------------------------------------------------------- Passwort vergessen

if (page === 'forgot') {
  api('/meta')
    .then((meta) => {
      if (meta.mail_ready) return;
      $('#off')?.classList.remove('hide');
      form?.classList.add('hide');
    })
    .catch(() => {});

  onSubmit(async () => {
    await api('/auth/forgot', { method: 'POST', body: { email: $('#email').value.trim() } });
    form.classList.add('hide');
    $('#done').classList.remove('hide');
  });
}

// ---------------------------------------------------------------- Neues Passwort

if (page === 'reset') {
  const token = query.get('token') || '';
  if (!token) {
    form?.classList.add('hide');
    showError(tr('auth.reset.bad'));
    errorBox?.classList.remove('hide');
  }
  onSubmit(async () => {
    sameOrError($('#password').value, $('#password2').value);
    await api('/auth/reset', {
      method: 'POST',
      body: { token, password: $('#password').value, password2: $('#password2').value },
    });
    form.classList.add('hide');
    $('#done').classList.remove('hide');
  });
}

// ---------------------------------------------------------------- E-Mail bestätigen

if (page === 'verify') {
  const state = $('#state');
  const token = query.get('token') || '';
  if (token) {
    api('/auth/verify', { method: 'POST', body: { token } })
      .then(() => {
        state.textContent = tr('auth.verify.ok');
        $('#go').classList.remove('hide');
      })
      .catch(() => {
        state.textContent = tr('auth.verify.bad');
        $('#resend').classList.remove('hide');
      });
  } else {
    // Ohne Marke in der Adresse: der Hinweis für jemanden, der schon angemeldet, aber noch nicht
    // bestätigt ist.
    api('/meta')
      .then((meta) => {
        state.textContent = meta.user
          ? tr('auth.verify.pending.text', { email: meta.user.email })
          : tr('auth.verify.bad');
        if (meta.user) $('#resend').classList.remove('hide');
      })
      .catch(() => {
        state.textContent = tr('auth.verify.bad');
      });
  }

  $('#resend')?.addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      await api('/auth/verify/resend', { method: 'POST' });
      state.textContent = tr('auth.register.checkMail.title');
    } catch (problem) {
      state.textContent = problem.message;
      event.target.disabled = false;
    }
  });
}
