// Inhaltsschutz im Browser.
//
// Ehrlich vorweg: Eine Seite, die ein Browser anzeigen kann, kann ein Mensch mit genug Aufwand
// auch mitnehmen. Diese Datei verspricht das Gegenteil nicht. Sie verschließt die **bequemen**
// Wege – Rechtsklick, Markieren, Ziehen, Drucken, Quelltext, Entwicklerwerkzeuge – und macht das
// Abgreifen damit von "zwei Klicks" zu "Arbeit". Genau das tun große Anbieter auch.
//
// Drei Regeln halten sie davon ab, im Weg zu stehen:
//
//   1. **Eingabefelder bleiben Eingabefelder.** Markieren, Kopieren und Einfügen funktionieren
//      dort wie überall, sonst wäre das Panel nicht bedienbar.
//   2. **Was zum Abschreiben da ist, bleibt kopierbar.** Verwendungszwecke, Gutscheincodes,
//      Standort-Token, Serveradressen, Chatzeilen: alles mit `.mono`, `code`, `pre` oder
//      `[data-copyable]`.
//   3. **Kein `debugger`-Käfig.** Der friert die Seite ein, kostet Rechenzeit und trifft den
//      Betreiber genauso wie den Neugierigen. Offene Entwicklerwerkzeuge blenden hier den Inhalt
//      aus – das ist derselbe Effekt ohne den Schaden.
//
// Kein Bündel, kein Modul, keine Abhängigkeit: die Datei läuft im <head>, damit der Schutz steht,
// bevor der erste Inhalt sichtbar ist. Sie kostet ein paar Ereignis-Anmeldungen und sonst nichts.

(function shield() {
  'use strict';
  // Der Server schreibt an das <html>-Element, ob der Schutz an ist. Es steht schon, wenn diese
  // Datei im <head> läuft – der <body> dagegen noch nicht, und ohne den Schutz vor dem ersten
  // Bild wäre er ein Schutz für die zweite Sekunde.
  var root = document.documentElement;
  if (!root || root.dataset.shield !== '1') return;
  root.classList.add('shielded');

  /**
   * Stellen, an denen Markieren und Kopieren erlaubt bleiben.
   *
   * Zwei Gruppen: Felder, in die man tippt, und Stellen, an denen **eigene Daten** stehen –
   * Chatverlauf, Konsole, Tabellenzellen, Anzeigetafel, alles in Schreibmaschinenschrift. Was
   * geschützt gehört, ist die Gestaltung der Seite, nicht die Serveradresse eines Kunden.
   */
  var FREE =
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], ' +
    '.mono, code, pre, kbd, [data-copyable], .side-find, .node-token, ' +
    '.console, .line, .log, .board, td, th';

  function isFree(target) {
    return Boolean(target && target.closest && target.closest(FREE));
  }

  // ---------------------------------------------------------------- Maus

  document.addEventListener(
    'contextmenu',
    function (event) {
      if (isFree(event.target)) return;
      event.preventDefault();
    },
    true
  );

  // Bilder und Links aus der Seite ziehen ist der schnellste Weg, sie zu speichern.
  document.addEventListener(
    'dragstart',
    function (event) {
      if (isFree(event.target)) return;
      event.preventDefault();
    },
    true
  );

  document.addEventListener(
    'selectstart',
    function (event) {
      if (isFree(event.target)) return;
      event.preventDefault();
    },
    true
  );

  // ---------------------------------------------------------------- Kopieren

  document.addEventListener(
    'copy',
    function (event) {
      if (!isFree(event.target)) {
        event.preventDefault();
        return;
      }
      // Was kopiert werden darf, bekommt bei längeren Stücken die Quelle mit. Ein Gutscheincode
      // oder eine Serveradresse bleibt unangetastet – dort wäre ein Zusatz nur lästig.
      var text = String(window.getSelection ? window.getSelection() : '');
      if (text.length < 120 || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData('text/plain', text + '\n\n— ' + location.host);
    },
    true
  );

  document.addEventListener(
    'cut',
    function (event) {
      if (!isFree(event.target)) event.preventDefault();
    },
    true
  );

  // ---------------------------------------------------------------- Tastatur
  //
  // Was der Browser abfangen lässt, wird abgefangen. F12 und das Menü lassen sich nicht überall
  // verhindern – dafür gibt es weiter unten die Erkennung.

  var BLOCKED = { s: 1, u: 1, p: 1 }; // speichern, Quelltext, drucken
  var BLOCKED_SHIFT = { i: 1, j: 1, c: 1, k: 1 }; // Entwicklerwerkzeuge, Konsole, Inspektor

  document.addEventListener(
    'keydown',
    function (event) {
      var key = String(event.key || '').toLowerCase();
      if (key === 'f12') {
        event.preventDefault();
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.shiftKey && BLOCKED_SHIFT[key]) {
        event.preventDefault();
        return;
      }
      if (!event.shiftKey && BLOCKED[key]) {
        // Ctrl+S in einem Eingabefeld meint fast immer "speichern" im Sinne der Anwendung, nicht
        // "Seite speichern" – aber eine Anwendung, die auf Ctrl+S hört, gibt es hier nicht.
        event.preventDefault();
      }
    },
    true
  );

  // ---------------------------------------------------------------- Entwicklerwerkzeuge
  //
  // Zwei Anzeichen, beide ohne Dauerbetrieb:
  //
  //   * Angedockte Werkzeuge machen das Fenster innen deutlich kleiner als außen. Geprüft wird
  //     das beim Verändern der Fenstergröße, nicht in einer Schleife.
  //   * Ein Objekt, dessen `id` beim Ausgeben abgefragt wird. Das passiert nur, wenn eine Konsole
  //     es wirklich darstellt. Der Aufruf steht in `console.debug`, damit er sonst nirgends stört.
  //
  // Beides ist kein Beweis, sondern ein Verdacht – deshalb wird nichts blockiert, sondern nur der
  // Inhalt verdeckt, solange der Verdacht besteht.

  var shown = false;
  function setOpen(open) {
    if (open === shown) return;
    shown = open;
    document.documentElement.classList.toggle('devtools-open', open);
  }

  function bySize() {
    // Ein abgedocktes Fenster verrät sich so nicht – dafür ist die zweite Prüfung da.
    return (
      window.outerWidth - window.innerWidth > 180 || window.outerHeight - window.innerHeight > 220
    );
  }

  var probe = { id: 0 };
  var probed = false;
  Object.defineProperty(probe, 'id', {
    get: function () {
      probed = true;
      return '';
    },
  });

  function check() {
    probed = false;
    try {
      console.debug(probe);
      // Was hineinging, gehört nicht in ein Protokoll, das jemand später liest.
      if (console.clear && probed) console.clear();
    } catch (error) {
      /* eine Umgebung ohne Konsole ist kein Problem */
    }
    setOpen(probed || bySize());
  }

  check();
  window.addEventListener('resize', check, { passive: true });
  window.addEventListener('focus', check);
  // Ein einziger langsamer Takt als Netz für alles, was weder Größe noch Fokus ändert. Alle fünf
  // Sekunden ein Vergleich zweier Zahlen kostet nichts messbar.
  setInterval(check, 5000);
})();
