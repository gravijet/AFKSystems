// Vorgabetexte für die öffentlichen Rechtseiten. Der Betreiber kann beide Fassungen weiterhin
// unter Administration → Einstellungen → Recht überschreiben. Die Texte beschreiben nur
// Datenflüsse, die dieses Projekt tatsächlich hat; eine erfundene Firma oder Anschrift gehört
// ausdrücklich nicht hier hinein.

/**
 * Der Umsatzsteuerhinweis unter jedem Preis und auf jedem Beleg.
 *
 * Vorgabe ist die **österreichische Kleinunternehmerregelung**, weil AFKSystems dort betrieben
 * wird: Solange die Umsatzgrenze nicht überschritten ist, wird auf den Verkauf keine
 * Umsatzsteuer aufgeschlagen und auf der Rechnung auch keine ausgewiesen – wohl aber der Grund
 * dafür genannt. Wer als Kleinunternehmer trotzdem Umsatzsteuer ausweist, schuldet sie allein
 * aufgrund der Rechnung; deshalb steht hier ein Hinweis und keine Steuerzeile.
 *
 * Beides ist im Admin-Bereich unter *Umsatzsteuer* überschreibbar – wer das Panel anderswo
 * betreibt, trägt seinen eigenen Satz ein (in Deutschland etwa § 19 UStG). Die Regel selbst,
 * ob überhaupt Umsatzsteuer anfällt, entscheidet die Einstellung `vat_mode` (siehe vat.js).
 */
export const VAT_NOTE_DE =
  'Umsatzsteuerfrei aufgrund der Kleinunternehmerregelung gemäß § 6 Abs. 1 Z 27 UStG.';
export const VAT_NOTE_EN =
  'Exempt from VAT under the Austrian small-business scheme (§ 6 (1) 27 UStG).';

export const PRIVACY_DE = `Stand: 15. September 2026

## 1. Verantwortlicher und Kontakt

AFKSystems ist der Verantwortliche für die Verarbeitung personenbezogener Daten in diesem Dienst. AFKSystems wird außerhalb Deutschlands betrieben. Datenschutzanfragen können über ein Support-Ticket im Panel, per E-Mail an support@afksystems.de oder über den auf der Website verlinkten AFKSystems-Discord gestellt werden. Eine Anfrage zu Betroffenenrechten ist kostenlos; zur Vermeidung einer Herausgabe an Unbefugte kann ein Nachweis der Kontoinhaberschaft verlangt werden.

## 2. Welche Daten verarbeitet werden

- Konto- und Profildaten: E-Mail-Adresse, Benutzername, Passwort nur als kryptografischer Hash, Sprache und Einstellungen. Freiwillig zusätzlich die Angaben, die auf einen Beleg gehören: bürgerlicher Name, Firmierung, Umsatzsteuer-Identifikationsnummer, Rechnungsanschrift, Telefonnummer, eine abweichende Adresse für Belege und die Zeitzone. Diese Angaben sind für die Nutzung des Dienstes nicht erforderlich; ohne sie trägt ein Beleg nur den Kontonamen.
- Anmeldedaten: Sitzungskennung, Zeitpunkt, IP-Adresse und gekürzte Browser-/Geräteangabe. Sitzungskennungen liegen in einem HttpOnly-Cookie und sind für JavaScript nicht lesbar.
- Verknüpfte Dienste: bei freiwilliger Nutzung die von Discord oder Google übermittelte Konto-ID, Name, E-Mail-Adresse, Profilbild und Status der Discord-Mitgliedschaft. AFKSystems erhält dabei niemals das Passwort des jeweiligen Anbieters.
- Minecraft-Betriebsdaten: Kontoname und UUID, Zielserver, Version, Bot-Einstellungen, Befehle, Makros, Verbindungszustände und technische Protokolle. Für Microsoft-Konten wird die von Microsoft bereitgestellte Geräteanmeldung verwendet; Zugangsdaten werden nicht im Browser abgefragt.
- Kommunikationsdaten: Ticketinhalte, Beteiligte, Status, Discord-Zuordnung, Chat- und Supportnachrichten sowie vom Dienst versandte E-Mails.
- Abrechnungsdaten: Guthabenbewegungen, gebuchte Tarife und Zusätze, Zahlungsbetrag, Zahlungsart, Referenz und Status. Zu jeder verbuchten Zahlung entsteht ein Beleg mit fortlaufender Nummer; die darauf gedruckten Angaben (Anschrift, Firmierung, Umsatzsteuerhinweis) werden im Moment der Buchung festgehalten und bleiben danach unverändert, weil ein Beleg ein Nachweis über einen bestimmten Zeitpunkt ist. Kartenzahlungen und die übrigen elektronischen Zahlarten werden von Stripe (Stripe Payments Europe, Limited) als Zahlungsdienstleister abgewickelt. Kartennummern und Sicherheitsmerkmale werden ausschließlich bei Stripe eingegeben und verarbeitet; AFKSystems erhält sie nicht. An AFKSystems zurück gemeldet werden die Kennung des Zahlungsvorgangs, der Betrag, die Währung, der Zahlungsstatus, die E-Mail-Adresse des Zahlenden und die Zuordnung zur jeweiligen Aufladung. Verkäufer der Leistung ist AFKSystems selbst und nicht Stripe.
- Sicherheits- und Betriebsdaten: Audit-Ereignisse, Fehlermeldungen, Missbrauchsindikatoren sowie Server- und Prozessmetriken.
- Reichweitenstatistik: Aufrufe der öffentlichen Seiten mit Adresse, Land, verweisender Seite und ob es sich erkennbar um einen automatisierten Abruf (Suchmaschine, Werkzeug) statt einen Menschen handelt. Dafür wird kein Cookie gesetzt und keine IP-Adresse gespeichert; ein "eindeutiger Besucher" ergibt sich aus einem Kennwert, der jede Nacht neu gebildet wird und sich nicht auf eine Person oder ein Gerät zurückführen lässt.

## 3. Zwecke und Rechtsgrundlagen

Die Daten werden verarbeitet, um das Konto und die gebuchten Bot-Dienste bereitzustellen, Zahlungen und Guthaben abzuwickeln, Support zu leisten, Störungen zu beheben und den Dienst gegen Missbrauch zu schützen. Soweit die DSGVO anwendbar ist, stützt sich die Verarbeitung je nach Vorgang auf die Vertragserfüllung oder vorvertragliche Maßnahmen (Art. 6 Abs. 1 lit. b DSGVO), gesetzliche Pflichten insbesondere für Zahlungsnachweise (Art. 6 Abs. 1 lit. c DSGVO), berechtigte Interessen an einem sicheren und zuverlässigen Betrieb (Art. 6 Abs. 1 lit. f DSGVO) oder eine freiwillige, jederzeit widerrufliche Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).

## 4. Empfänger und externe Dienste

Daten erhalten nur Personen und Dienstleister, die sie für Betrieb, Hosting, Support oder Abrechnung benötigen. Je nach freiwillig genutzter Funktion werden Daten an Discord, Google, Microsoft oder Stripe übermittelt. Profilbilder können außerdem von Gravatar geladen werden; dabei erhält Gravatar den MD5-Abdruck der normalisierten E-Mail-Adresse sowie die technisch üblichen Abrufdaten (insbesondere IP-Adresse und Browserangaben), nicht die E-Mail-Adresse im Klartext. In den Kontoeinstellungen kann stattdessen Discord, Google oder die rein lokale Initialen-Darstellung gewählt werden. Beim Verbinden eines Bots sieht der gewählte Minecraft-Server technisch notwendige Angaben wie Minecraft-Name, UUID, Verbindungs-IP und die gesendeten Spielaktionen. E-Mail-Anbieter verarbeiten Absender, Empfänger und Nachrichteninhalt. Eine Weitergabe zu Werbezwecken oder ein Verkauf personenbezogener Daten findet nicht statt.

Diese Anbieter können Daten in Ländern außerhalb des Wohnsitzlandes oder außerhalb der EU/des EWR verarbeiten. In diesem Fall richtet sich die Übermittlung nach den anwendbaren gesetzlichen Voraussetzungen und den Schutzmechanismen des jeweiligen Anbieters. Die Datenschutzbestimmungen des gewählten Drittanbieters gelten zusätzlich.

## 5. Cookies und lokale Speicherung

AFKSystems verwendet keine Werbe- oder Tracking-Cookies. Erforderlich sind ein HttpOnly-Sitzungscookie für die Anmeldung sowie ein Sprachcookie. Sprache, Farbschema, eingeklappte Navigation und gelesene Hinweise können zusätzlich lokal im Browser gespeichert werden. Diese lokalen Angaben verlassen den Browser nur, wenn eine Funktion sie ausdrücklich mit dem Konto synchronisiert.

## 6. Speicherdauer

Kontodaten werden grundsätzlich während der Nutzung des Dienstes gespeichert. Wird das Konto im Panel zur Löschung angemeldet, ruhen die Dienste sofort; die vollständige Löschung erfolgt nach einer Frist von vierzehn Tagen und kann bis dahin jederzeit im Panel widerrufen werden. Sitzungen enden nach Ablauf, Abmeldung oder Widerruf. Technische Protokolle und Sicherheitsdaten werden nur so lange aufbewahrt, wie dies für Fehleranalyse, Sicherheit und Missbrauchsprävention erforderlich ist. Zeilen der Reichweitenstatistik werden nach sechs Monaten gelöscht. Ticket- und Vertragsdaten bleiben für die Bearbeitung und mögliche Nachweise gespeichert. Zahlungs- und Buchungsdaten werden nach den anwendbaren handels-, steuer- oder verbraucherrechtlichen Fristen aufbewahrt. Danach werden Daten gelöscht oder anonymisiert, sofern keine offenen Ansprüche, Sicherheitsvorfälle oder gesetzlichen Pflichten entgegenstehen.

## 7. Rechte

Soweit das anwendbare Datenschutzrecht dies vorsieht, bestehen Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Auskunft und Datenübertragbarkeit lassen sich ohne Anfrage ausüben: Unter Einstellungen → Deine Daten steht der vollständige Datenbestand des Kontos als maschinenlesbare Datei zum Herunterladen bereit, und dort wird auch die Löschung des Kontos angestoßen. Berichtigung erfolgt ebenfalls im Panel, indem die Angaben geändert werden. Eine Einwilligung kann jederzeit mit Wirkung für die Zukunft widerrufen werden. Außerdem kann eine Beschwerde bei der zuständigen Datenschutzaufsichtsbehörde eingereicht werden. Gesetzlich notwendige Daten oder Daten, die zur Erfüllung eines laufenden Vertrags erforderlich sind, können erst nach dessen Ende gelöscht werden.

## 8. Sicherheit und automatisierte Entscheidungen

AFKSystems verwendet unter anderem verschlüsselte HTTPS-Verbindungen, gehashte Passwörter, zufällige widerrufbare Sitzungen, rollenbasierte Zugriffe, Eingabevalidierung, Sicherheitsheader und geschützte Serverdateien. Kein Internetdienst kann absolute Sicherheit garantieren. Es findet keine ausschließlich automatisierte Entscheidung mit rechtlicher oder ähnlich erheblicher Wirkung statt. Automatische Tarifverlängerungen aus vorhandenem Guthaben und technische Schutzsperren folgen den vom Nutzer gewählten Einstellungen beziehungsweise nachvollziehbaren Sicherheitsregeln.

## 9. Änderungen

Diese Erklärung wird angepasst, wenn sich Funktionen, Anbieter oder rechtliche Anforderungen ändern. Die jeweils aktuelle Fassung und ihr Stand werden auf dieser Seite veröffentlicht.`;

export const PRIVACY_EN = `Last updated: 15 September 2026

## 1. Controller and contact

AFKSystems is the controller for personal data processed by this service. AFKSystems is operated outside Germany. Privacy requests may be submitted through a support ticket in the panel, by email to support@afksystems.de, or through the AFKSystems Discord linked on the website. Exercising a data protection right is free of charge; proof of account ownership may be requested to prevent disclosure to an unauthorised person.

## 2. Data we process

- Account and profile data: email address, username, password only as a cryptographic hash, language and settings. Optionally, the details that belong on a receipt: legal name, company, VAT identification number, billing address, phone number, a separate address for receipts, and the time zone. These are not required to use the service; without them a receipt carries only the account name.
- Sign-in data: session identifier, time, IP address and shortened browser/device information. Session identifiers are held in an HttpOnly cookie and cannot be read by JavaScript.
- Linked services: when used voluntarily, the account ID, name, email address, avatar and Discord membership status supplied by Discord or Google. AFKSystems never receives the password used with those providers.
- Minecraft operations: account name and UUID, destination server, version, bot settings, commands, macros, connection states and technical logs. Microsoft accounts use Microsoft's device sign-in flow; credentials are not requested in the browser.
- Communications: ticket contents, participants, status, Discord mapping, chat and support messages, and emails sent by the service.
- Billing data: credit movements, plans and add-ons, payment amount, method, reference and status. Every settled payment produces a receipt with a sequential number; what is printed on it (address, company, VAT note) is recorded at the moment of settlement and stays unchanged afterwards, because a receipt is evidence about a particular point in time. Card payments and the other electronic payment methods are processed by Stripe (Stripe Payments Europe, Limited) as payment service provider. Card numbers and security details are entered and processed at Stripe only; AFKSystems does not receive them. What is reported back to AFKSystems is the payment identifier, amount, currency, payment status, the payer's email address and which top-up it belongs to. AFKSystems, not Stripe, is the seller of the service.
- Security and operations: audit events, errors, abuse signals, and server or process metrics.
- Reach statistics: page views on the public pages, with the address, country, referring site and whether the request is recognisably automated (a search engine or tool) rather than a human. No cookie is set for this and no IP address is stored; a "unique visitor" is derived from a value recalculated every night that cannot be traced back to a person or device.

## 3. Purposes and legal bases

Data is processed to provide accounts and booked bot services, handle payments and credits, provide support, diagnose faults and protect the service from abuse. Where the GDPR applies, processing is based, depending on the activity, on performance of a contract or pre-contractual steps (Article 6(1)(b)), compliance with a legal obligation, particularly payment records (Article 6(1)(c)), legitimate interests in secure and reliable operation (Article 6(1)(f)), or freely given consent that may be withdrawn at any time (Article 6(1)(a)).

## 4. Recipients and external services

Data is available only to people and providers that need it for operation, hosting, support or billing. Depending on features chosen voluntarily, data is sent to Discord, Google, Microsoft or Stripe. Profile pictures may also be loaded from Gravatar; Gravatar receives the MD5 digest of the normalised email address and ordinary request data (in particular IP address and browser information), not the plain-text email address. The account settings can instead pin Discord or Google, or use the entirely local initials image. When a bot connects, the selected Minecraft server necessarily receives information such as Minecraft name, UUID, connection IP address and game actions sent. Email providers process sender, recipient and message contents. Personal data is not sold or disclosed for advertising.

Those providers may process information outside the user's country or outside the EU/EEA. Such transfers are made in accordance with applicable legal requirements and the safeguards offered by the provider. The privacy terms of a selected third-party service also apply.

## 5. Cookies and local storage

AFKSystems uses no advertising or tracking cookies. An HttpOnly session cookie is necessary for sign-in and a language cookie stores the selected language. Language, colour theme, collapsed navigation and dismissed notices may also be stored locally in the browser. Local values do not leave the browser unless a feature expressly synchronises them with the account.

## 6. Retention

Account data is generally held while the service is used. If the account is scheduled for deletion in the panel, the services stop immediately; full deletion follows after a grace period of fourteen days and can be cancelled in the panel at any time until then. Sessions end when they expire, the user signs out or they are revoked. Technical logs and security information are kept only as long as reasonably needed for diagnostics, security and abuse prevention. Reach statistics rows are deleted after six months. Ticket and contract data is retained for handling and possible evidence. Payment and accounting records are kept for the periods required by applicable commercial, tax or consumer law. Data is then deleted or anonymised unless an unresolved claim, security incident or legal obligation requires continued retention.

## 7. Rights

Where applicable law provides, users have rights of access, correction, erasure, restriction, portability and objection. Access and portability can be exercised without asking: Settings → Your data offers the account's complete record as a machine-readable file, and account deletion is started from the same place. Correction likewise happens in the panel, by changing the details. Consent can be withdrawn at any time for the future. A complaint may also be made to the competent data protection authority. Information required by law or needed to perform an active contract may be deleted only after that requirement ends.

## 8. Security and automated decisions

AFKSystems uses measures including encrypted HTTPS connections, hashed passwords, random revocable sessions, role-based access, input validation, security headers and protected server files. No internet service can promise absolute security. There is no solely automated decision producing legal or similarly significant effects. Automatic plan renewals from an available credit balance and technical security restrictions follow the user's settings or explainable security rules.

## 9. Changes

This notice is updated when functions, providers or legal requirements change. The current version and its date are published on this page.`;

export const TERMS_DE = `Stand: 1. September 2026

## 1. Geltung und Vertragspartner

Diese Nutzungsbedingungen gelten für Konten und Leistungen von AFKSystems. AFKSystems wird außerhalb Deutschlands betrieben und ist über Support-Tickets im Panel, per E-Mail an support@afksystems.de sowie über den auf der Website verlinkten Discord erreichbar. Mit der Registrierung werden diese Bedingungen und die Datenschutzerklärung akzeptiert. Zwingende gesetzliche Rechte, insbesondere Verbraucherrechte, bleiben unberührt.

## 2. Leistung

AFKSystems betreibt Minecraft-AFK-Clients auf eigener oder angebundener Infrastruktur. Funktionsumfang, Bot-Anzahl, Verlauf und Zusätze richten sich nach dem gewählten Tarif, den Angaben auf der Preisseite und den technischen Fähigkeiten des jeweils verfügbaren Clients. AFKSystems ist kein offizielles Angebot von Mojang oder Microsoft und wird von diesen Unternehmen weder geprüft noch unterstützt.

Der kostenlose Serverplatz setzt ein verknüpftes Discord-Konto und die Mitgliedschaft im angegebenen AFKSystems-Discord voraus. Entfällt diese Voraussetzung, darf der kostenlose Platz angehalten werden. Kostenlose Funktionen können mit angemessener Vorankündigung geändert oder eingestellt werden.

## 3. Konto und Sicherheit

Nutzer müssen richtige Kontaktdaten angeben, ihre Zugangsdaten geheim halten und unbefugte Nutzung unverzüglich melden. Pro Person soll nur ein AFKSystems-Konto geführt werden, sofern der Support nichts anderes erlaubt. Für Minderjährige ist die Zustimmung einer sorgeberechtigten Person erforderlich, soweit das Recht am Wohnort dies verlangt.

Minecraft-, Microsoft-, Discord- oder Google-Konten dürfen nur verbunden werden, wenn der Nutzer dazu berechtigt ist. AFKSystems fragt keine Passwörter dieser Drittanbieter ab. Der Nutzer bleibt für die Sicherheit und die Regeln seiner Drittanbieter-Konten verantwortlich.

## 4. Zulässige Nutzung

Vor dem Einsatz muss der Nutzer prüfen, ob der jeweilige Minecraft-Server Bots, AFK-Spieler, mehrere Konten und Automatisierung erlaubt. Verboten sind insbesondere rechtswidrige Handlungen, Angriffe, Umgehung technischer Grenzen, Täuschung, Spam, Belästigung, Schadsoftware, unbefugte Zugriffe, Weiterverkauf ohne Erlaubnis und eine Nutzung, die AFKSystems oder Dritte erheblich beeinträchtigt.

Sperren, Stummschaltungen oder sonstige Maßnahmen eines Minecraft-Servers liegen im Verhältnis zwischen Nutzer und diesem Server. AFKSystems kann solche Maßnahmen nicht aufheben und haftet nicht allein deshalb, weil ein Drittserver seine eigenen Regeln durchsetzt.

## 5. Preise, Credits und Verlängerung

Ein Credit entspricht einem Cent. Aufladungen erhöhen das Guthaben; Credits sind kein Bankguthaben, werden nicht verzinst und sind grundsätzlich nur innerhalb von AFKSystems nutzbar. Eine Auszahlung erfolgt nur, soweit zwingendes Recht, ein wirksamer Widerruf oder eine ausdrücklich bestätigte Erstattung dies verlangt.

Alle angegebenen Preise sind Endpreise in Euro. Vertragspartner für jede Aufladung ist AFKSystems; Kartenzahlungen und die übrigen elektronischen Zahlarten werden lediglich technisch über den Zahlungsdienstleister Stripe abgewickelt. Ob Umsatzsteuer anfällt, richtet sich nach dem Recht am Sitz des Betreibers. Solange die Kleinunternehmerregelung angewendet wird, enthalten die Preise keine Umsatzsteuer, es wird keine ausgewiesen, und der Beleg nennt den Grund dafür; ein Vorsteuerabzug aus solchen Belegen ist nicht möglich. Wird die Umsatzsteuer berechnet, ist sie im angegebenen Preis enthalten und wird beim Bezahlen und auf dem Beleg gesondert ausgewiesen. Über jede verbuchte Aufladung wird ein Beleg per E-Mail zugestellt, sofern eine Zustellung möglich ist.

Bezahlte Serverplätze laufen jeweils 30 Tage. Sie verlängern sich aus vorhandenem Guthaben, solange die Verlängerung aktiviert ist. Es gibt keine automatische Belastung einer Karte allein durch diese Verlängerung. Reicht das Guthaben nicht, wird der Platz angehalten, ohne ein negatives Guthaben zu erzeugen. Der Nutzer kann die Verlängerung vor Ablauf deaktivieren. Preise und Leistungsumfang werden vor einer Buchung angezeigt.

## 6. Widerruf und Erstattungen

Soweit ein gesetzliches Widerrufsrecht besteht, kann es innerhalb der gesetzlichen Frist über ein Support-Ticket ausgeübt werden. Verlangt der Nutzer, dass eine digitale Dienstleistung sofort beginnt, können bei einem wirksamen Widerruf die bis dahin vertragsgemäß erbrachten Leistungen anteilig berechnet werden, soweit das anwendbare Recht dies erlaubt. Gesetzliche Ansprüche wegen einer mangelhaften oder nicht bereitgestellten Leistung bleiben bestehen. Tarifwechsel und das Entfernen von Zusätzen werden nach den im Panel angezeigten Regeln anteilig mit Credits verrechnet.

## 7. Verfügbarkeit und Änderungen

AFKSystems bemüht sich um einen sicheren und zuverlässigen Betrieb, schuldet jedoch keine ununterbrochene Verfügbarkeit, sofern nicht ausdrücklich etwas anderes vereinbart wurde. Wartung, Störungen bei Rechenzentren, Netzwerken, Drittanbietern, Minecraft-Servern oder Client-Updates können Funktionen vorübergehend einschränken. Sicherheitsrelevante Änderungen dürfen ohne Vorankündigung erfolgen; wesentliche nachteilige Änderungen an bezahlten Leistungen werden nach Möglichkeit vorher angekündigt. Zwingende Rechte bei digitalen Dienstleistungen bleiben unberührt.

## 8. Sperrung und Beendigung

Nutzer können Verlängerungen deaktivieren und ihr Konto jederzeit selbst im Panel zur Löschung anmelden (Einstellungen → Deine Daten). Mit der Anmeldung enden die laufenden Bot-Dienste sofort; die Löschung selbst erfolgt nach vierzehn Tagen und kann bis dahin im Panel widerrufen werden. Noch nicht verbrauchtes Guthaben wird nicht ausgezahlt und verfällt mit der Löschung; ein gesetzlicher oder bestätigter Erstattungsanspruch bleibt davon unberührt und ist vor der Löschung über den Support geltend zu machen. AFKSystems darf Konten oder Bots bei Missbrauch, erheblichem Vertragsverstoß, Sicherheitsgefahr, behördlicher Anordnung oder ausstehender Zahlung vorübergehend sperren. Bei behebbaren Verstößen wird grundsätzlich Gelegenheit zur Abhilfe gegeben; bei akuter Gefahr ist eine sofortige Sperre zulässig.

## 9. Haftung

AFKSystems haftet uneingeschränkt, soweit dies gesetzlich zwingend ist, insbesondere für Vorsatz, grobe Fahrlässigkeit sowie Schäden an Leben, Körper oder Gesundheit. Im Übrigen ist die Haftung im gesetzlich zulässigen Umfang auf vorhersehbare, unmittelbare Schäden aus der Verletzung wesentlicher Vertragspflichten begrenzt. Keine Bestimmung schließt zwingende Verbraucher-, Gewährleistungs- oder Datenschutzrechte aus.

## 10. Recht und Änderungen dieser Bedingungen

Es gilt das Recht am Sitz des Betreibers, ohne Verbrauchern den zwingenden Schutz ihres gewöhnlichen Aufenthaltsortes zu entziehen. Zuständigkeit und Streitbeilegung richten sich nach zwingendem Recht. AFKSystems darf diese Bedingungen aus sachlichem Grund für die Zukunft ändern, etwa wegen neuer Funktionen, Sicherheitsanforderungen oder Rechtsänderungen. Wesentliche Änderungen werden in geeigneter Form angekündigt. Ist eine Bestimmung unwirksam, bleiben die übrigen Bestimmungen wirksam.`;

export const TERMS_EN = `Last updated: 1 September 2026

## 1. Scope and contracting party

These terms apply to AFKSystems accounts and services. AFKSystems is operated outside Germany and can be reached through support tickets in the panel, by email to support@afksystems.de, or through the Discord linked on the website. Registration accepts these terms and the privacy notice. Mandatory legal rights, including consumer rights, remain unaffected.

## 2. Service

AFKSystems operates Minecraft AFK clients on its own or connected infrastructure. Features, bot limits, history and add-ons depend on the selected plan, the pricing page and the technical capabilities of the client currently available. AFKSystems is not an official Mojang or Microsoft product and is not approved or supported by either company.

The free server slot requires a linked Discord account and membership of the specified AFKSystems Discord. If that requirement ceases to be met, the free slot may be paused. Free features may be changed or discontinued on reasonable notice.

## 3. Accounts and security

Users must provide accurate contact information, keep credentials confidential and report unauthorised use promptly. Each person should hold only one AFKSystems account unless support permits otherwise. A minor needs permission from a parent or legal guardian where the law of the minor's residence requires it.

Minecraft, Microsoft, Discord or Google accounts may be linked only where the user is authorised to do so. AFKSystems does not request passwords for those providers. The user remains responsible for the security of third-party accounts and compliance with their rules.

## 4. Acceptable use

Before use, the user must check whether the relevant Minecraft server permits bots, AFK players, multiple accounts and automation. Prohibited conduct includes unlawful activity, attacks, circumvention of technical limits, deception, spam, harassment, malware, unauthorised access, resale without permission, and use that materially harms AFKSystems or another person.

Bans, mutes and other measures imposed by a Minecraft server are between the user and that server. AFKSystems cannot reverse them and is not liable merely because a third-party server enforces its own rules.

## 5. Prices, credits and renewal

One credit equals one cent. Top-ups increase the credit balance; credits are not bank deposits, earn no interest and are generally usable only within AFKSystems. Cash redemption is available only where mandatory law, a valid withdrawal or an expressly approved refund requires it.

All prices shown are final prices in euro. The contracting party for every top-up is AFKSystems; card payments and the other electronic payment methods are merely processed technically by the payment service provider Stripe. Whether VAT applies is governed by the law of the operator's place of establishment. While the small-business scheme is applied, prices contain no VAT, none is shown, and the receipt states the reason; no input tax may be deducted from such receipts. Where VAT is charged, it is included in the price shown and is stated separately at checkout and on the receipt. A receipt for every settled top-up is sent by email where delivery is possible.

Paid server slots run for 30 days. They renew from an available credit balance while renewal is enabled. Renewal alone does not automatically charge a card. If the balance is insufficient, the slot is paused without creating a negative balance. Renewal may be disabled before expiry. Prices and scope are shown before booking.

## 6. Withdrawal and refunds

Where a statutory withdrawal right applies, it can be exercised within the statutory period by opening a support ticket. If the user requests immediate performance of a digital service, a valid withdrawal may be charged proportionally for services properly supplied up to that point, where applicable law permits. Statutory remedies for a defective or missing service remain available. Plan changes and removal of add-ons are credited proportionally under the rules shown in the panel.

## 7. Availability and changes

AFKSystems aims to operate securely and reliably but does not promise uninterrupted availability unless expressly agreed. Maintenance and failures involving data centres, networks, third-party providers, Minecraft servers or client updates may temporarily restrict features. Security changes may be made without notice; material adverse changes to a paid service will be announced in advance where reasonably possible. Mandatory rights for digital services remain unaffected.

## 8. Suspension and termination

Users may disable renewals and may schedule their own account for deletion in the panel at any time (Settings → Your data). Scheduling it stops the running bot services immediately; the deletion itself happens after fourteen days and can be cancelled in the panel until then. Remaining credit is not paid out and expires with the deletion; a statutory or approved refund claim is unaffected and must be raised through support before the deletion. AFKSystems may temporarily suspend an account or bot for abuse, material breach, security risk, official order or unpaid charges. A curable breach will generally be given an opportunity to be remedied; an immediate suspension is permitted where there is an urgent risk.

## 9. Liability

AFKSystems remains fully liable wherever liability cannot lawfully be limited, including for intentional conduct, gross negligence and injury to life, body or health. Otherwise, to the extent permitted by law, liability is limited to foreseeable direct loss caused by breach of an essential contractual duty. Nothing excludes mandatory consumer, conformity, warranty or data protection rights.

## 10. Law and changes to these terms

The law of the operator's place of establishment applies without depriving consumers of mandatory protections in their usual country of residence. Jurisdiction and dispute resolution follow mandatory law. AFKSystems may amend these terms prospectively for an objective reason, such as new features, security requirements or a change in law. Material changes will be announced appropriately. If one provision is invalid, the remaining provisions continue to apply.`;
