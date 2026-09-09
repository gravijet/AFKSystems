// Anmelden, Konto anlegen, Passwort vergessen, neues Passwort, E-Mail bestätigen.
//
// Fünf Seiten, ein Modul: die Vorlagen sind so gebaut, dass immer dieselben Felder-IDs
// vorkommen. Welche Seite gerade offen ist, steht in der Adresse.

import { api, tr, url, $ } from './auth-runtime.js';

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

/**
 * Wohin es nach dem Anmelden weitergeht.
 *
 * `?next=` steht in der Adresse und darf deshalb alles sein. Das Dashboard schreibt dort nur
 * eigene Pfade hinein – aber ein Link von außen kann dasselbe Feld setzen, und eine
 * Anmeldemaske, die danach auf eine fremde Seite springt, ist genau die Vorlage für eine
 * nachgebaute Anmeldemaske: gleiche Adresse, gleiches Zertifikat, echter Login, fremde Landung.
 *
 * Erlaubt ist deshalb nur ein Pfad auf **dieser** Seite: mit einem Schrägstrich beginnend, aber
 * nicht mit zweien (`//fremd.example` ist für den Browser eine vollständige Adresse) und ohne
 * Gegenschrägstrich, den manche Browser wie einen Schrägstrich behandeln.
 */
function nextUrl(fallback) {
  const wanted = query.get('next') || '';
  if (!/^\/[^/\\]/.test(wanted)) return fallback;
  return wanted;
}

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
  api('/meta?scope=auth').then(showOauth).catch(() => {});

  /** Die Marke der offenen Code-Abfrage. Sie lebt nur in dieser Seite und in diesem Tab. */
  let challenge = null;

  const done = (result) => {
    if (result.verify_pending) return location.assign(url('/verify'));
    location.assign(nextUrl(url('/app')));
  };

  /**
   * Der Rückweg von Discord oder Google, wenn dort noch der zweite Faktor fehlt.
   *
   * Die Wartemarke steht dabei **nicht** in der Adresse, sondern in einem kurzlebigen Cookie
   * (siehe LOGIN_COOKIE in routes/core.js). Hier steht nur, dass es einen zweiten Schritt gibt.
   */
  if (query.get('step') === 'totp') askForTotp({});

  onSubmit(async () => {
    const result = await api('/auth/login', {
      method: 'POST',
      body: { login: $('#login').value, password: $('#password').value },
    });
    // Kommt eine Marke zurück, war das Passwort richtig und die Anmeldung trotzdem nicht fertig:
    // entweder fehlt der Code aus der App, oder dieser Browser ist neu und der Code aus der
    // E-Mail fehlt.
    if (result.kind === 'totp') return askForTotp(result);
    if (result.challenge) return askForCode(result);
    done(result);
  });

  /**
   * Auf den zweiten Schritt umblenden.
   *
   * Das Passwortfeld wird dabei geleert. Es steht in einer Karte, die gleich unsichtbar ist, und
   * ein Passwort, das im DOM einer Seite steht, die niemand mehr ansieht, ist ein Passwort, das
   * dort ohne Grund liegt – etwa während der Kunde in seinem Postfach nachsieht.
   */
  function askForCode(result) {
    challenge = result.challenge;
    $('#password').value = '';
    $('#login-card').classList.add('hide');
    $('#oauth')?.classList.add('hide');
    $('#code-card').classList.remove('hide');
    if (result.email_hint) {
      $('#code-lead').textContent = tr('auth.code.leadTo', { email: result.email_hint });
    }
    $('#code').value = '';
    $('#code').focus();
  }

  // ------------------------------------------------------------ Der zweite Faktor
  //
  // Dieselbe Umblendung wie beim Anmeldecode, mit einem Unterschied: Hier gibt es zwei Felder.
  // Das eine nimmt die sechs Ziffern aus der App, das andere einen der Wiederherstellungscodes.
  // Immer genau eines ist zu sehen – ein einzelnes Feld, das beides annimmt, könnte weder die
  // Zifferntastatur des Telefons anfordern noch dem Passwortmanager sagen, was es will.

  let totpChallenge = null;
  let onRecovery = false;

  function askForTotp(result) {
    totpChallenge = result.challenge || null;
    const password = $('#password');
    if (password) password.value = '';
    $('#login-card').classList.add('hide');
    $('#code-card')?.classList.add('hide');
    $('#oauth')?.classList.add('hide');
    $('#totp-card').classList.remove('hide');
    showRecovery(false);
  }

  function showRecovery(wanted) {
    onRecovery = wanted;
    $('#totp-app-field').classList.toggle('hide', wanted);
    $('#totp-recovery-field').classList.toggle('hide', !wanted);
    $('#totp-switch').textContent = tr(wanted ? 'auth.totp.useApp' : 'auth.totp.lost');
    $('#totp-lead').textContent = tr(wanted ? 'auth.totp.recoveryLead' : 'auth.totp.lead');
    const field = $(wanted ? '#totp-recovery' : '#totp-code');
    field.value = '';
    field.focus();
  }

  const totpError = $('#totp-error');
  $('#totp-switch')?.addEventListener('click', () => {
    totpError.classList.add('hide');
    showRecovery(!onRecovery);
  });

  // Sechs Ziffern schicken sich von selbst ab – wie beim Anmeldecode. Beim Wiederherstellungscode
  // nicht: Er ist elf Zeichen lang, und wer ihn abtippt, ist noch nicht fertig, wenn er einmal
  // kurz stehenbleibt.
  $('#totp-code')?.addEventListener('input', (event) => {
    const cleaned = event.target.value.replace(/\D/g, '').slice(0, 6);
    if (cleaned !== event.target.value) event.target.value = cleaned;
    if (cleaned.length === 6) $('#totp-form').requestSubmit();
  });

  // Groß, und der Bindestrich kommt von selbst. Auf dem Zettel steht er mit; wer ihn wegläs
  // st, soll trotzdem hereinkommen.
  $('#totp-recovery')?.addEventListener('input', (event) => {
    const raw = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    const shaped = raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
    if (shaped !== event.target.value) event.target.value = shaped;
  });

  $('#totp-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const label = button.textContent;
    totpError.classList.add('hide');
    button.disabled = true;
    button.textContent = tr('auth.working');
    try {
      const value = $(onRecovery ? '#totp-recovery' : '#totp-code').value;
      const result = await api('/auth/login/totp', {
        method: 'POST',
        body: { challenge: totpChallenge, code: value },
      });
      // Wer einen Wiederherstellungscode verbraucht hat, erfährt es hier und nicht erst, wenn
      // keiner mehr übrig ist. Der Hinweis reist als Anker mit ins Panel.
      if (result.recovery_used) {
        return location.assign(`${url('/app')}#/settings/security?recovery=${result.recovery_left}`);
      }
      done(result);
    } catch (problem) {
      totpError.textContent = problem.message;
      totpError.classList.remove('hide');
      if (problem.code === 'login-code-expired') backToPassword(problem.message);
      else {
        const field = $(onRecovery ? '#totp-recovery' : '#totp-code');
        field.value = '';
        field.focus();
      }
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });

  $('#totp-back')?.addEventListener('click', () => {
    totpChallenge = null;
    $('#totp-card').classList.add('hide');
    backToPassword('');
  });

  const codeForm = $('#code-form');
  const codeError = $('#code-error');
  const showCodeError = (message) => {
    codeError.textContent = message;
    codeError.classList.remove('hide');
  };

  // Nur Ziffern ins Feld, und bei sechsen von selbst abschicken. Wer einen Code aus einer E-Mail
  // einfügt, hat ihn oft mit einem Leerzeichen oder einem Bindestrich dabei; daran soll eine
  // Anmeldung nicht scheitern.
  $('#code')?.addEventListener('input', (event) => {
    const cleaned = event.target.value.replace(/\D/g, '').slice(0, 6);
    if (cleaned !== event.target.value) event.target.value = cleaned;
    if (cleaned.length === 6) codeForm.requestSubmit();
  });

  codeForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = codeForm.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const label = button.textContent;
    codeError.classList.add('hide');
    button.disabled = true;
    button.textContent = tr('auth.working');
    try {
      done(await api('/auth/login/code', { method: 'POST', body: { challenge, code: $('#code').value } }));
    } catch (problem) {
      showCodeError(problem.message);
      // Ist die Marke verfallen (abgelaufen oder fünfmal danebengetippt), führt kein Weg mehr
      // über dieses Feld. Dann zurück zum Passwort, statt jemanden weiter tippen zu lassen.
      if (problem.code === 'login-code-expired') backToPassword(problem.message);
      else {
        $('#code').value = '';
        $('#code').focus();
      }
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });

  $('#code-resend')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    codeError.classList.add('hide');
    try {
      const result = await api('/auth/login/code/resend', { method: 'POST', body: { challenge } });
      if (result.email_hint) {
        $('#code-lead').textContent = tr('auth.code.leadTo', { email: result.email_hint });
      }
      button.textContent = tr('auth.code.resent');
      // Der Knopf bleibt gesperrt: Der Server lässt ohnehin nur eine Nachricht je Minute durch,
      // und ein Knopf, der beim zweiten Druck eine Absage bringt, sieht kaputt aus.
    } catch (problem) {
      showCodeError(problem.message);
      button.disabled = false;
    }
  });

  $('#code-back')?.addEventListener('click', () => backToPassword(''));

  function backToPassword(message) {
    challenge = null;
    totpChallenge = null;
    $('#code-card').classList.add('hide');
    $('#totp-card')?.classList.add('hide');
    $('#login-card').classList.remove('hide');
    // Die Anbieterknöpfe kommen nur zurück, wenn sie vorher da waren: `showOauth` hat dann
    // mindestens einen von ihnen sichtbar gemacht. Ohne diese Frage stünde auf einem Panel ohne
    // Discord und Google nach einem Abbruch ein leerer Kasten mit dem Wort „oder“ darin.
    if (document.querySelector('#oauth a:not(.hide)')) $('#oauth')?.classList.remove('hide');
    if (message) showError(message);
    $('#password').focus();
  }
}

// ---------------------------------------------------------------- Konto anlegen

if (page === 'register') {
  // `?ref=` steht in jedem Empfehlungslink (siehe billing.js `/billing` und settings.js). Er reist
  // hier nur bis zum Absenden mit – gültig oder nicht, entscheidet erst `auth.js` `register()` auf
  // dem Server, ein unbekannter Code lässt die Anmeldung also nicht scheitern.
  const ref = query.get('ref') || '';

  api('/meta?scope=auth')
    .then((meta) => {
      if (!meta.registration_open) {
        $('#closed')?.classList.remove('hide');
        form?.classList.add('hide');
        return; // ist zu, dann auch über Discord und Google
      }
      showOauth(meta);
      if (ref) {
        for (const id of ['oauth-discord', 'oauth-google']) {
          const link = document.getElementById(id);
          if (link) link.href += `&ref=${encodeURIComponent(ref)}`;
        }
      }
    })
    .catch(() => {});

  onSubmit(async () => {
    sameOrError($('#password').value, $('#password2').value);
    const email = $('#email').value.trim();
    const result = await api('/auth/register', {
      method: 'POST',
      body: {
        email,
        full_name: $('#full_name').value.trim(),
        username: $('#username').value.trim(),
        password: $('#password').value,
        password2: $('#password2').value,
        ref: ref || undefined,
      },
    });
    if (!result.verify_pending) return location.assign(url('/app'));
    $('#card').classList.add('hide');
    $('#sent').classList.remove('hide');
    $('#sent-text').textContent = tr('auth.register.checkMail.text', { email });
  });

  $('#resend')?.addEventListener('click', async (event) => {
    const button = event.target;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = tr('auth.working');
    try {
      await api('/auth/verify/resend', { method: 'POST' });
      // Ohne Rückmeldung sah ein zweiter Klick aus wie ein toter Knopf: Der Aufruf war
      // erfolgreich, sichtbar änderte sich nichts, und der Knopf blieb für immer gesperrt.
      button.textContent = tr('auth.register.checkMail.title');
    } catch (problem) {
      showError(problem.message);
      button.textContent = label;
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- Passwort vergessen

if (page === 'forgot') {
  api('/meta?scope=auth')
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
    try {
      await api('/auth/reset', {
        method: 'POST',
        body: {
          token,
          password: $('#password').value,
          password2: $('#password2').value,
          code: $('#code')?.value || '',
        },
      });
    } catch (problem) {
      // **Zwei-Faktor.** Welches Konto hinter der Marke steht, weiß diese Seite nicht – der
      // Server sagt es mit `totp-required`, und erst dann kommt das Feld dazu. Ein Feld, das
      // vorsorglich für jeden dasteht, wäre für alle anderen eine Frage ohne Antwort.
      if (problem.code === 'totp-required') {
        $('#totp-field').classList.remove('hide');
        $('#code').focus();
      }
      throw problem;
    }
    form.classList.add('hide');
    $('#done').classList.remove('hide');
  });
}

// ---------------------------------------------------------------- E-Mail bestätigen

if (page === 'verify') {
  const state = $('#state');
  const token = query.get('token') || '';
  // Dieselbe Seite, zwei Marken: `token` bestätigt die Adresse eines frischen Kontos, `email` die
  // **neue** Adresse eines bestehenden. Eine zweite Seite dafür hätte dieselben drei Zeilen und
  // dieselbe Gestaltung – und einen zweiten Ort, an dem der Link falsch stehen kann.
  const emailToken = query.get('email') || '';
  if (emailToken) {
    api('/auth/email/confirm', { method: 'POST', body: { token: emailToken } })
      .then((result) => {
        state.textContent = tr('auth.verify.mailMoved', { email: result.email });
        $('#go').classList.remove('hide');
      })
      .catch((problem) => {
        state.textContent = problem.message || tr('auth.verify.bad');
      });
  } else if (token) {
    api('/auth/verify', { method: 'POST', body: { token } })
      .then((result) => {
        // Die Adresse ist bestätigt – angemeldet ist dieses Konto damit aber nur, wenn es keinen
        // zweiten Faktor hat. Sonst fehlt noch der Code aus der App, und der wird dort gefragt,
        // wo er hingehört: auf der Anmeldeseite. Die Wartemarke reist im Cookie mit.
        if (result?.totp) return location.assign(`/${result.lang || 'en'}/login?step=totp`);
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
    api('/meta?scope=auth')
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
