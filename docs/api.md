# Eigene API-Token

Bot-Status abfragen und Bots starten oder stoppen, aus einem eigenen Skript heraus – ohne
Sitzungs-Cookie, ohne Browser.

---

## Ein Token erzeugen

**Einstellungen → Sicherheit → API-Zugang.** Der rohe Wert (`afk_…`) steht genau einmal auf dem
Bildschirm, direkt nach dem Erzeugen – danach kennt ihn nur noch die Datenbank, und zwar nicht als
Klartext, sondern als HMAC-Abdruck (dasselbe Verfahren wie bei einem Sitzungs-Cookie). Wer ihn
verliert, erzeugt einen neuen und widerruft den alten.

Ein Token hat kein Ablaufdatum. Es gilt, bis es in derselben Ansicht widerrufen wird.

## Was ein Token darf – und was nicht

Bewusst schmal: ein Token kann den eigenen Bot-Status lesen und Bots starten oder stoppen, sonst
nichts. Kein Zugriff auf Zahlungen, Zugangsdaten, Kontoeinstellungen oder die Tokenverwaltung
selbst – ein einzelnes geleaktes Token darf sich nicht selbst weitere ausstellen. Ein Aufruf
außerhalb dieser Liste bekommt `403` mit `"Dieses Token darf diesen Weg nicht benutzen."`

| Methode | Weg | Wirkung |
| --- | --- | --- |
| `GET`  | `/api/me` | Eigenes Konto: Guthaben, laufende Bots, Serverplätze |
| `GET`  | `/api/profiles` | Alle eigenen Serverplätze mit ihren Konten und Bot-Zuständen |
| `GET`  | `/api/profiles/<id>` | Ein einzelner Serverplatz |
| `POST` | `/api/profiles/<id>/start` | Bots dieses Platzes starten (`{"accounts":[<konto-id>, …]}`) |
| `POST` | `/api/profiles/<id>/stop` | Bots dieses Platzes stoppen (dieselbe Form) |

## Aufruf

Der Wert geht in den `Authorization`-Kopf, nicht in die Adresse oder ein Cookie:

```bash
curl -H "Authorization: Bearer afk_dEIN-TOKEN-HIER" \
     https://example.invalid/api/profiles
```

```bash
curl -X POST \
     -H "Authorization: Bearer afk_dEIN-TOKEN-HIER" \
     -H "Content-Type: application/json" \
     -d '{"accounts":[12]}' \
     https://example.invalid/api/profiles/7/start
```

Ein Bearer-Kopf ist von sich aus gegen website-übergreifendes Fälschen gefeit – ein fremdes
Formular kann keinen geheimen Kopf mitschicken, den es nicht kennt. Deshalb prüft das Panel bei
einem Token nicht dieselbe Herkunftskopfzeile wie bei einer Sitzung mit Cookie.

## Warum ein Token, keine Sitzung

Ein Sitzungs-Cookie ist an einen Browser gebunden, läuft ab und schickt bei jeder Anfrage weitere
Kopfzeilen mit, die ein Skript nicht ohne Weiteres nachbildet. Ein Token ist ein einzelner Wert,
den ein Skript einmal in seine Konfiguration legt – wie ein Stripe-Schlüssel oder ein
GitHub-Token, nur enger gefasst, weil es nichts als den eigenen Bot-Status betrifft.
