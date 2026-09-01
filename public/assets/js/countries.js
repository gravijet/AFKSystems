// Länder – als Nachschlagewerk für die Rechnungsadresse.
//
// Diese Datei teilen sich **beide Seiten**, wie i18n.js und chatlog.js: Der Browser baut daraus
// die Auswahlliste im Panel, der Server prüft damit, ob ein Kürzel überhaupt ein Land ist, und
// schreibt den Landesnamen auf den Beleg. Deshalb steht hier reines ESM ohne Browser-Aufrufe.
//
// Der Schlüssel ist der **Zweibuchstaben-Code nach ISO 3166-1** und nichts anderes. In der
// Datenbank steht genau dieses Kürzel: Es ist kurz, es ändert sich nicht, und Stripe, Post und
// Steuerrecht sprechen dieselbe Sprache. Der Name daneben ist Anzeige – er darf sich ändern,
// ohne dass eine einzige gespeicherte Adresse angefasst werden muss.
//
// Die Liste ist absichtlich vollständig und nicht "die zwanzig wichtigsten": Wer aus einem Land
// kommt, das jemand für unwichtig hielt, kann seine Rechnungsadresse sonst gar nicht eintragen.

/** Kürzel -> [Englisch, Deutsch]. */
export const COUNTRIES = {
  AD: ['Andorra', 'Andorra'],
  AE: ['United Arab Emirates', 'Vereinigte Arabische Emirate'],
  AF: ['Afghanistan', 'Afghanistan'],
  AG: ['Antigua and Barbuda', 'Antigua und Barbuda'],
  AI: ['Anguilla', 'Anguilla'],
  AL: ['Albania', 'Albanien'],
  AM: ['Armenia', 'Armenien'],
  AO: ['Angola', 'Angola'],
  AR: ['Argentina', 'Argentinien'],
  AS: ['American Samoa', 'Amerikanisch-Samoa'],
  AT: ['Austria', 'Österreich'],
  AU: ['Australia', 'Australien'],
  AW: ['Aruba', 'Aruba'],
  AX: ['Åland Islands', 'Åland'],
  AZ: ['Azerbaijan', 'Aserbaidschan'],
  BA: ['Bosnia and Herzegovina', 'Bosnien und Herzegowina'],
  BB: ['Barbados', 'Barbados'],
  BD: ['Bangladesh', 'Bangladesch'],
  BE: ['Belgium', 'Belgien'],
  BF: ['Burkina Faso', 'Burkina Faso'],
  BG: ['Bulgaria', 'Bulgarien'],
  BH: ['Bahrain', 'Bahrain'],
  BI: ['Burundi', 'Burundi'],
  BJ: ['Benin', 'Benin'],
  BL: ['Saint Barthélemy', 'Saint-Barthélemy'],
  BM: ['Bermuda', 'Bermuda'],
  BN: ['Brunei', 'Brunei'],
  BO: ['Bolivia', 'Bolivien'],
  BQ: ['Caribbean Netherlands', 'Karibische Niederlande'],
  BR: ['Brazil', 'Brasilien'],
  BS: ['Bahamas', 'Bahamas'],
  BT: ['Bhutan', 'Bhutan'],
  BW: ['Botswana', 'Botsuana'],
  BY: ['Belarus', 'Belarus'],
  BZ: ['Belize', 'Belize'],
  CA: ['Canada', 'Kanada'],
  CD: ['Congo (Kinshasa)', 'Kongo (Kinshasa)'],
  CF: ['Central African Republic', 'Zentralafrikanische Republik'],
  CG: ['Congo (Brazzaville)', 'Kongo (Brazzaville)'],
  CH: ['Switzerland', 'Schweiz'],
  CI: ['Côte d’Ivoire', 'Côte d’Ivoire'],
  CK: ['Cook Islands', 'Cookinseln'],
  CL: ['Chile', 'Chile'],
  CM: ['Cameroon', 'Kamerun'],
  CN: ['China', 'China'],
  CO: ['Colombia', 'Kolumbien'],
  CR: ['Costa Rica', 'Costa Rica'],
  CU: ['Cuba', 'Kuba'],
  CV: ['Cabo Verde', 'Kap Verde'],
  CW: ['Curaçao', 'Curaçao'],
  CY: ['Cyprus', 'Zypern'],
  CZ: ['Czechia', 'Tschechien'],
  DE: ['Germany', 'Deutschland'],
  DJ: ['Djibouti', 'Dschibuti'],
  DK: ['Denmark', 'Dänemark'],
  DM: ['Dominica', 'Dominica'],
  DO: ['Dominican Republic', 'Dominikanische Republik'],
  DZ: ['Algeria', 'Algerien'],
  EC: ['Ecuador', 'Ecuador'],
  EE: ['Estonia', 'Estland'],
  EG: ['Egypt', 'Ägypten'],
  ER: ['Eritrea', 'Eritrea'],
  ES: ['Spain', 'Spanien'],
  ET: ['Ethiopia', 'Äthiopien'],
  FI: ['Finland', 'Finnland'],
  FJ: ['Fiji', 'Fidschi'],
  FK: ['Falkland Islands', 'Falklandinseln'],
  FM: ['Micronesia', 'Mikronesien'],
  FO: ['Faroe Islands', 'Färöer'],
  FR: ['France', 'Frankreich'],
  GA: ['Gabon', 'Gabun'],
  GB: ['United Kingdom', 'Vereinigtes Königreich'],
  GD: ['Grenada', 'Grenada'],
  GE: ['Georgia', 'Georgien'],
  GF: ['French Guiana', 'Französisch-Guayana'],
  GG: ['Guernsey', 'Guernsey'],
  GH: ['Ghana', 'Ghana'],
  GI: ['Gibraltar', 'Gibraltar'],
  GL: ['Greenland', 'Grönland'],
  GM: ['Gambia', 'Gambia'],
  GN: ['Guinea', 'Guinea'],
  GP: ['Guadeloupe', 'Guadeloupe'],
  GQ: ['Equatorial Guinea', 'Äquatorialguinea'],
  GR: ['Greece', 'Griechenland'],
  GT: ['Guatemala', 'Guatemala'],
  GU: ['Guam', 'Guam'],
  GW: ['Guinea-Bissau', 'Guinea-Bissau'],
  GY: ['Guyana', 'Guyana'],
  HK: ['Hong Kong', 'Hongkong'],
  HN: ['Honduras', 'Honduras'],
  HR: ['Croatia', 'Kroatien'],
  HT: ['Haiti', 'Haiti'],
  HU: ['Hungary', 'Ungarn'],
  ID: ['Indonesia', 'Indonesien'],
  IE: ['Ireland', 'Irland'],
  IL: ['Israel', 'Israel'],
  IM: ['Isle of Man', 'Isle of Man'],
  IN: ['India', 'Indien'],
  IQ: ['Iraq', 'Irak'],
  IR: ['Iran', 'Iran'],
  IS: ['Iceland', 'Island'],
  IT: ['Italy', 'Italien'],
  JE: ['Jersey', 'Jersey'],
  JM: ['Jamaica', 'Jamaika'],
  JO: ['Jordan', 'Jordanien'],
  JP: ['Japan', 'Japan'],
  KE: ['Kenya', 'Kenia'],
  KG: ['Kyrgyzstan', 'Kirgisistan'],
  KH: ['Cambodia', 'Kambodscha'],
  KI: ['Kiribati', 'Kiribati'],
  KM: ['Comoros', 'Komoren'],
  KN: ['Saint Kitts and Nevis', 'St. Kitts und Nevis'],
  KP: ['North Korea', 'Nordkorea'],
  KR: ['South Korea', 'Südkorea'],
  KW: ['Kuwait', 'Kuwait'],
  KY: ['Cayman Islands', 'Kaimaninseln'],
  KZ: ['Kazakhstan', 'Kasachstan'],
  LA: ['Laos', 'Laos'],
  LB: ['Lebanon', 'Libanon'],
  LC: ['Saint Lucia', 'St. Lucia'],
  LI: ['Liechtenstein', 'Liechtenstein'],
  LK: ['Sri Lanka', 'Sri Lanka'],
  LR: ['Liberia', 'Liberia'],
  LS: ['Lesotho', 'Lesotho'],
  LT: ['Lithuania', 'Litauen'],
  LU: ['Luxembourg', 'Luxemburg'],
  LV: ['Latvia', 'Lettland'],
  LY: ['Libya', 'Libyen'],
  MA: ['Morocco', 'Marokko'],
  MC: ['Monaco', 'Monaco'],
  MD: ['Moldova', 'Moldau'],
  ME: ['Montenegro', 'Montenegro'],
  MF: ['Saint Martin', 'Saint-Martin'],
  MG: ['Madagascar', 'Madagaskar'],
  MH: ['Marshall Islands', 'Marshallinseln'],
  MK: ['North Macedonia', 'Nordmazedonien'],
  ML: ['Mali', 'Mali'],
  MM: ['Myanmar', 'Myanmar'],
  MN: ['Mongolia', 'Mongolei'],
  MO: ['Macao', 'Macau'],
  MP: ['Northern Mariana Islands', 'Nördliche Marianen'],
  MQ: ['Martinique', 'Martinique'],
  MR: ['Mauritania', 'Mauretanien'],
  MS: ['Montserrat', 'Montserrat'],
  MT: ['Malta', 'Malta'],
  MU: ['Mauritius', 'Mauritius'],
  MV: ['Maldives', 'Malediven'],
  MW: ['Malawi', 'Malawi'],
  MX: ['Mexico', 'Mexiko'],
  MY: ['Malaysia', 'Malaysia'],
  MZ: ['Mozambique', 'Mosambik'],
  NA: ['Namibia', 'Namibia'],
  NC: ['New Caledonia', 'Neukaledonien'],
  NE: ['Niger', 'Niger'],
  NF: ['Norfolk Island', 'Norfolkinsel'],
  NG: ['Nigeria', 'Nigeria'],
  NI: ['Nicaragua', 'Nicaragua'],
  NL: ['Netherlands', 'Niederlande'],
  NO: ['Norway', 'Norwegen'],
  NP: ['Nepal', 'Nepal'],
  NR: ['Nauru', 'Nauru'],
  NU: ['Niue', 'Niue'],
  NZ: ['New Zealand', 'Neuseeland'],
  OM: ['Oman', 'Oman'],
  PA: ['Panama', 'Panama'],
  PE: ['Peru', 'Peru'],
  PF: ['French Polynesia', 'Französisch-Polynesien'],
  PG: ['Papua New Guinea', 'Papua-Neuguinea'],
  PH: ['Philippines', 'Philippinen'],
  PK: ['Pakistan', 'Pakistan'],
  PL: ['Poland', 'Polen'],
  PM: ['Saint Pierre and Miquelon', 'Saint-Pierre und Miquelon'],
  PR: ['Puerto Rico', 'Puerto Rico'],
  PS: ['Palestine', 'Palästina'],
  PT: ['Portugal', 'Portugal'],
  PW: ['Palau', 'Palau'],
  PY: ['Paraguay', 'Paraguay'],
  QA: ['Qatar', 'Katar'],
  RE: ['Réunion', 'Réunion'],
  RO: ['Romania', 'Rumänien'],
  RS: ['Serbia', 'Serbien'],
  RU: ['Russia', 'Russland'],
  RW: ['Rwanda', 'Ruanda'],
  SA: ['Saudi Arabia', 'Saudi-Arabien'],
  SB: ['Solomon Islands', 'Salomonen'],
  SC: ['Seychelles', 'Seychellen'],
  SD: ['Sudan', 'Sudan'],
  SE: ['Sweden', 'Schweden'],
  SG: ['Singapore', 'Singapur'],
  SI: ['Slovenia', 'Slowenien'],
  SK: ['Slovakia', 'Slowakei'],
  SL: ['Sierra Leone', 'Sierra Leone'],
  SM: ['San Marino', 'San Marino'],
  SN: ['Senegal', 'Senegal'],
  SO: ['Somalia', 'Somalia'],
  SR: ['Suriname', 'Suriname'],
  SS: ['South Sudan', 'Südsudan'],
  ST: ['São Tomé and Príncipe', 'São Tomé und Príncipe'],
  SV: ['El Salvador', 'El Salvador'],
  SX: ['Sint Maarten', 'Sint Maarten'],
  SY: ['Syria', 'Syrien'],
  SZ: ['Eswatini', 'Eswatini'],
  TC: ['Turks and Caicos Islands', 'Turks- und Caicosinseln'],
  TD: ['Chad', 'Tschad'],
  TG: ['Togo', 'Togo'],
  TH: ['Thailand', 'Thailand'],
  TJ: ['Tajikistan', 'Tadschikistan'],
  TL: ['Timor-Leste', 'Timor-Leste'],
  TM: ['Turkmenistan', 'Turkmenistan'],
  TN: ['Tunisia', 'Tunesien'],
  TO: ['Tonga', 'Tonga'],
  TR: ['Türkiye', 'Türkei'],
  TT: ['Trinidad and Tobago', 'Trinidad und Tobago'],
  TV: ['Tuvalu', 'Tuvalu'],
  TW: ['Taiwan', 'Taiwan'],
  TZ: ['Tanzania', 'Tansania'],
  UA: ['Ukraine', 'Ukraine'],
  UG: ['Uganda', 'Uganda'],
  US: ['United States', 'Vereinigte Staaten'],
  UY: ['Uruguay', 'Uruguay'],
  UZ: ['Uzbekistan', 'Usbekistan'],
  VA: ['Vatican City', 'Vatikanstadt'],
  VC: ['Saint Vincent and the Grenadines', 'St. Vincent und die Grenadinen'],
  VE: ['Venezuela', 'Venezuela'],
  VG: ['British Virgin Islands', 'Britische Jungferninseln'],
  VI: ['U.S. Virgin Islands', 'Amerikanische Jungferninseln'],
  VN: ['Vietnam', 'Vietnam'],
  VU: ['Vanuatu', 'Vanuatu'],
  WF: ['Wallis and Futuna', 'Wallis und Futuna'],
  WS: ['Samoa', 'Samoa'],
  XK: ['Kosovo', 'Kosovo'],
  YE: ['Yemen', 'Jemen'],
  YT: ['Mayotte', 'Mayotte'],
  ZA: ['South Africa', 'Südafrika'],
  ZM: ['Zambia', 'Sambia'],
  ZW: ['Zimbabwe', 'Simbabwe'],
};

/** Gibt es dieses Kürzel? Groß-/Kleinschreibung ist egal, gespeichert wird groß. */
export const isCountry = (code) =>
  Object.hasOwn(COUNTRIES, String(code || '').trim().toUpperCase());

/** Der Name eines Landes in der gewünschten Sprache. Unbekannt heißt: das Kürzel selbst. */
export function countryName(code, lang = 'en') {
  const key = String(code || '').trim().toUpperCase();
  const entry = COUNTRIES[key];
  if (!entry) return key;
  return lang === 'de' ? entry[1] : entry[0];
}

/**
 * Alle Länder, alphabetisch **in der jeweiligen Sprache**.
 *
 * Sortiert mit `Intl.Collator`, nicht mit `<`: Sonst stünde Österreich hinter Zypern, weil "Ö"
 * einen höheren Codepunkt hat als "Z". In einer Liste mit 240 Einträgen findet das niemand wieder.
 */
export function countryList(lang = 'en') {
  const collator = new Intl.Collator(lang === 'de' ? 'de' : 'en');
  return Object.entries(COUNTRIES)
    .map(([code, names]) => ({ code, name: lang === 'de' ? names[1] : names[0] }))
    .sort((left, right) => collator.compare(left.name, right.name));
}

/**
 * Die Länder, in denen das Kürzel vor die Postleitzahl gehört – oder eben nicht.
 *
 * Das ist keine Schönheitsfrage: In den Vereinigten Staaten steht der Bundesstaat zwischen Ort und
 * Postleitzahl ("Springfield, IL 62704"), im deutschsprachigen Raum die Postleitzahl vor dem Ort.
 * Eine Adresse, die in der falschen Reihenfolge auf dem Beleg steht, ist keine Adresse, sondern
 * eine Aufzählung.
 */
const CITY_FIRST = new Set(['US', 'CA', 'AU', 'NZ', 'IE', 'GB', 'MY', 'IN', 'ZA']);

/**
 * Eine Anschrift als Zeilen, wie sie auf einen Brief gehört.
 *
 * `value` ist ein Objekt mit den Feldern aus der Datenbank – aus dem Konto oder aus dem Abzug,
 * der beim Verbuchen einer Aufladung festgehalten wurde. Leere Felder fallen weg; kommt gar
 * nichts zusammen, kommt eine leere Liste zurück, und der Aufrufer entscheidet, was er dann sagt.
 */
export function addressLines(value = {}, lang = 'en') {
  const clean = (key) => String(value?.[key] ?? '').trim();
  const country = clean('country').toUpperCase();
  const postal = clean('postal_code');
  const city = clean('city');
  const region = clean('region');

  let locality = '';
  if (CITY_FIRST.has(country)) {
    locality = [city, [region, postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  } else {
    locality = [postal, city].filter(Boolean).join(' ');
    if (region) locality = locality ? `${locality} (${region})` : region;
  }

  return [
    clean('company'),
    clean('full_name'),
    clean('street'),
    clean('street2'),
    locality,
    country ? countryName(country, lang) : '',
  ].filter(Boolean);
}
