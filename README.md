# olconet-homepage

Persoenliche Homepage von Janine mit Reiseberichten und RSS-Feed,
Meine Kreationen (Zeichnungen, Toepferarbeiten, Naehprojekte und mehr),
Fotos von Sammy und Kontaktformular an `janine@olconet.com`.

## Stand

Das Projektgrundgeruest umfasst:

- `apps/homepage`: Astro-Homepage mit aktuellen Reiseberichten sowie Galerien fuer Meine Kreationen und Sammy.
- `apps/admin`: Angular-Verwaltung mit Login, Uebersicht, visuellem Reisebericht-Editor und Bildverwaltung.
- `apps/backend`: NestJS-Backend mit Prisma/PostgreSQL, Authentifizierung und Health-Endpunkten.
- Prisma-Datenmodell fuer Verwaltungsbenutzer, Reiseberichte, Medien und
  Zuordnung von Fotos zu Berichten; Entwuerfe sind der Standard.
- Container-Builds und Docker-Compose fuer Mac (Test) und Synology (Produktion).

Mehrere Verwaltungskonten werden ausschliesslich per CLI eingerichtet;
es gibt keine oeffentliche Registrierung. Alle Konten besitzen derzeit
dieselben Verwaltungsrechte.

Noch **nicht** implementiert: Kontaktformular/SMTP, Spam-Schutz. Die Seiten zeigen
keine erfundenen Berichte oder Bilder. Der Kontakt ist vorerst
ein Mail-Link. Es werden weder bestehende AMC-Daten noch Zugangsdaten kopiert.

## Voraussetzungen und Start

Node.js 24 (mindestens 24.15) und pnpm 10.16.0. Eine lokale PostgreSQL-Instanz
ist bereits vorhanden; dieses Projekt startet keinen weiteren Datenbankserver.

```sh
pnpm install
cp apps/backend/.env.example apps/backend/.env
# DATABASE_URL in apps/backend/.env auf die eigene Datenbank einstellen.
pnpm db:generate
pnpm db:deploy
# Erstes Konto anlegen; Passwort wird verdeckt abgefragt:
pnpm --filter @olconet/backend admin:create --email janine@olconet.com --name Janine
pnpm dev
```

| Anwendung | Lokal |
| --- | --- |
| Homepage | http://localhost:18431 |
| Verwaltung | http://localhost:18432 |
| Backend-Liveness | http://localhost:18433/health/live |
| Backend-Readiness | http://localhost:18433/health/ready |

Die lokalen App-Ports liegen bewusst im Bereich 18431–18433, um Konflikte
mit anderen Projekten zu vermeiden. Der interne Container-Port
bleibt 8080; der bestehende PostgreSQL-Port bleibt ebenfalls unveraendert.

Ohne `DATABASE_URL` startet das Backend absichtlich nicht. Liveness benoetigt
keine Datenbankverbindung; Readiness liefert HTTP 503, solange PostgreSQL
nicht erreichbar ist. Readiness prueft derzeit die Verbindung, nicht den
Migrationsstand. Die Homepage wird statisch gebaut und laedt aktuelle
Reiseberichte im Browser aus der Public-API; der RSS-Feed wird serverseitig
aus PostgreSQL erzeugt. Die Verwaltung greift ueber ihren Same-Origin-Proxy
auf das Backend zu. Fuer den Login genau
`http://localhost:18432` verwenden; `127.0.0.1` ist eine andere Origin.

```sh
pnpm check
pnpm build
pnpm test
pnpm test:docker # benoetigt die Docker-Compose-CLI
pnpm test:integration # temporaeres PostgreSQL in Docker, keine vorhandenen DBs
pnpm --filter @olconet/backend db:validate
```

## PostgreSQL einrichten

Referenz: das benachbarte `amc-backend` nutzt ebenfalls NestJS, Prisma und
PostgreSQL; lokal liegt der Server auf Port 5432. Host, Benutzer und Secrets
muessen fuer olconet separat festgelegt werden. AMC bleibt unangetastet.

Die **Datenbank selbst** wird einmalig von einem PostgreSQL-Administrator
angelegt. Prisma erstellt nur Tabellen innerhalb einer vorhandenen Datenbank.
Beispiel fuer den vorhandenen lokalen Server (als Administrator):

```sql
CREATE ROLE olconet LOGIN;
-- Passwort interaktiv mit psql setzen, nicht in Dateien oder Shell-History:
-- \password olconet
CREATE DATABASE olconet OWNER olconet;
```

`DATABASE_URL` muss auf diese eigene Datenbank zeigen. Passwoerter mit
Sonderzeichen muessen in der URL percent-encoded sein. TLS-Einstellungen
richten sich nach dem jeweiligen PostgreSQL-Betrieb. Auf Synology legt
der PostgreSQL-Container Benutzer und Datenbank beim ersten Start selbst an.
Der URL-Parameter `schema` (z.B. `?schema=webpage`) wird sowohl von Prisma
Migrate als auch vom Backend-Adapter verwendet; ohne Parameter gilt `public`.
Das Schema nach der Einrichtung nicht ohne geplante Datenmigration aendern.

```sh
# Vorhandene versionierte Migrationen anwenden; auch fuer die lokale Erstanlage:
pnpm db:deploy
# Bei spaeteren Modell-Aenderungen lokal neue Migrationen erstellen:
pnpm db:migrate --name beschreibung
```

`migrate dev` benoetigt eine Shadow-Datenbank und entsprechende Rechte.
Dem Produktionsbenutzer kein CREATEDB-Recht dafuer geben. Migrationen werden
nie automatisch beim Build oder beim Backend-Start angewendet.

Bilder liegen im Upload-Verzeichnis bzw. auf einem persistenten Docker-Volume,
nicht als Binaerdaten in PostgreSQL. Das Modell speichert dazu `storageKey`,
Metadaten und Alternativtexte. Kontaktanfragen werden bislang nicht gespeichert.

## Verwaltungskonten und Sitzungen

Nach `pnpm db:deploy` pro Konto ausfuehren:

```sh
pnpm --filter @olconet/backend admin:create --email person@example.com --name "Vorname Nachname"
```

Das Passwort wird zweimal verdeckt abgefragt, muss mindestens 12 Zeichen
und maximal 128 UTF-8-Bytes lang sein und wird mit gesalzenem scrypt
(N=32768, r=8, p=1) gehasht. E-Mail-Adressen werden getrimmt und kleingeschrieben;
vorhandene Konten werden niemals ueberschrieben. Passwoerter nicht als
Kommandozeilenargument oder in der Shell-History uebergeben. Fuer automatisierte
Einrichtung akzeptiert der Befehl `--password-stdin`; ein Secret dann aus
einer geschuetzten Datei oder einem Secret-Manager an stdin uebergeben.
Ein Passwort-Reset und eine Kontoverwaltungsoberflaeche folgen spaeter.

`ADMIN_ORIGIN` ist die vollstaendige Browser-Origin der Verwaltung, ohne
Pfad oder abschliessenden Slash. Standard bei `pnpm dev`:
`http://localhost:18432`. In Produktion muss sie explizit gesetzt werden.
HTTP ist nur fuer localhost/Loopback erlaubt. Bei einer HTTPS-Origin werden
automatisch Secure-Cookies gesetzt, auch hinter dem Synology-Reverse-Proxy;
HTTP auf localhost verwendet fuer Tests Cookies ohne Secure.

### Login wird wegen der Verwaltungsadresse abgelehnt

Erscheint „Die Anfrage wurde abgelehnt. Bitte die konfigurierte
Verwaltungsadresse verwenden.“, die Adresse im Browser mit `ADMIN_ORIGIN`
vergleichen. Protokoll, Host und Port muessen exakt uebereinstimmen.

Bei der lokalen Standardkonfiguration die Verwaltung in **jedem Browser,
auch Safari, unter http://localhost:18432/** oeffnen. Nicht
`http://127.0.0.1:18432` verwenden: Beide Adressen zeigen auf denselben Mac,
gelten aber als unterschiedliche Origins. Daher kann der Login in VS Code
funktionieren und in Safari abgelehnt werden, wenn dort die IP-Adresse
verwendet wird. Vorhandene Lesezeichen entsprechend anpassen.

Soll bewusst `127.0.0.1` verwendet werden, `ADMIN_ORIGIN` in der jeweils
verwendeten Backend-Konfiguration auf `http://127.0.0.1:18432` setzen und
das Backend neu starten (bei Docker den Backend-Container mit der neuen
Konfiguration neu erstellen). Anschliessend nur diese Adresse verwenden.

Sitzungen laufen nach acht Stunden ab, bleiben bei Backend-Neustarts bestehen
und werden beim Abmelden serverseitig geloescht. Der Browser erhaelt nur ein
zufaelliges HttpOnly-/SameSite=Strict-Cookie fuer `/api`, ohne Domain-Freigabe;
PostgreSQL speichert nur dessen SHA-256-Hash. Es gibt keine Tokens im
localStorage. Ein erneuter Login ersetzt die mitgesendete alte Sitzung.
Abgelaufene Sitzungen und alte Login-Limits werden beim naechsten Login bereinigt.

Schreibende API-Anfragen benoetigen die exakte Origin, JSON und
`X-Olconet-Request: 1` als CSRF-Schutz. CORS ist nicht freigeschaltet.
Der Angular-Entwicklungsserver und der Admin-Container leiten nur `/api/*`
an das Backend weiter. Weitere Backend-Endpunkte sind standardmaessig durch
einen globalen Sitzungs-Guard geschuetzt; nur Health, Login und Logout sind
explizit oeffentlich (Logout bleibt CSRF-geschuetzt).

Innerhalb von 15 Minuten sind maximal zehn Login-Anfragen pro
normalisierter E-Mail-Adresse und 100 insgesamt erlaubt, einschliesslich
erfolgreicher Anmeldungen. Die Limits werden atomar in PostgreSQL gespeichert
und nicht bei einem Neustart zurueckgesetzt. Nach Erreichen des Limits warten;
es gibt keine ungesicherte HTTP-Entsperrfunktion.

| API | Zweck |
| --- | --- |
| `POST /api/auth/login` | Login mit JSON `{ "email": "...", "password": "..." }` |
| `GET /api/auth/me` | Angemeldetes Konto ohne Passwort-Hash |
| `POST /api/auth/logout` | Sitzung widerrufen und Cookie entfernen |
| `GET /api/admin/overview` | Geschuetzte Anzahl der Reiseberichte, Kreationen und Sammy-Fotos |

Die Uebersicht zeigt reale Datenbankzaehler einschliesslich Entwuerfen.

## Reiseberichte schreiben und veroeffentlichen

Nach dem Login unter **Reiseberichte verwalten** einen neuen Bericht anlegen:

1. Titel und URL-Kuerzel eingeben. Das Kuerzel wird bei neuen Berichten aus
   dem Titel vorgeschlagen und kann angepasst werden; es muss eindeutig sein
   und darf nur Kleinbuchstaben, Zahlen und einzelne Bindestriche enthalten.
2. Kurzbeschreibung, optional Reiseziel und Reisedaten ergaenzen.
3. Im visuellen Editor den Bericht schreiben. Absatz, Ueberschriften,
   Fett/Kursiv, Listen, Zitate und Rueckgaengig/Wiederholen sind verfuegbar.
   Der Editor wird erst beim Bearbeiten nachgeladen.
4. **Speichern** legt zunaechst einen privaten Entwurf an. Leerer Berichtstext
   und leere Kurzbeschreibung sind im Entwurf erlaubt, der Titel nicht.
5. **Veroeffentlichen** gibt die zuletzt gespeicherte Version fuer Homepage
   und RSS frei. Kurzbeschreibung und nichtleerer Berichtstext sind erforderlich.

Es gibt kein Autosave. Vor Veroeffentlichung, Ruecknahme oder Loeschen erst
speichern. Beim Verlassen eines bearbeiteten Berichts warnt die Verwaltung
vor ungespeicherten Aenderungen. Alle Verwaltungskonten koennen alle Berichte
bearbeiten; das urspruengliche Autorenkonto bleibt erhalten.

**Wichtig:** Speichern eines bereits veroeffentlichten Berichts aendert sofort
die oeffentliche Version. Fuer private Ueberarbeitung zuerst die
Veroeffentlichung zuruecknehmen. Das URL-Kuerzel nach der Veroeffentlichung
moeglichst nicht mehr aendern, da alte Links sonst nicht mehr funktionieren.
Ein Versionszaehler verhindert, dass parallele Bearbeitung fremde Aenderungen
ueberschreibt. Bei HTTP 409 die eigenen Eingaben sichern und **Gespeicherte
Version neu laden** verwenden; der Konflikt wird nicht automatisch aufgeloest.

**Veroeffentlichung zuruecknehmen** setzt den Bericht wieder auf Entwurf:
Er verschwindet unmittelbar aus der Public-API und dem Feed. Bereits von
RSS-Programmen heruntergeladene Eintraege koennen dort weiterhin existieren.
Nur Entwuerfe lassen sich nach Rueckfrage endgueltig loeschen.

Titel: maximal 200 Zeichen, URL-Kuerzel: 120, Kurzbeschreibung: 1000,
Reiseziel: 200, Berichtstext: 100000 UTF-8-Bytes. Reisedaten sind optional;
Reiseende darf nicht vor Reisebeginn liegen. HTML wird serverseitig auf eine
enge Liste von Textformatierungen und Bildreferenzen begrenzt. Skripte,
Links, externe Bild-URLs, Styles und eingebettete Inhalte werden entfernt.
Das bisherige Feld `contentMarkdown` bleibt fuer bestehende
Daten erhalten; der neue Editor verwendet `contentHtml`.

### Bilder im Berichtstext und Berichtsgalerie

Reisebilder haben die Kategorie **Reiseberichte** (`TRAVEL`). Im Bericht unter
**Bilder im Text und Berichtsgalerie** vorhandene Reisebilder auswaehlen,
oder dort mehrere Dateien mit der Warteschlange hochladen. Erfolgreiche
Uploads werden zur **noch ungespeicherten** Berichtsgalerie hinzugefuegt.
Zum Anlegen einer Bildzuordnung den Bericht danach speichern.

- **Im Text:** Im Editor die gewuenschte Einfuegeposition anklicken, ein
  Reisebild auswaehlen, optional eine Bildunterschrift angeben und **Im Text
  einfuegen** verwenden. Die Bildunterschrift ist unter dem Bild direkt
  im Editor bearbeitbar. Zum Entfernen das Bild markieren und loeschen.
- **Galerie:** **Zur Berichtsgalerie hinzufuegen** verwenden. Die Liste
  laesst sich mit **Bild nach vorne/hinten** sortieren. Bildunterschriften
  sind optional (maximal 500 Zeichen pro Galerieeintrag). Die Galerie steht
  unter dem Berichtstext. Entfernen aus der Galerie entfernt nicht das
  gleiche Bild im Text.
- Dasselbe Bild kann in beiden Varianten und in mehreren Berichten
  verwendet werden. Maximal 100 verschiedene Bilder pro Bericht.
- Titel und Alternativtext des Bildes werden in der Bildverwaltung gepflegt.
  Zugeordnete Bilder koennen nicht geloescht oder einer anderen Kategorie
  zugeteilt werden. Zuerst aus **allen** Berichten entfernen und speichern.
  Eine Bildzuordnung verschwindet beim Loeschen eines Berichts; die Datei bleibt.

Reisebilder werden **nicht einzeln veroeffentlicht**. Nur die gespeicherten
Bildzuordnungen eines veroeffentlichten Berichts geben dessen
berichtsspezifische URLs frei:
`/api/public/reports/:slug/images/:id`. Entwurfsbilder bleiben privat,
auch wenn ihre ID bekannt ist. Ruecknahme oder Entfernen eines Bildes
beim Speichern sperrt die betreffende Berichts-URL sofort. Wird das Bild in
einem anderen veroeffentlichten Bericht verwendet, bleibt es dort erreichbar.
Bereits heruntergeladene Bilder lassen sich nicht zurueckrufen.
Die globale Public-Galerie zeigt niemals Reisebilder.

Berichtsspeicherung erwartet zusaetzlich `galleryImages` als sortiertes
Array `{ "assetId": "UUID", "caption": "..." }`. Bilder im Text werden als
`<figure><img data-asset-id="UUID"><figcaption>...</figcaption></figure>`
referenziert. Die API validiert alle IDs gegen Reisebilder, speichert
Zuordnungen und Text atomar unter der Berichtsversion und setzt erst bei
oeffentlicher Ausgabe eigene Bild-URLs und den gespeicherten Alternativtext.
Vom Client gelieferte `src`-/`alt`-Attribute werden nicht uebernommen.
Ein weggelassenes `galleryImages` entspricht einer leeren Galerie.

### Homepage und RSS

- Liste: `http://localhost:18431/reisen/`
- Einzelbericht: `/reisen/bericht/?slug=mein-bericht`
- RSS 2.0: `/api/public/reports/rss` (auch im Seitenkopf als Feed verlinkt)

Listen haben 20 Eintraege pro Seite; der Feed enthaelt die neuesten 50
veroeffentlichten Berichte mit Kurzbeschreibung und stabiler GUID.
Entwuerfe sind ohne Verwaltungssitzung nicht erreichbar. Die oeffentlichen
Seiten benoetigen JavaScript fuer die aktuelle Liste und Detailansicht.
Fehler werden sichtbar angezeigt, nicht als leere erfolgreiche Antwort.
Fuer serverseitig gerenderte Berichtsseiten/SEO kann spaeter Astro-SSR
ergaenzt werden; derzeit erfordert Veroeffentlichung keinen Homepage-Neubuild.

`SITE_URL` konfiguriert die oeffentliche Homepage-Origin fuer absolute
RSS-Links, ohne Pfad oder abschliessenden Slash. Lokal gilt standardmaessig
`http://localhost:18431`; in Docker und Produktion explizit setzen.
Bestehende `.env.docker.mac`/`.env.docker.synology` um `SITE_URL` ergaenzen.
Backend und Container nach Konfigurationsaenderungen neu starten bzw. erstellen.

| API | Zweck |
| --- | --- |
| `GET /api/admin/reports?page=1` | Geschuetzte Berichtsliste |
| `POST /api/admin/reports` | Neuen Entwurf anlegen |
| `GET /api/admin/reports/:id` | Bericht zum Bearbeiten laden |
| `POST /api/admin/reports/:id/save` | Eingaben mit aktueller `version` speichern |
| `POST /api/admin/reports/:id/publish` | Gespeicherte Version veroeffentlichen |
| `POST /api/admin/reports/:id/unpublish` | Veroeffentlichung zuruecknehmen |
| `POST /api/admin/reports/:id/delete` | Entwurf loeschen |
| `GET /api/public/reports?page=1` | Oeffentliche Berichtsliste |
| `GET /api/public/reports/:slug` | Einzelner veroeffentlichter Bericht |
| `GET /api/public/reports/:slug/images/:id` | Nur diesem veroeffentlichten Bericht zugeordnetes Reisebild |
| `GET /api/public/reports/rss` | RSS-Feed |

Status- und Loeschbefehle erwarten JSON `{ "version": 0 }` mit der aktuellen
Version. Schreibende Berichts-APIs verwenden denselben Sitzungs-/CSRF-Schutz
wie der Login. Die Homepage proxyt ausschliesslich `/api/public/*`, niemals
die Verwaltungs- oder Login-Endpunkte.

Bei Updates vor dem Start `pnpm db:deploy` bzw. den Docker-Migrationscontainer
ausfuehren, damit `contentHtml` und `version` in der Datenbank vorhanden sind.

## Bilder verwalten und Galerien

### Navigation der Verwaltung

Die Verwaltung ist in separate Seiten mit fester Navigation aufgeteilt:
**Uebersicht**, **Reiseberichte**, **Meine Kreationen**, **Sammy** und **Bildbibliothek**.
Die Uebersicht zeigt Kennzahlen und Schnellzugriffe, keine langen Bearbeitungsformulare.
Meine Kreationen und Sammy zeigen ausschliesslich Bilder ihrer Kategorie; die
Bildbibliothek enthaelt alle Kategorien inklusive Reisebildern.

Listen, Bildbearbeitung, Mehrfachupload und Sortierung sind getrennte Ansichten.
**Bearbeiten** oeffnet eine eigene Seite, **Zurueck zur Bildliste** bzw.
**Zurueck zur Berichtsliste** fuehrt zur Liste. Berichte werden weiterhin
explizit gespeichert; die Bildsortierung wird weiterhin sofort gespeichert.
Ungespeicherte Angaben und offene Upload-Warteschlangen werden vor einem
Seitenwechsel bestaetigt. Laufende Schreibanfragen und Uploads sperren den
Wechsel. Dies gilt auch fuer Browser-Zurueck und Abmelden.

Unterseiten haben direkt verlinkbare Hash-Adressen, z.B.
`http://localhost:18432/#/reiseberichte`,
`http://localhost:18432/#/sammy/sortieren` und
`http://localhost:18432/#/bildbibliothek/upload`.
Diese funktionieren nach einem Neuladen auch im Docker-Static-Server ohne
zusaetzliche SPA-Fallbacks. Ohne Sitzung erscheint zuerst die Anmeldung;
danach wird die angeforderte Unterseite geoeffnet. Nicht vorhandene
Unterseiten zeigen eine sichtbare Fehlermeldung.

In **Bildbibliothek**, **Sammy** oder **Meine Kreationen** mit **Neues Bild** eine Datei auswaehlen und
Kategorie (**Meine Kreationen**, **Sammy** oder **Reiseberichte**), Titel und Alternativtext angeben.
Meine Kreationen umfasst Zeichnungen, Toepferarbeiten, Naehprojekte und andere
selbstgemachte Werke. Die Galerie liegt unter `/kreationen/`, die Verwaltung
unter `/#/kreationen`. Alte Links unter `/zeichnungen/` und `/#/zeichnungen`
(einschliesslich Verwaltungs-Unterseiten) werden weitergeleitet.
Der interne Kategorie-Schluessel `DRAWING` und das API-Zaehlerfeld `drawings`
bleiben aus Kompatibilitaetsgruenden unveraendert; vorhandene Bilder bleiben zugeordnet.
Der Alternativtext beschreibt den Bildinhalt fuer Screenreader.
Beschreibung ist optional; die Sortierung ist eine ganze Zahl von 0 bis
1000000. Kleinere Zahlen stehen zuerst, bei Gleichstand neueste Bilder.
Titel sind auf 200, Alternativtexte auf 500 und Beschreibungen auf 2000
Zeichen begrenzt. Pro Anfrage wird genau eine Datei hochgeladen.

**Bild speichern** legt einen privaten Entwurf an. **Bild veroeffentlichen**
schaltet ihn in `/kreationen/` bzw. `/sammy/` frei, ohne Homepage-Neubuild.
**Bildangaben bearbeiten** kann auch die Galerie aendern. Aenderungen an
veroeffentlichten Bildern sind sofort oeffentlich. Revisionen verhindern
gleichzeitiges Ueberschreiben; bei Konflikten erst **Bildliste neu laden**.
Der Kategorie-Filter in der Bildbibliothek laedt die Auswahl automatisch.
Die Listen enthalten 20 Bilder pro Seite und die Galerien benoetigen JavaScript.
Reisebilder werden nur mit ihren Berichten veroeffentlicht, nicht ueber diese
Bildliste. Sie koennen bereits vor dem Schreiben eines Berichts hochgeladen werden.

### Sammy und Meine Kreationen einfach sortieren

Im Bereich **Sammy** oder **Meine Kreationen** **Reihenfolge sortieren**
waehlen. Die Sortieransicht zeigt pro Seite 20 Bilder,
einschliesslich privater Entwuerfe, mit ihrer Position in der gesamten Kategorie.

- Am Griff **Ziehen** ein Bild innerhalb der angezeigten Seite verschieben
  (auch auf Touch-Geraeten).
- **Vor** und **Zurueck** bewegen ein Bild um eine Position, auch ueber Seitengrenzen.
- Eine **Zielposition** eingeben und **An Zielposition verschieben** waehlen,
  um direkt an eine beliebige Stelle der Kategorie zu springen.
  Die Ansicht folgt dem verschobenen Bild.
- Jede Verschiebung wird sofort gespeichert; kein separater Speichern-Schritt.
- Die Homepage uebernimmt die Reihenfolge sofort, zeigt aber weiterhin nur
  veroeffentlichte Bilder.
- Aenderungen anderer Verwaltungsfenster, Uploads oder Kategorie-Wechsel werden
  erkannt. Bei einem Konflikt **Reihenfolge neu laden** waehlen und wiederholen.

Offene Bildangaben muessen vorher gespeichert oder verworfen werden. Der
erweiterte Sortierwert bleibt verfuegbar; fuer Galerien ist die Sortieransicht
einfacher. Reisebilder und die Galerie eines Reiseberichts sind unabhaengig.
Die Sortierung veraendert keine Bildangaben oder Veroeffentlichungszustaende.

Die geschuetzte API stellt `GET /api/admin/media/order?category=SAMMY&page=1`
(auch `DRAWING`) und `POST /api/admin/media/order/move` mit
`{ category, assetId, position, token }` bereit. Positionen sind 1-basiert.
Der Token prueft die komplette Kategorie, nicht nur die sichtbare Seite.
Sortierung und Versionsanpassungen erfolgen atomar; veraltete Bildformulare
koennen die neue Reihenfolge nicht ueberschreiben. Die automatisch sortierbare
Kategorie umfasst hoechstens 1.000.001 Bilder (bestehender Sortierwertbereich).

### Mehrfachupload mit Warteschlange

Unter **Mehrere Bilder hochladen** mehrere Dateien auf einmal auswaehlen.
Die Schaltflaeche in der Bildliste oeffnet dafuer eine separate Upload-Seite.
Je Datei den vorgeschlagenen Titel pruefen und einen echten Alternativtext
ergaenzen. In der allgemeinen Bildverwaltung wird die Kategorie je Datei
gewaehlt; im Reisebericht ist sie fest `TRAVEL`. **Warteschlange starten /
fortsetzen** uebertraegt Dateien nacheinander, jeweils als einzelne Anfrage.
Es gelten weiterhin 10 MiB pro Datei, nicht fuer die gesamte Auswahl.
Die Warteschlange erlaubt maximal 100 Eintraege; erledigte Eintraege koennen
entfernt werden, um weitere Dateien auszuwaehlen.

Jeder Eintrag zeigt Fortschritt und Status. **100 %** bedeutet zunaechst,
dass die Uebertragung beendet ist; **Gespeichert** wird erst nach erfolgreicher
Bildverarbeitung angezeigt. Fehler stoppen nicht die anderen Eintraege.
**Dieses Bild erneut versuchen** wiederholt nur diesen Eintrag.
**Nach aktuellem Bild pausieren** laesst den laufenden Upload abschliessen und
stoppt vor dem naechsten. Bereits gespeicherte Dateien bleiben erhalten.
Zum Entfernen einer gespeicherten Datei die Bildverwaltung verwenden;
Entfernen aus der Warteschlange loescht keine Bilddatei.

Die Warteschlange existiert nur im aktuellen Browser-Tab; beim Verlassen
warnt die Anwendung vor offenen Uploads. Begonnene Upload-Angaben bleiben
fuer sichere Wiederholung gesperrt. Fuer Korrekturen nach einem Dateifehler
den Eintrag entfernen und die Datei erneut auswaehlen.
Jeder Warteschlangen-Upload besitzt einen UUID-`uploadKey`; identische
Wiederholungen liefern dieselbe Bild-ID, ohne Duplikate anzulegen, selbst
bei verlorener Antwort oder parallelen Wiederholungen. Andere Datei- oder
Metadaten unter demselben Schluessel ergeben HTTP 409.

**Bild zuruecknehmen** entfernt es aus der Galerie und sperrt auch direkte
oeffentliche Bild-URLs. Bereits heruntergeladene Bilder koennen nicht
zurueckgerufen werden. Nur Entwuerfe ohne Berichtszuordnung sind loeschbar;
**Bild loeschen** entfernt Metadaten und Datei nach Rueckfrage.
Falls das Entfernen der Datei nach der Datenbankloeschung scheitert, liefert
die API einen Fehler und protokolliert die Bild-ID zur manuellen
Speicherbereinigung; die Datei ist nicht mehr ueber die API erreichbar.

Akzeptiert werden echte, nicht animierte **JPEG-, PNG- und WebP-Bilder**:
maximal **10 MiB** und **40 Millionen Pixel**. Dateiname und vom Browser
gemeldeter MIME-Typ entscheiden nicht ueber die Zulassung. SVG, GIF, HEIC und
andere Formate werden abgewiesen. Bilder werden anhand der Kameraorientierung
gedreht, auf maximal 2560 Pixel je Seite begrenzt (ohne Hochskalierung) und
als WebP neu kodiert. EXIF-/GPS-Metadaten werden entfernt.
**Die Originaldatei wird nicht aufbewahrt; Originale separat sichern.**
Bilder koennen derzeit nicht nachtraeglich ersetzt werden;
fuer ein anderes Bild einen neuen Entwurf hochladen.

| API | Zweck |
| --- | --- |
| `GET /api/admin/media?page=1&category=SAMMY` | Private Bildliste; Kategorie optional |
| `GET /api/admin/media/:id` | Bildangaben fuer direkte Bearbeitungslinks, mit Verwaltungssitzung |
| `POST /api/admin/media` | Multipart-Upload: `file` und JSON-String `metadata` |
| `GET /api/admin/media/:id/image` | Bildvorschau mit Verwaltungssitzung |
| `POST /api/admin/media/:id/save` | Metadaten mit aktueller `revision` speichern |
| `POST /api/admin/media/:id/publish` | Bild veroeffentlichen |
| `POST /api/admin/media/:id/unpublish` | Veroeffentlichung zuruecknehmen |
| `POST /api/admin/media/:id/delete` | Entwurf und Datei loeschen |
| `GET /api/public/media?category=DRAWING&page=1` | Veroeffentlichte Galerie |
| `GET /api/public/media/:id/image` | Nur veroeffentlichte Bilddatei |

Metadaten bestehen aus `category` (`DRAWING`, `SAMMY` oder `TRAVEL`), `title`,
`altText`, `description` (String, leer erlaubt) und `sortOrder`.
Nur beim Upload ist optional `uploadKey` (UUID) fuer sichere Wiederholungen erlaubt.
Status- und Loeschbefehle erwarten `{ "revision": 0 }` mit der aktuellen
Revision. Alle schreibenden APIs verlangen exakte `ADMIN_ORIGIN` und
`X-Olconet-Request: 1`; nur der Upload-Endpunkt akzeptiert Multipart
anstelle von JSON. Private Dateien werden nicht als statisches Verzeichnis
bereitgestellt. Speicherschluessel werden nicht in Listen ausgegeben.

### Upload-Speicher

Lokal ist `UPLOAD_DIR` standardmaessig `uploads`, relativ zum
Backend-Arbeitsverzeichnis (bei `pnpm dev`: `apps/backend/uploads`).
Ein absoluter Pfad ist ebenfalls erlaubt. Das Verzeichnis wird beim Start
angelegt und muss fuer den Backend-Benutzer schreibbar sein.
Es ist von Git und Docker-Build-Kontext ausgeschlossen.

Auf dem Mac verwendet Docker das benannte Volume **uploads** unter
`/data/uploads`, bei Projektname `olconet` also `olconet_uploads`.
Das Image initialisiert dessen Rechte fuer UID 1001. Auf Synology wird
stattdessen der NAS-Ordner **`/volume1/server/olconet/uploads`** direkt unter
`/data/uploads` eingebunden (Bind-Mount). Dessen Rechte muessen auf dem NAS
vorbereitet werden; die Rechte im Image gelten nicht fuer einen Bind-Mount.
Das restliche Container-Dateisystem bleibt schreibgeschuetzt.
Keine Freigabe dieses Verzeichnisses ueber den Reverse-Proxy anlegen.
Fuer Uploads muss der vorgeschaltete Reverse-Proxy mindestens 12 MiB
Request-Groesse erlauben (10 MiB Bild plus Multipart-/Metadaten-Overhead).

**Datenbank und Upload-Volume gemeinsam sichern und wiederherstellen.**
Fuer konsistente Backups zuerst das Backend stoppen, dann Datenbankdump
und Upload-Dateien sichern. Die Bilder allein enthalten keine Zuordnungen,
Titel oder Veroeffentlichungsinformationen. `down -v` loescht auf dem Mac
auch Bilder im benannten Volume; der Synology-Bind-Mount-Ordner bleibt erhalten.
Speicherplatz ueberwachen; Disk-/Dateifehler werden explizit gemeldet.
Nach einem Prozessabbruch waehrend eines Uploads koennen unreferenzierte
Dateien verbleiben; es gibt noch keinen automatischen Bereinigungsjob.

Bei Updates vor dem Start `pnpm db:deploy` bzw. den Docker-Migrationscontainer
ausfuehren, um die additive Medienrevision-Migration anzuwenden.

## Docker auf Mac und Synology

Docker Desktop mit Compose auf dem Mac; Docker/Container Manager mit
Compose-Unterstuetzung auf Synology. Der Mac verwendet ARM64, die Synology
Intel/AMD (linux/amd64). Build-Kontext ist das Projektwurzelverzeichnis:

| App | Dockerfile | Build-Argument |
| --- | --- | --- |
| Homepage | `infrastructure/Dockerfile.frontend` | `APP=homepage` |
| Verwaltung | `infrastructure/Dockerfile.frontend` | `APP=admin` |
| Backend | `infrastructure/Dockerfile.backend` | keines |

Die drei App-Container laufen als Nicht-Root mit schreibgeschuetztem
Dateisystem und temporaerem `/tmp`. Intern verwenden sie Port 8080; auf dem
Host sind nur 127.0.0.1:18431–18433 gebunden. Keine `.env` gelangt ins Image.
Das Backend-Image enthaelt Prisma CLI fuer den separat gestarteten
Migrationscontainer und die Kontoeinrichtungs-CLI. Die Dateien `apps/backend/.env` (pnpm) und
`.env.docker.*` (Compose) sind getrennte Konfigurationen.

### Mac: vorhandenes PostgreSQL

```sh
cp infrastructure/env.mac.example .env.docker.mac
# Eigenes DATABASE_URL-Passwort, ADMIN_ORIGIN und SITE_URL eintragen.
docker compose --env-file .env.docker.mac -f compose.yaml -f compose.mac.yaml config --quiet
docker compose --env-file .env.docker.mac -f compose.yaml -f compose.mac.yaml build
docker compose --env-file .env.docker.mac -f compose.yaml -f compose.mac.yaml run --rm migrate
docker compose --env-file .env.docker.mac -f compose.yaml -f compose.mac.yaml run --rm create-admin --email janine@olconet.com --name Janine
docker compose --env-file .env.docker.mac -f compose.yaml -f compose.mac.yaml up -d --wait
```

Migrationen zuerst erfolgreich abschliessen. Die lokalen Adressen sind
dieselben wie bei `pnpm dev`; beide Varianten daher nicht gleichzeitig
starten. Docker verwendet `host.docker.internal` fuer PostgreSQL auf dem
Mac, nicht `localhost` (das waere der Container selbst). PostgreSQL muss
Verbindungen aus Docker zulassen: Erreichbarkeit, `listen_addresses` und
gezielte `pg_hba.conf`-Regeln pruefen; keine pauschale `trust`-Freigabe setzen.

#### Vorhandene lokale Bilder nach Docker uebernehmen

Compose erstellt `olconet_uploads` beim ersten Start automatisch und bindet es
im Backend unter `/data/uploads` ein. Dieses Volume liegt in Docker Desktop,
nicht als Ordner im Projekt. Es uebernimmt **nicht automatisch** die Dateien
aus `apps/backend/uploads`.

Wenn dieselbe Datenbank zuvor mit `pnpm dev` verwendet wurde, bleiben die
Bildzuordnungen erhalten, aber die Bilddateien muessen ebenfalls uebernommen
werden. Ein leeres Volume fuehrt sonst zu fehlenden Vorschauen trotz vorhandener
Datenbankeintraege. Falls lokal ein anderes `UPLOAD_DIR` konfiguriert war,
dieses Verzeichnis statt `apps/backend/uploads` verwenden.

Vor der Uebernahme lokale Uploads beenden und Datenbank sowie beide
Bildspeicher sichern. Die Dateien mit ihren unveraenderten Namen kopieren.
Vorhandene Dateien im Ziel nicht ungeprueft ueberschreiben; die Rechte muessen
weiterhin zum Backend-Benutzer UID 1001 passen (Verzeichnis 0700, Dateien 0600).
Das Volume nicht loeschen oder neu erstellen, um fehlende Bilder zu beheben.
`docker compose down` erhaelt es, `docker compose down -v` loescht es.

### Synology: vorhandener PostgreSQL-Container im Netzwerk back-tier

Auf der Synology existiert bereits der PostgreSQL-Container **postgres_server**
mit internem Port **5432** im Docker-Netzwerk **back-tier**. Die Anwendung
verwendet diesen Server; sie startet keinen eigenen Datenbankcontainer und
legt kein PostgreSQL-Volume an. Backend, Migration und Kontoeinrichtung
werden zusaetzlich an das externe Netzwerk angeschlossen. Homepage und
Verwaltung bleiben ausschliesslich im Anwendungsnetzwerk `olconet`.

Das Netzwerk `back-tier` muss bereits existieren und `postgres_server` darin
als Containername oder Netzwerk-Alias aufloesbar sein. Die Datenbank `olconet`
und ein eigener Datenbankbenutzer mit den erforderlichen Rechten muessen
vorher auf diesem Server angelegt werden. Migrationen legen die Tabellen
im Schema `webpage` an, nicht den PostgreSQL-Benutzer oder die Datenbank.

#### Bildspeicher auf dem NAS vorbereiten

Der Backend-Container verwendet den Bind-Mount
`/volume1/server/olconet/uploads:/data/uploads`. Vor dem ersten Start auf
der Synology den Ordner anlegen und fuer UID/GID 1001 freigeben:

```sh
sudo mkdir -p /volume1/server/olconet/uploads
sudo chown 1001:1001 /volume1/server/olconet/uploads
sudo chmod 700 /volume1/server/olconet/uploads
```

Compose legt einen fehlenden Ordner absichtlich nicht automatisch an:
Das verhindert einen unbemerkt als root angelegten, nicht schreibbaren Speicher.
Bei vorhandenen Bildern zuerst sichern und deren Eigentuemerechte pruefen;
die Bilddateien benoetigen UID 1001 und Modus 0600. Auch Synology-ACLs duerfen
den Zugriff nicht blockieren. Keine pauschale Freigabe mit `chmod 777` verwenden.
Der Ordner darf nicht direkt ueber den Reverse-Proxy veroeffentlicht werden.

Vorhandene Bilder aus einem bisherigen Docker-Volume werden nicht automatisch
uebernommen. Bei einem Speicherwechsel das Backend stoppen und die Dateien
mit unveraenderten Namen in diesen Ordner uebertragen, ohne vorhandene Dateien
ungeprueft zu ueberschreiben. Datenbank und Bilddateien gemeinsam sichern.

```sh
cp infrastructure/env.synology.example .env.docker.synology
chmod 600 .env.docker.synology
# DATABASE_URL, HTTPS-ADMIN_ORIGIN, SITE_URL und IMAGE_TAG pro Release setzen.
docker compose --env-file .env.docker.synology -f compose.yaml -f compose.synology.yaml config --quiet
```

`DATABASE_URL` hat die Form
`postgresql://olconet:PASSWORT@postgres_server:5432/olconet?schema=webpage`.
Benutzer und Passwort an den vorhandenen Server anpassen; das Passwort ggf.
percent-encodieren. Der interne Port 5432 ist entscheidend, nicht ein
veroeffentlichter NAS-Host-Port. `POSTGRES_PASSWORD` wird hier nicht benoetigt.
Eine bereits vorhandene `.env.docker.synology` wird nicht automatisch durch
die geaenderte Vorlage aktualisiert: darin ebenfalls Host und Port anpassen.
Env-Dateien nicht versionieren, nicht teilen
und nur fuer den betreibenden Benutzer lesbar machen. `config` ohne
`--quiet` kann Zugangsdaten ausgeben.

Die App-Images auf dem Mac fuer **linux/amd64** bauen (Docker Desktop
verwendet dabei Emulation):

```sh
docker compose --env-file .env.docker.synology -f compose.yaml build homepage admin backend
docker image save -o olconet-images.tar olconet/homepage:0.1.0 olconet/admin:0.1.0 olconet/backend:0.1.0
```

Image-Namen/Tags im `save`-Befehl bei abweichender Konfiguration anpassen.
Archiv, die eigenstaendige Datei `infrastructure/compose.synology.standalone.yaml`
und die separat geschuetzt uebertragene Env-Datei auf die Synology kopieren.
Die eigenstaendige Datei auf dem NAS als
**`/volume1/server/olconet/compose.yaml`** ablegen, die Env-Datei daneben als
**`.env.docker.synology`**. Die Basisdatei und das Synology-Override werden
dort nicht zusaetzlich benoetigt. Es wird kein Quellcode oder Dockerfile auf
dem NAS benoetigt; diese Konfiguration startet nur fertig gebaute Images.
Alternativ eigene Registry in `IMAGE_PREFIX`
eintragen, Images pushen und auf Synology pullen.

Auf der Synology im Projektverzeichnis (Images zuerst importieren oder mit
`docker compose --env-file .env.docker.synology pull` aus der Registry laden):

```sh
cd /volume1/server/olconet
docker image load -i olconet-images.tar
docker compose --env-file .env.docker.synology config --quiet
docker compose --env-file .env.docker.synology run --rm --no-deps migrate
# Nur wenn dieses Verwaltungskonto noch nicht in der Datenbank existiert:
docker compose --env-file .env.docker.synology run --rm --no-deps create-admin --email janine@olconet.com --name Janine
docker compose --env-file .env.docker.synology up -d --wait
```

Migrationen zuerst erfolgreich abschliessen. Der Upload-Ordner und das externe
Netzwerk `back-tier` muessen wie oben beschrieben vorbereitet sein.
Falls die Compose-Version auf dem NAS `--wait` nicht unterstuetzt,
`up -d` verwenden und anschliessend mit
`docker compose --env-file .env.docker.synology ps` die Healthchecks pruefen.
Die kombinierte Basis-/Override-Konfiguration bleibt im Entwicklungsprojekt
fuer Builds und Konfigurationstests verfuegbar.

Der vorhandene PostgreSQL-Server muss vor der Migration erreichbar sein.
Da er ausserhalb dieses Compose-Projekts laeuft, gibt es kein `depends_on`
auf diesen Container. Bei einem Fehler der Migration nicht mit dem Start
fortfahren. Das Backend meldet fehlende Datenbankverbindung ueber seinen
Readiness-Healthcheck. Passwortrotation muss im vorhandenen PostgreSQL und
in `DATABASE_URL` erfolgen; die Env-Datei allein aendert kein DB-Passwort.
Der Synology-Bildordner bleibt bei `down` und `down -v` erhalten; dennoch
`down -v` vermeiden, da es andere benannte Projekt-Volumes loeschen kann.
Den Bind-Mount-Pfad beim Upgrade unveraendert beibehalten.
Regelmaessige `pg_dump`-Backups ausserhalb des NAS und Wiederherstellungstests
vor dem produktiven Betrieb einrichten; ein Volume ist kein Backup.

Im Synology-Reverse-Proxy die Homepage ueber HTTPS auf
`http://127.0.0.1:18431` und die Verwaltung ueber eine eigene HTTPS-Origin auf
`http://127.0.0.1:18432` bereitstellen. Diese Verwaltungs-Origin muss exakt
`ADMIN_ORIGIN` entsprechen. Der Admin-Container proxyt `/api/*` intern zum
Backend; Port 18433 nicht oeffentlich weiterleiten. Zusaetzliche
NAS-Firewall-/VPN-Beschraenkungen fuer die Verwaltung sind empfehlenswert.
Bei reinem SSH-Tunnel-Test stattdessen ausdruecklich die localhost-Origin
konfigurieren. Die konkrete Domain und Zertifikate werden im
Synology-Reverse-Proxy konfiguriert. Der Upload-Ordner ist separat vom
Speicher des bestehenden PostgreSQL-Containers persistent. Datenbank und
Upload-Dateien gemeinsam sichern und bei einer Uebernahme vom Mac gemeinsam
uebertragen; der Image-Transfer enthaelt weder Datenbank noch Uploads.
Ein separates PostgreSQL-Upgrade erfordert eine geplante Datenmigration;
nicht einfach die Major-Version des Images wechseln.

## Verifikation des Grundgeruests

Typechecks, Produktionsbuilds und automatisierte Tests pruefen alle drei
Apps. HTTP-Smoke-Tests decken statische Seiten, fehlende Dateien,
unerlaubte Methoden, Pfadzugriffe sowie Backend-Liveness und Readiness bei
einer nicht erreichbaren Datenbank ab. Die initiale Migration wurde aus dem
validierten Prisma-Modell generiert und zusammen mit den Folge-Migrationen
auf einer isolierten Testdatenbank ausgefuehrt, nicht auf einer bestehenden lokalen
oder produktiven Datenbank. `pnpm test:docker` prueft beide aufgeloesten
Compose-Konfigurationen auf Ports, Plattformen, Datenbankanbindung und
Migrationsprofil. Alle drei Images wurden auf dem Mac fuer ARM64 und AMD64
gebaut und mit den eingeschraenkten Runtime-Rechten per HTTP getestet.
Auch Prisma CLI wurde im AMD64-Container ohne Datenbankzugriff geprueft.
Die temporaeren Testcontainer wurden anschliessend entfernt.
Der Login-Ablauf wurde auch im Browser gegen Admin-/Backend-Container mit
isoliertem PostgreSQL geprueft: falsches Passwort, erfolgreiche Anmeldung,
Uebersicht, Sitzungswiederherstellung nach Neuladen und Abmeldung.
Auch der visuelle Reisebericht-Ablauf wurde mit isolierter Datenbank im
Browser geprueft: formatierter Text, Entwurf, erneutes Speichern ohne
faelschliche Aenderungsmarkierung, Veroeffentlichung, oeffentliche Liste,
Detailansicht, RSS, Ruecknahme und Loeschen. Die Editor-Migration wurde
anschliessend additiv auf die konfigurierte lokale olconet-Datenbank
angewendet; Konten und bestehende Inhalte bleiben erhalten.
Der Bildablauf wurde im Browser mit isolierter Datenbank und temporaerem
Upload-Verzeichnis geprueft: Upload, Vorschau, Veroeffentlichung,
Kreationen-Galerie, Wechsel zur Sammy-Galerie, Ruecknahme und Dateiloeschung.
Der Bilddekoder und das persistente Upload-Volume wurden fuer ARM64 und
AMD64 unter UID 1001 mit schreibgeschuetztem Container-Dateisystem getestet.
Auch die additive Medienrevision-Migration ist lokal angewendet.
Berichtsbilder und Mehrfachupload wurden ebenfalls im Browser geprueft:
drei Dateien, Pause nach der ersten, absichtlicher Fehler bei der zweiten,
Fortsetzung und gezielte Wiederholung ohne verlorene erfolgreiche Uploads.
Die Warteschlangen-Grenze wurde mit 100 akzeptierten bzw. 101 abgewiesenen
Dateien geprueft. Inline-Bild, bearbeitbare Bildunterschrift und sortierte
Galerie wurden gespeichert und mit geladenen Bildern auf der Homepage
verifiziert. Die additive Berichtsbilder-Migration ist lokal angewendet.
`pnpm test:integration` startet einen kurzlebigen PostgreSQL-18-Container
mit zufaelligem Passwort und tmpfs-Daten, wendet Migrationen an und prueft
CLI-Einrichtung, Login, Sitzungen, Logout, CSRF, Limits, Schema-Konsistenz und
Reiseberichte einschliesslich Entwurf/Veroeffentlichung/Ruecknahme/Loeschen,
Versionskonflikten, HTML-Bereinigung, Pagination und RSS. Bildtests pruefen
Datei-/Metadatenvalidierung, Groessenlimits, EXIF-Entfernung, privaten Upload,
Veroeffentlichung, Galerie-Wechsel, Revisionen, Pagination, Ruecknahme,
Dateiloeschung und Persistenz bei Backend-Neustart.
Weitere Integrationstests pruefen transaktionale Inline-/Galeriezuordnungen,
fehlende/falsche Bild-IDs, berichtsspezifische Freigaben, geteilte Bilder
und duplikatfreie Upload-Wiederholungen einschliesslich paralleler Anfragen.
Der Container wird auch bei Testfehlern entfernt. Es werden keine existierenden
Datenbanken verwendet. Das Deployment auf Synology und die dortige
PostgreSQL-Erstinitialisierung muessen in der Zielumgebung verifiziert werden.

## Naechste Ausbauschritte

1. Kontaktformular mit serverseitiger Validierung, Rate-Limit, Spam-Schutz
   und SMTP-Versand an `janine@olconet.com`.
2. Passwort-/Kontoverwaltung, Datenschutz/Impressum, Backups, Monitoring und produktives Deployment.
