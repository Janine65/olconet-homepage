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
3. Die erste Seite im visuellen Editor schreiben; mit **Seite hinzufuegen**
   weitere Seiten anlegen. Ein Seitentitel ist optional. Absatz, Ueberschriften,
   Fett/Kursiv, Listen, Zitate und Rueckgaengig/Wiederholen sind verfuegbar.
   Der Editor wird erst beim Bearbeiten nachgeladen.
4. **Speichern** legt zunaechst einen privaten Entwurf an. Leerer Berichtstext
   und leere Kurzbeschreibung sind im Entwurf erlaubt, der Titel nicht.
5. **Seite veroeffentlichen** gibt nur die ausgewaehlte, gespeicherte Seite frei.
   Die erste veroeffentlichte Seite macht den Bericht auf der Homepage und
   im RSS-Feed sichtbar. Kurzbeschreibung sowie Text oder Fotos auf dieser
   Seite sind erforderlich; weitere Seiten bleiben private Entwuerfe.

Unter **Berichtsseiten** zwischen den Seiten wechseln und mit **Vor / Zurueck**
die Reihenfolge aendern. Seitenwechsel behalten ungespeicherte Inhalte.
Jede Seite hat ihren eigenen Text und ihre eigene Fotogalerie. Rueckgaengig
im Editor bleibt auf die jeweilige Seite beschraenkt. Neue Seiten sind immer
Entwuerfe, auch bei bereits sichtbaren Berichten. **Speichern** speichert
den gesamten Bericht mit allen Seiten atomar, nicht nur die ausgewaehlte Seite.
**Ausgewaehlte Seite entfernen** entfernt sie beim naechsten Speichern samt
Bildzuordnungen, aber nicht die Bilddateien. Mindestens eine Seite bleibt.
Laufende Uploads sperren den Seitenwechsel; bei einer pausierten, offenen
Warteschlange vor dem Wechsel deren Verwerfen bestaetigen oder zuerst fortsetzen.

Es gibt kein Autosave. Vor Veroeffentlichung, Ruecknahme oder Loeschen erst
speichern. Beim Verlassen eines bearbeiteten Berichts warnt die Verwaltung
vor ungespeicherten Aenderungen. Alle Verwaltungskonten koennen alle Berichte
bearbeiten; das urspruengliche Autorenkonto bleibt erhalten.

**Wichtig:** Speichern aendert veroeffentlichte Seiten und gemeinsame
Berichtsangaben sofort oeffentlich. Entwurfsseiten bleiben privat. Fuer die
private Ueberarbeitung einer sichtbaren Seite zuerst **Seite zuruecknehmen**
verwenden. Das URL-Kuerzel nach der Veroeffentlichung
moeglichst nicht mehr aendern, da alte Links sonst nicht mehr funktionieren.
Ein Versionszaehler verhindert, dass parallele Bearbeitung fremde Aenderungen
ueberschreibt. Bei HTTP 409 die eigenen Eingaben sichern und **Gespeicherte
Version neu laden** verwenden; der Konflikt wird nicht automatisch aufgeloest.

**Seite zuruecknehmen** sperrt nur diese Seite und ihre nicht anderweitig
veroeffentlichten Fotos. Nach Ruecknahme oder Entfernen der letzten sichtbaren
Seite verschwindet der Bericht auch aus Public-API und RSS.
**Alle Seiten zuruecknehmen** setzt alle Seiten wieder auf Entwurf.
Bereits von
RSS-Programmen heruntergeladene Eintraege koennen dort weiterhin existieren.
Nur Entwuerfe lassen sich nach Rueckfrage endgueltig loeschen.

Titel: maximal 200 Zeichen, URL-Kuerzel: 120, Kurzbeschreibung: 1000,
Reiseziel: 200, Seitentitel: 200, maximal 100 Seiten.
Alle Seitentexte zusammen: maximal 100000 UTF-8-Bytes je Sprache und Bericht.
Die JSON-Anfrage ist fuer zweisprachige Berichte auf 256 KiB begrenzt. Reisedaten sind optional;
Reiseende darf nicht vor Reisebeginn liegen. HTML wird serverseitig auf eine
enge Liste von Textformatierungen und Bildreferenzen begrenzt. Skripte,
Links, externe Bild-URLs, Styles und eingebettete Inhalte werden entfernt.
Das bisherige Feld `contentMarkdown` bleibt fuer bestehende
Daten erhalten; der Editor verwendet `contentHtml` pro Seite.
Die Migration uebernimmt bestehende Texte, Fotos und Veroeffentlichungszustaende
verlustfrei als erste Seite.

### Bilder im Seitentext und in der Seitengalerie

Reisebilder haben die Kategorie **Reiseberichte** (`TRAVEL`). Im Bericht unter
**Bilder im Text und Galerie dieser Seite** vorhandene Reisebilder auswaehlen,
oder dort mehrere Dateien mit der Warteschlange hochladen. Erfolgreiche
Uploads werden zur **noch ungespeicherten** Galerie der ausgewaehlten Seite hinzugefuegt.
Zum Anlegen einer Bildzuordnung den Bericht danach speichern.
Beim Mehrfachupload direkt im Reisebericht zeigt jeder Eintrag eine kleine
Fotovorschau. Der Titel ist anfangs leer statt mit dem Dateinamen vorbelegt;
Titel und Alternativtext vor dem Start je Foto ausfuellen. Die Vorschau bleibt
auch nach erfolgreichem Upload sichtbar.

- **Im Text:** Im Editor die gewuenschte Einfuegeposition anklicken, ein
  Reisebild auswaehlen, optional eine Bildunterschrift angeben und **Im Text
  einfuegen** verwenden. Die Bildunterschrift ist unter dem Bild direkt
  im Editor bearbeitbar. Zum Entfernen das Bild markieren und loeschen.
  Vor dem Einfuegen unter **Bildgroesse im Text** zwischen **Klein (100 x 100)**,
  **Mittel (250 x 250)** und **Gross (500 x 500 Pixel)** waehlen. Standard ist
  Mittel, auch fuer bestehende Textbilder ohne gespeicherte Groesse.
  Das vollstaendige Foto wird ohne Beschnitt oder Verzerrung im gewaehlten
  quadratischen Rahmen dargestellt; auf schmalen Bildschirmen verkleinert
  sich der Rahmen proportional. Zum Aendern eines eingefuegten Fotos das
  Bild markieren oder in seine Bildunterschrift klicken und einen der drei
  Groessen-Buttons in der Editor-Werkzeugleiste verwenden. Erst Speichern
  uebernimmt die Groesse. Galerie-Fotos und die Grossansicht bleiben unveraendert.
- **Galerie:** **Zur Seitengalerie hinzufuegen** verwenden. Die Liste
  laesst sich mit **Bild nach vorne/hinten** sortieren. Bildunterschriften
  sind optional (maximal 500 Zeichen pro Galerieeintrag). Die Galerie steht
  unter dem Seitentext. Entfernen aus der Galerie entfernt nicht das
  gleiche Bild im Text.
- Dasselbe Bild kann in beiden Varianten, auf mehreren Seiten und in mehreren Berichten
  verwendet werden. Maximal 100 verschiedene Bilder pro Bericht.
- Titel und Alternativtext des Bildes werden in der Bildverwaltung gepflegt.
  Zugeordnete Bilder koennen nicht geloescht oder einer anderen Kategorie
  zugeteilt werden. Zuerst aus **allen** Berichten entfernen und speichern.
  Eine Bildzuordnung verschwindet beim Loeschen eines Berichts; die Datei bleibt.

Reisebilder werden **nicht einzeln veroeffentlicht**. Nur die gespeicherten
Bildzuordnungen einer veroeffentlichten Seite eines sichtbaren Berichts geben dessen
berichtsspezifische URLs frei:
`/api/public/reports/:slug/images/:id`. Entwurfsbilder bleiben privat,
auch wenn ihre ID bekannt ist. Ruecknahme oder Entfernen eines Bildes
beim Speichern sperrt die betreffende Berichts-URL sofort. Wird das Bild in
einem anderen veroeffentlichten Bericht verwendet, bleibt es dort erreichbar.
Bereits heruntergeladene Bilder lassen sich nicht zurueckrufen.
Die globale Public-Galerie zeigt niemals Reisebilder.

Berichtsspeicherung erwartet `pages` in der gewuenschten Reihenfolge.
Eine Seite hat `{ "id": "UUID", "title": "...", "contentHtml": "...",
"galleryImages": [{ "assetId": "UUID", "caption": "..." }] }`.
Neue IDs werden vom Editor erzeugt oder bei fehlendem `id` von der API
vergeben. `status` und `publishedAt` sind nicht schreibbar; die eigene
Seitenfreigabe erfolgt ausschliesslich ueber die Status-Endpunkte.
Bilder im Text werden als
`<figure><img data-asset-id="UUID"><figcaption>...</figcaption></figure>`
referenziert. Die API validiert alle IDs gegen Reisebilder, speichert
Zuordnungen und Text atomar unter der Berichtsversion und setzt erst bei
oeffentlicher Ausgabe eigene Bild-URLs und den gespeicherten Alternativtext.
Vom Client gelieferte `src`-/`alt`-Attribute werden nicht uebernommen.
Textbilder speichern ihre Groesse als `data-image-size="100"`, `"250"` oder
`"500"` am `img`-Element. Andere Werte werden abgewiesen; ohne Angabe gilt
250. Die Public-API erzeugt daraus sichere `width`-/`height`-Attribute und
ignoriert vom Client gelieferte Groessenattribute oder Styles.
Ein weggelassenes `galleryImages` entspricht einer leeren Seitengalerie.
Alte einseitige Payloads mit `contentHtml` / `galleryImages` werden fuer
einseitige Berichte weiter angenommen; sie koennen keine mehrseitigen Berichte
ueberschreiben. Die Public-API liefert nur freigegebene `pages`; die alten
Felder `contentHtml` und `images` spiegeln die erste freigegebene Seite.

### Homepage und RSS

- Liste: `http://localhost:18431/reisen/`
- Einzelbericht: `/reisen/bericht/?slug=mein-bericht`
- Bestimmte Berichtsseite: `/reisen/bericht/?slug=mein-bericht&seite=SEITEN-UUID`
- RSS 2.0: `/api/public/reports/rss` (auch im Seitenkopf als Feed verlinkt)

Listen haben 20 Eintraege pro Seite; der Feed enthaelt die neuesten 50
veroeffentlichten Berichte mit Kurzbeschreibung und stabiler GUID.
Auf der Homepage blaettern **Vorherige / Naechste Seite** oder die Seitenauswahl
zwischen freigegebenen Seiten. Seitenlinks bleiben beim Umsortieren stabil;
Browser-Zurueck und direkte Links funktionieren. Entwurfsseiten sind weder
in der Auswahl noch in der Public-Antwort enthalten. Ein Klick auf ein Foto
oeffnet die Grossansicht; Pfeiltasten und Pfeil-Buttons blaettern ausschliesslich
durch die Fotos der aktuellen Seite, zuerst im Text, dann in der Galerie.
Dasselbe Foto im Text und in der Galerie wird dabei nur einmal gezaehlt.
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

### Deutsch und Englisch

Im Seitenkopf wechseln **Deutsch / English** zwischen den deutschen Seiten
und der englischen Version unter `/en/`. Alle bisherigen deutschen URLs
bleiben erhalten. Navigation, feste Texte, Status-/Fehlermeldungen,
Seitenauswahl und Foto-Grossansicht sind in beiden Sprachen verfuegbar.
Die Sprachwahl bleibt beim Navigieren erhalten; der Sprachwechsel eines
Reiseberichts behaelt dessen `slug` und aktuelle `seite` bei.

Die Verwaltung bleibt deutschsprachig. Unter **Englische Uebersetzung**
koennen folgende Inhalte separat gepflegt werden:

- Reisebericht: `titleEn`, `excerptEn`, `destinationEn`.
- Berichtsseite: `titleEn`, `contentHtmlEn` im eigenen visuellen Editor.
  **Im englischen Text einfuegen** fuegt das gewaehlte Foto in diesen Editor
  ein; Bildgroessen und bearbeitbare Bildunterschriften funktionieren wie
  im deutschen Editor. Textbilder und deren Reihenfolge duerfen je Sprache
  unterschiedlich sein.
- Galerie-Bildunterschrift: `captionEn`, unabhaengig von der deutschen
  Bildunterschrift derselben Seite.
- Bild/Fotogruppe: `titleEn`, `altTextEn`, `descriptionEn`. Englische Titel
  und Alternativtexte koennen bereits beim Einzel-/Mehrfachupload erfasst
  werden. Bei Multi-Fotogruppen gelten gemeinsame Uebersetzungen fuer alle Fotos.

Alle englischen Felder sind optional. Ist eine Uebersetzung leer, verwendet
die englische Ausgabe feldweise den deutschen Inhalt. Ein leerer englischer
Editor (auch mit leeren Absaetzen) verwendet den gesamten deutschen Seitentext.
Es findet keine automatische Uebersetzung statt. Beide Sprachen werden mit
derselben Berichtsversion/Bildrevision gespeichert und gemeinsam je Seite
veroeffentlicht oder zurueckgenommen. Entwurfsseiten bleiben in beiden
Sprachen privat.

Die oeffentlichen Listen, Berichtsdetails und RSS akzeptieren `?lang=en`
(Standard: `de`; andere Werte ergeben HTTP 400). Beispiele:
`/api/public/media?category=SAMMY&lang=en`,
`/api/public/reports?lang=en`,
`/api/public/reports/meine-reise?lang=en` und
`/api/public/reports/rss?lang=en`. Der englische Feed verlinkt englische Seiten.
Die Bilddateien werden nicht dupliziert; Bildfreigaben beruecksichtigen
Referenzen aus beiden Sprachfassungen. Alte Speicheranfragen ohne englische
Felder erhalten vorhandene Uebersetzungen.

Vor dem Backend-Neustart **`pnpm db:deploy`** ausfuehren (in Docker den
Migrationscontainer verwenden). Die Migration `20261016160000_english_content`
ergaenzt leere englische Felder; bestehende deutsche Inhalte und Freigaben
bleiben unveraendert.

| API | Zweck |
| --- | --- |
| `GET /api/admin/reports?page=1` | Geschuetzte Berichtsliste |
| `POST /api/admin/reports` | Neuen Entwurf anlegen |
| `GET /api/admin/reports/:id` | Bericht zum Bearbeiten laden |
| `POST /api/admin/reports/:id/save` | Eingaben mit aktueller `version` speichern |
| `POST /api/admin/reports/:id/pages/:pageId/publish` | Einzelne Seite freigeben; erste Seite schaltet Bericht frei |
| `POST /api/admin/reports/:id/pages/:pageId/unpublish` | Einzelne Seite zuruecknehmen |
| `POST /api/admin/reports/:id/publish` | Kompatibilitaet: alle gespeicherten Seiten veroeffentlichen |
| `POST /api/admin/reports/:id/unpublish` | Alle Seiten zuruecknehmen |
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
ausfuehren, damit auch die neuen Berichtsseiten und Bildzuordnungen vorhanden sind.

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
Die Listen enthalten 20 Einzelbilder bzw. Fotogruppen pro Seite und die Galerien benoetigen JavaScript.
Reisebilder werden nur mit ihren Berichten veroeffentlicht, nicht ueber diese
Bildliste. Sie koennen bereits vor dem Schreiben eines Berichts hochgeladen werden.

### Fotos auf der Homepage vergroessern

Ein Klick auf ein Foto in Sammy, Meine Kreationen oder einem Reisebericht
(im Text oder in der Berichtsgalerie) oeffnet eine bildschirmfuellende Grossansicht.
Das vollstaendige Foto wird im richtigen Seitenverhaeltnis so gross wie
moeglich dargestellt, ohne Beschnitt. Verwendet wird die groesste gespeicherte
Bildversion (maximal 2560 Pixel), nicht das unverkleinerte Upload-Original.
Auch einzelne Fotos innerhalb einer Multi-Fotogruppe lassen sich so oeffnen.
In einer Multi-Fotogruppe blaettern **Pfeil links / rechts** oder die beiden
**Pfeil-Buttons** zwischen den Fotos dieser Gruppe. Die Anzeige **Foto X von Y**
zeigt die aktuelle Position. Die Ansicht startet beim angeklickten Foto und
stoppt am ersten bzw. letzten Foto; dort ist der jeweilige Button deaktiviert.
Einzelbilder haben keine Blaetter-Buttons. Andere Gruppen bleiben getrennt.
Die Ansicht laesst sich mit **Schliessen** oder **Escape** verlassen.
Mit der Tastatur ein Foto per Tab auswaehlen und per Enter oder Leertaste oeffnen;
beim Schliessen kehrt der Fokus zum Foto zurueck.

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

### Multi-Fotogruppen fuer Sammy und Meine Kreationen

**Multi-Fotogruppe hochladen** im Bereich **Sammy** oder **Meine Kreationen**
oeffnet einen gemeinsamen Upload fuer 2 bis 100 Fotos derselben Kategorie.
Titel und Alternativtext werden **einmal fuer die ganze Gruppe** eingegeben.
Nach den einzelnen Uploads wird die Gruppe gespeichert. Die Homepage zeigt
alle Fotos zusammen in einem umrahmten Galerieeintrag mit einem gemeinsamen
Titel; jedes Foto verwendet den gemeinsamen Alternativtext.

In Bildliste, Sortierung und Uebersicht zaehlt eine Fotogruppe als **ein Eintrag**.
Bearbeitung, Veroeffentlichung, Ruecknahme und Loeschung gelten immer fuer
die ganze Gruppe. Die Bearbeitung zeigt Vorschauen aller Fotos; auch
Beschreibung und Kategorie werden gemeinsam gepflegt. Ein Wechsel ist nur
zwischen Sammy und Meine Kreationen moeglich, nie zu Reiseberichten.
Die Gruppe wird bei der Seitennavigation nicht aufgeteilt. Bestehende
Einzelbilder bleiben unveraendert; gleiche Titel allein bilden keine Gruppe.

Bei Uploadfehlern einzelne Fotos erneut versuchen oder fehlgeschlagene
Eintraege entfernen und Ersatzdateien hinzufuegen. Gemeinsame Angaben bleiben
ab dem ersten begonnenen Upload gesperrt. Erst wenn alle mindestens zwei Fotos
gespeichert sind, wird die Gruppe angelegt; eine verlorene Antwort kann mit
**Warteschlange starten / fortsetzen** sicher wiederholt werden. Bis dahin
bleiben erfolgreiche Uploads als private Einzelentwuerfe erhalten. Bei Abbruch
oder Schliessen des Tabs sind diese in der Bildliste einzeln bereinigbar;
die Warteschlange selbst wird nicht dauerhaft gespeichert.
Nach **Fotogruppe gespeichert** die erledigten Eintraege entfernen, um
eine neue Gruppe zu beginnen.

#### Bestehende Fotogruppen erweitern

In **Sammy**, **Meine Kreationen** oder der **Bildbibliothek** eine
**Fotogruppe bearbeiten**. Unter **Fotos zur Fotogruppe hinzufuegen** eine
oder mehrere Dateien auswaehlen und die Warteschlange starten. Neue Fotos
werden in Auswahlreihenfolge hinten angehaengt. Insgesamt sind weiterhin
maximal **100 Fotos pro Gruppe** erlaubt. Die Gruppe behaelt ihre Position
in der Galerie und zaehlt weiterhin als ein Eintrag.

Alle neuen Fotos uebernehmen die gespeicherten gemeinsamen Angaben,
einschliesslich deutscher und englischer Titel, Alternativtexte und
Beschreibungen. Sie uebernehmen auch den Veroeffentlichungsstatus:
**Bei bereits veroeffentlichten Gruppen sind sie nach dem erfolgreichen
Hinzufuegen sofort oeffentlich sichtbar.** Entwurfsgruppen bleiben privat.
Gruppenangaben vor der Dateiauswahl speichern; waehrend einer offenen
Warteschlange bleiben sie gegen unbeabsichtigte Aenderungen gesperrt.

Erst nach erfolgreichen Uploads der gesamten Auswahl werden die Fotos
gemeinsam angehaengt. Fehlerhafte Dateien koennen erneut versucht oder
aus der Warteschlange entfernt werden. Bei Speicherkonflikten
**Gespeicherte Fotogruppe neu laden** und die Warteschlange fortsetzen;
die bereits hochgeladenen Dateien muessen nicht nochmals uebertragen
werden. Solange das Anhaengen nicht erfolgreich bestaetigt wurde, koennen
auch erledigte Eintraege aus dieser Warteschlange entfernt werden.
Entfernen aus der Warteschlange loescht keine Bilddatei und nimmt keine
bereits erfolgte Gruppenzuordnung zurueck.

Nach Erfolg **Erledigte Eintraege entfernen**, um derselben Gruppe weitere
Fotos hinzuzufuegen. Bei Abbruch bleiben noch nicht zugeordnete Uploads
private Einzelentwuerfe in der Bildbibliothek.

Die API `POST /api/admin/media/group` erwartet `{ "ids": ["UUID", "UUID"] }`
in der gewuenschten Bildreihenfolge. Sie gruppiert ausschliesslich unveraenderte,
unzugeordnete Entwuerfe gleicher Kategorie mit identischem Titel und Alternativtext.
Die erste ID ist die gemeinsame Verwaltungs-ID und das erste Foto; die weiteren
Foto-IDs stehen in `children`. Diese IDs sind nur fuer Bild-URLs vorgesehen;
Verwaltungsaktionen erfolgen ueber die gemeinsame ID.
`POST /api/admin/media/:id/photos` erweitert eine bestehende Gruppe mit
`{ "ids": ["UUID"], "revision": 0 }`. Die IDs bezeichnen unveraenderte,
unzugeordnete Entwuerfe derselben Kategorie. Die API prueft die aktuelle
Gruppenrevision und uebernimmt gemeinsame Angaben und Freigabe atomar.
Wiederholungen desselben bereits angehaengten Batches erzeugen keine
Duplikate und veraendern die Revision nicht erneut. Diese Erweiterung
benoetigt keine weitere Datenbankmigration.
Die neue Datenbankmigration vor dem Backend-Start mit `pnpm db:deploy` anwenden.

### Mehrere Einzelbilder mit Warteschlange

Unter **Mehrere Einzelbilder hochladen** in der **Bildbibliothek** mehrere Dateien auf einmal auswaehlen.
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
| `POST /api/admin/media/:id/photos` | Neue Foto-Entwuerfe an eine bestehende Gruppe anhaengen |
| `POST /api/admin/media/:id/publish` | Bild veroeffentlichen |
| `POST /api/admin/media/:id/unpublish` | Veroeffentlichung zuruecknehmen |
| `POST /api/admin/media/:id/delete` | Entwurf und Datei loeschen |
| `GET /api/public/media?category=DRAWING&page=1` | Veroeffentlichte Galerie |
| `GET /api/public/media/:id/image` | Nur veroeffentlichte Bilddatei |

Metadaten bestehen aus `category` (`DRAWING`, `SAMMY` oder `TRAVEL`), `title`,
`altText`, `description` (String, leer erlaubt) und `sortOrder`.
Optional: `titleEn` (maximal 200 Zeichen), `altTextEn` (500) und
`descriptionEn` (2000); leere Strings aktivieren den deutschen Ersatz.
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

Nach dem einmaligen Einrichten von `.env.docker.mac` koennen die
Package-Scripts aus dem Projektwurzelverzeichnis verwendet werden:

```sh
pnpm docker:build:mac
pnpm docker:run:mac
```

**Build** baut ausschliesslich Homepage, Verwaltung und Backend mit der
Plattform und den Image-Namen aus `.env.docker.mac` (Vorlage: `linux/arm64`,
Tag `test`). **Run** fuehrt zuerst die Datenbankmigrationen mit dem gebauten
Backend-Image aus und startet nur bei Erfolg die drei App-Container im
Hintergrund. Es wartet auf deren Healthchecks und baut keine Images neu.
Ein vorhandenes Verwaltungskonto wird weiterverwendet. Vor dem ersten Run
die Datenbankverbindung konfigurieren; ein Konto bei Bedarf mit dem unten
gezeigten `create-admin`-Befehl anlegen. Lokale Dev-Services vorher beenden,
da dieselben Ports verwendet werden.

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

Fuer den Registry-Transfer in `.env.docker.synology` `DOCKER_PLATFORM=linux/amd64`,
den eigenen `IMAGE_PREFIX` (Docker-Hub-Benutzername oder Registry samt Namespace)
und `IMAGE_TAG` setzen. Vor dem ersten Push bei der Registry anmelden,
beispielsweise mit `docker login` fuer Docker Hub. Zugangsdaten nicht in
Package-Scripts oder Env-Vorlagen hinterlegen.

```sh
pnpm docker:build-push:synology
```

Das Script baut die drei App-Images und pusht sie nur nach erfolgreichem
Build. Es startet keine Container und fuehrt keine Migrationen auf dem NAS
aus. Build und Push lassen sich auch getrennt ausfuehren:

```sh
pnpm docker:build:synology
pnpm docker:push:synology
```

Alternativ fuer den Transfer per Archiv statt Registry:

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
