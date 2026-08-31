// Die wiederkehrenden Aufgaben – eine Liste statt sieben anonymer `setInterval`.
//
// Im Panel laufen ein paar Dinge im Takt: die Abrechnung, das Nachfassen bei den Gratis-Plätzen,
// der Wiederanlauf abgestürzter Bots, die eigene Auslastungsmeldung, das Aufräumen. Sie standen
// als sieben `setInterval`-Aufrufe in index.js, jeder mit einer eigenen Zahl daneben, und über
// jeden von ihnen wusste der Betreiber genau eines: nichts. Ob die Abrechnung heute Nacht lief,
// wie lange sie brauchte, ob sie einen Fehler geworfen hat – das stand höchstens im journal, und
// auch dort nur, wenn es schiefging.
//
// Hier stehen sie stattdessen in einem Verzeichnis, das sich anschauen lässt: wann zuletzt, wie
// lange, mit welchem Ergebnis, wann wieder. Und mit einem Knopf daneben, der sie **jetzt** laufen
// lässt – denn die häufigste Frage an eine stündliche Aufgabe ist "musste ich wirklich eine
// Stunde warten, um zu sehen, ob es jetzt geht?".
//
// **Der Schutz von vorher bleibt.** Ein Fehler in einer Aufgabe ohne Aufrufer ist in Node eine
// unbehandelte Ausnahme, und die beendet den Prozess – mit ihm jeden laufenden Bot. Deshalb
// fängt jeder Durchlauf hier alles ab: Eine kaputte Einstellung darf höchstens einen Durchlauf
// kosten, beim nächsten ist sie vielleicht schon behoben. Der Fehler geht dabei nicht verloren,
// er steht danach in der Liste.
//
// **Zwei Läufe derselben Aufgabe überlappen nicht.** Wer auf "jetzt laufen" drückt, während der
// Takt gerade dieselbe Aufgabe ausführt, bekommt keinen zweiten Durchlauf, sondern denselben.

const jobs = new Map();

/**
 * Eine Aufgabe eintragen und ihren Takt starten.
 *
 * `run` darf synchron sein oder ein Promise zurückgeben – beides wird gleich behandelt, und in
 * beiden Fällen zählt die Zeit bis zum Ende und nicht bis zur Rückkehr.
 */
export function every(key, intervalMs, run, { label = {}, unref = true, manual = true } = {}) {
  const job = {
    key,
    label,
    interval_ms: intervalMs,
    run,
    manual,
    runs: 0,
    last_at: null,
    last_ms: null,
    last_error: null,
    running: false,
    timer: null,
  };
  jobs.set(key, job);
  job.timer = setInterval(() => {
    tick(job).catch(() => {});
  }, intervalMs);
  if (unref) job.timer.unref();
  return job;
}

async function tick(job) {
  // Läuft sie schon, ist der laufende Durchlauf die Antwort. Ein zweiter parallel dazu würde bei
  // der Abrechnung bedeuten: zweimal abbuchen.
  if (job.running) return { skipped: true };
  job.running = true;
  const started = Date.now();
  try {
    await job.run();
    job.last_error = null;
  } catch (error) {
    job.last_error = String(error?.message || error).slice(0, 500);
    console.error(`[takt ${job.key}]`, error);
  } finally {
    job.running = false;
    job.runs += 1;
    job.last_at = Date.now();
    job.last_ms = job.last_at - started;
  }
  return { skipped: false, error: job.last_error };
}

/** Eine Aufgabe von Hand anstoßen. Gibt zurück, was daraus wurde. */
export async function runNow(key) {
  const job = jobs.get(key);
  if (!job || !job.manual) return null;
  const result = await tick(job);
  return { ...view(job), skipped: result.skipped };
}

const view = (job) => ({
  key: job.key,
  label: job.label,
  interval_ms: job.interval_ms,
  manual: job.manual,
  runs: job.runs,
  last_at: job.last_at,
  last_ms: job.last_ms,
  last_error: job.last_error,
  running: job.running,
  // Wann wieder: Der Takt zählt ab dem Start des Dienstes und nicht ab dem letzten Lauf – die
  // Angabe ist deshalb eine Schätzung und heißt in der Ansicht auch so.
  next_at: job.last_at ? job.last_at + job.interval_ms : null,
});

export function list() {
  return [...jobs.values()].map(view);
}

/** Für Tests: alle Takte anhalten. Im Betrieb endet das mit dem Prozess. */
export function stopAll() {
  for (const job of jobs.values()) clearInterval(job.timer);
  jobs.clear();
}
