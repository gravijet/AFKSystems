// Umsatzsteuer – was auf Preisen, im Warenkorb und auf dem Beleg steht.
//
// Diese Datei steht bewusst **neben** dem Zahlungsdienst und nicht darin: Ob auf eine Leistung
// Umsatzsteuer anfällt, entscheidet das Steuerrecht am Sitz des Betreibers und nicht Stripe. Eine
// Überweisung von Hand und eine Kartenzahlung müssen dieselbe Zahl auf demselben Beleg ergeben –
// deshalb gibt es genau eine Stelle, die sagt, wie diese Zahl zustande kommt.
//
// **Zwei Betriebsarten**, mehr braucht ein Panel dieser Größe nicht:
//
//   small_business  Kleinunternehmerregelung. Der Preis ist der Endpreis, es wird **keine**
//                   Umsatzsteuer ausgewiesen, und auf Beleg und Preisseite steht der Grund dafür.
//                   Das ist die Vorgabe.
//   stripe_tax      Stripe Tax rechnet die Umsatzsteuer aus und weist sie an der Kasse aus. Der
//                   Preis im Panel gilt dann als Bruttopreis (tax_behavior = inclusive), damit
//                   „10 €“ auf der Preisseite auch 10 € auf der Abrechnung sind.
//
// Warum die Vorgabe so herum liegt: Wer als Kleinunternehmer irrtümlich 20 % ausweist, schuldet
// die ausgewiesene Steuer allein aufgrund der Rechnung. Ein Panel, das im Zweifel Umsatzsteuer
// aufschlägt, wäre also die teurere Voreinstellung – und die falsche für den Fall, für den dieses
// Projekt gebaut ist.
//
// Die Sätze selbst sind **Einstellungen** und kein Quelltext: Die Vorgabe nennt die österreichische
// Kleinunternehmerregelung, weil AFKSystems dort betrieben wird. Wer das Panel woanders betreibt,
// trägt seinen eigenen Satz ein (in Deutschland etwa § 19 UStG) – ohne eine Zeile zu ändern.

import { getSetting } from './db.js';
import { VAT_NOTE_DE, VAT_NOTE_EN } from './legal.js';

// Der Wortlaut steht in legal.js bei den übrigen Rechtstexten – dort holt ihn auch db.js als
// Vorgabe der Einstellung. Zweimal derselbe Satz an zwei Stellen im Quelltext wäre genau die Art
// von Doppelung, die irgendwann auseinandergeht.
export { VAT_NOTE_DE as DEFAULT_NOTE_DE, VAT_NOTE_EN as DEFAULT_NOTE_EN };

/**
 * Der Hinweis für den anderen Weg. Er ist **nicht** einstellbar, denn er beschreibt keine
 * Rechtslage, sondern das, was die Software dann tut: Stripe rechnet und weist aus.
 */
const TAXED_NOTE = {
  de: 'Alle Preise sind Endpreise inklusive Umsatzsteuer. Die Umsatzsteuer wird beim Bezahlen ausgewiesen.',
  en: 'All prices are final prices including VAT. The VAT is shown at checkout.',
};

/** `small_business` oder `stripe_tax`. Alles Unbekannte gilt als Kleinunternehmerregelung. */
export const mode = () =>
  String(getSetting('vat_mode') || '') === 'stripe_tax' ? 'stripe_tax' : 'small_business';

/** Wird auf den Verkauf keine Umsatzsteuer aufgeschlagen? */
export const smallBusiness = () => mode() === 'small_business';

/**
 * Der Satz unter dem Preis – auf der Preisseite, im Guthaben-Bereich, an der Kasse und im Beleg.
 *
 * Immer derselbe Wortlaut an allen vier Stellen. Ein Beleg, auf dem etwas anderes steht als im
 * Warenkorb, ist genau der Fall, den niemand erklären will.
 */
export function note(lang = 'de') {
  const en = lang === 'en';
  if (!smallBusiness()) return TAXED_NOTE[en ? 'en' : 'de'];
  // Ein leer gespeicherter Text ist keine Angabe, sondern ein leeres Feld: dann gilt die Vorgabe.
  // Ohne diesen Rückfall stünde unter dem Preis gar nichts – und „nichts“ heißt auf einer Rechnung
  // nicht „steuerfrei“, sondern „ungeklärt“.
  const stored = String(getSetting(en ? 'vat_note_en' : 'vat_note_de') || '').trim();
  return stored || (en ? VAT_NOTE_EN : VAT_NOTE_DE);
}

/** Was das Frontend über die Umsatzsteuer wissen muss. */
export const view = (lang = 'de') => ({
  mode: mode(),
  shows_vat: !smallBusiness(),
  note: note(lang),
});
