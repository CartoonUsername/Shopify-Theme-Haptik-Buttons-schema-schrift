# Boxspringbett-Konfigurator – Lieblingsbett (Grundgerüst)

Nachbau-Vorlage für einen Boxspringbett-Konfigurator (Architektur-Vorbild:
mozart-bett.de/build/boxspringbett), umgesetzt für die eigene Marke
**Lieblingsbett** – im gleichen Architekturmuster wie der bestehende
Plissee-Konfigurator: Shopify-Theme-Section + JS-Preisrechner + optionaler
Cloudflare-Worker für den Checkout mit korrektem Preis.

## Status

**MVP-Scope: nur "Lieblingsbett Basic" + "Lieblingsbett Comfort".**
"Lieblingsbett Prestige" ist in den Daten vorhanden (`enabled: false`) und
wird vom Konfigurator ausgeblendet, bis sie freigegeben wird. Zum
Aktivieren einfach `enabled: true` setzen.

**Gerüst, keine echten Produktdaten.** Es gab in dieser Session weder
Zugriff auf mozart-bett.de (Netzwerk-Proxy blockiert die Domain) noch auf
das bisherige Plissee-Projekt (anderes Repo/andere Session), noch liegt
die Bildlizenz vor – deshalb bleibt alles bewusst offline und mit
Platzhaltern, bis die Freigabe da ist. Alle Serien, Größen, Preise,
Kopfteile, Stoffe etc. in `data/boxspring-data.example.json` sind
**erfundene Platzhalter** zur Strukturprüfung, keine echten Werte, und die
Namen ("Lino", "Vasto", "Aurora", "Basic/Comfort/Prestige") sind eigene,
nicht von einem Lieferanten übernommene Bezeichnungen.

## Struktur

- `data/boxspring-data.example.json` – Beispiel-/Zieldatenstruktur: Serien
  mit je eigenen Größen/Basispreisen und Kompatibilitätslisten, plus globale
  Options-Listen (Kopfteile, Stoffe, Box, Füße, Matratzen, Topper, Extras)
  mit `priceDelta`. Diese Struktur ist eine Matrix, keine einfache Formel
  (Preis = Basispreis der Serie+Größe plus Summe der `priceDelta`-Werte der
  gewählten Optionen).
- `sections/boxspring-configurator.liquid` – Shopify-Section. Lädt die
  Optionsdaten **nicht** aus `{% schema %}`-Blocks (wie beim Plissee),
  sondern aus einer separaten JSON-Datei (`assets/boxspring-data.json`),
  weil die Datenmenge (Serien × Größen × viele Optionen) für Theme-Editor-
  Settings zu groß/unhandlich wäre. Die Section verweist per
  `data_asset`-Setting auf den Dateinamen. Kein eigenes Logo/Branding im
  Markup – das übernimmt der übliche Shop-Header des Themes.
- `assets/boxspring-configurator.js` – Schritt-Navigation, Live-Bildvorschau
  (Ebenen-Compositing, siehe unten), Live-Preis (`computeUnitPrice`),
  Kompatibilitätslogik (`reconcileSelection`), Zusammenfassung,
  `window.BoxspringConfiguratorOnAddToCart`-Hook.
- `assets/boxspring-configurator.css` – Mobile-first Grundlayout inkl.
  Ebenen-Stapelung für die Vorschau.
- `assets/boxspring-pricing-integration.js` – überschreibt den Add-to-Cart-
  Hook, sobald `pricingWorkerUrl` gesetzt ist: schickt die rohe Auswahl an
  einen Cloudflare Worker, bekommt `{ invoiceUrl }` zurück, leitet dorthin
  weiter (= echte Shopify-Kasse). Noch **kein Worker vorhanden** – siehe
  unten.
- `templates/product.boxspringbett.json` – Produkttemplate, bindet die
  Section ein.
- `preview.html` – lokale Vorschau ohne Shopify, mit Platzhalter-Logozeile
  "Lieblingsbett" (nur für die Vorschau, weil dort kein Theme-Header existiert).

## Lokal testen

```bash
python3 -m http.server 8123 --bind 127.0.0.1
# dann im Browser: http://127.0.0.1:8123/preview.html
```

`preview.html` hat kein Shopify-Cache-Busting – `?v=` bei Assets von Hand
hochzählen, wenn sich Dateien ändern und der Browser cached.

## Swipebare Galerie + Aktionsleiste

Die Vorschau ist jetzt eine swipebare Galerie mit mehreren "Aufnahmen" pro
Konfiguration (`GALLERY_SLIDES` in `boxspring-configurator.js`), analog zu
den Pfeilen/Punkten bei mozart-bett.de:

- Pfeile links/rechts, Punkt-Indikatoren unten, Touch-Swipe auf Mobil (40px
  Mindestbewegung).
- Bis echte Fotoserien vorliegen, sind die "Aufnahmen" vier unterschiedliche
  Zoom-/Pan-Ausschnitte derselben vier Ebenen (Übersicht, Kopfteil-Detail,
  Stoff-Detail, Fuß-Detail) – rein CSS-Transform auf denselben Layern, keine
  zusätzlichen Bilddateien nötig. Sobald echte Fotos da sind, kann man pro
  Slide echte Bild-URLs statt der Zoom-Simulation einsetzen; die
  Navigations-Logik (Pfeile/Punkte/Swipe/Reset) bleibt unverändert.
- Wechselt Serie/Größe/Kopfteil/Stoff/Füße, springt die Galerie automatisch
  zurück auf Bild 1 (neue Kombination = neuer erster Eindruck); reines
  Navigieren innerhalb der Galerie löst dagegen keinen Neuaufbau der
  Optionen/des Preises aus.

Darunter eine Aktionsleiste mit drei Buttons, wie bei Mozart:

- **Entwurf speichern**: kodiert die aktuelle Auswahl als `?bc-config=…`
  in der URL und kopiert den Link (kein Login/Backend nötig). Wird die
  Seite mit diesem Link erneut geöffnet, übernimmt `load()` die Auswahl
  automatisch – per Headless-Browser getestet (Auswahl vor/nach Reload
  identisch).
- **Maße**: zeigt Liegefläche aus den aktuellen Daten; Gesamthöhe ist
  bewusst als "wird ergänzt" markiert, da keine echten Produktmaße
  vorliegen (keine erfundenen Werte).
- **Gratis Stoffmuster**: reiner Platzhalter-Hinweis, dass der Ablauf noch
  mit dem Shop-Betreiber zu klären ist (siehe Auftrag Abschnitt 4.6).

Die Lieferzeit-Zeile links unten in der Vorschau kommt aus
`series.deliveryText` und zeigt standardmäßig "wird nach Freigabe ergänzt"
– es werden keine erfundenen Liefertermine angezeigt.

## Live-Bildvorschau: modularer Bett-Baukasten

Die Vorschau ist eine einzige generierte SVG-Illustration
(`buildBedIllustration()` in `boxspring-configurator.js`), die bei **jeder**
Auswahländerung komplett neu zusammengesetzt wird – aus austauschbaren
Bausteinen statt festen Bildern:

- **Kopfteil**: Form kommt aus `headboards[].shape` (`panel`/`channel`/
  `wing`, Registry `HEADBOARD_SHAPES`), Farbe aus dem gewählten Stoff.
- **Box**: immer im selben Stoff wie das Kopfteil (wie bei einem echten
  Boxspringbett – beide sind gepolstert).
- **Matratze**: weiß mit angedeuteten Steppnähten; **Topper** legt sich
  bei Auswahl (≠ "Kein Topper") als zusätzliche Schicht obendrauf.
- **Füße**: Form + Farbe + Länge kommen aus `feet[].shape` /
  `swatchColor` / `footLength` (Registry `FEET_SHAPES`, aktuell `peg` für
  Holz, `cylinder` für Metall).
- **Extras**: sichtbar im Bild, wenn das Extra ein `visual`-Feld trägt
  (Registry `EXTRA_VISUALS`, aktuell `usbIcon` und `ledGlow`) – ein Extra
  ohne bekanntes `visual` bleibt nur in Preis/Zusammenfassung sichtbar.

**Das ist der Kern der Modularität:** Ein neues Kopfteil, ein neuer Fuß
oder ein neues Extra in `boxspring-data.example.json` taucht automatisch
im Bild auf, sobald es eine der vorhandenen Formen/Visuals referenziert –
ohne dass `boxspring-configurator.js` angefasst werden muss. Referenziert
es keine bekannte Form, greift ein neutraler Standard (`panel`/`peg`/keine
Extra-Visualisierung), es gibt also nie einen kaputten Zustand.

Es ist bewusst eine **eigene, einfache geometrische Illustration** (kein
Nachbau eines echten Fotos irgendeines Anbieters) und durchgehend als
"Platzhalter-Vorschau – kein echtes Produktfoto" gekennzeichnet.

**So kommen später echte Fotos rein:** `buildBedIllustration()` wird durch
eine Auflösung echter Foto-URLs pro Slide/Kombination ersetzt (siehe
Galerie-Abschnitt oben) – die Navigations-Logik (Pfeile/Punkte/Swipe/
Reset) und die Preis-/Kompatibilitätslogik bleiben davon unberührt.

Getestet mit Headless Chromium: Kopfteil-Form (panel/channel/wing),
Fuß-Form/-Farbe (Holz/Metall), Topper-Schicht und beide Extra-Visuals
(USB-Badge, LED-Glow) erscheinen korrekt im Bild, Preis bleibt exakt
synchron (z. B. Comfort/200×200/Aurora/Metallfuß Schwarz/Topper 6cm/
USB+LED = 3.487,00 €, rechnerisch nachvollzogen).

## Was noch fehlt, bevor das produktiv nutzbar ist

1. **Echte Produktdaten**: Serien, Größen, alle Aufpreise, Kompatibilitäts-
   regeln, Lieferzeiten – erst nach Bildlizenz/Freigabe, idealerweise über
   einen offiziellen Export/API statt Scraping.
2. **Echte Fotos**: pro Kopfteil/Stoff/Füße/Serie ein `previewImage` mit
   transparentem Hintergrund im 800×600-Raster hinterlegen (siehe oben),
   optimiert (WebP/AVIF), in Shopify Files oder Cloudflare R2 abgelegt
   (nicht hotlinken).
3. **`assets/boxspring-data.json`**: die echte, gepflegte Datendatei (aus
   `data/boxspring-data.example.json` weiterentwickeln) ins Theme legen.
4. **Cloudflare Worker** (`boxspring-pricing-worker` oder Erweiterung des
   bestehenden Plissee-Workers): serverseitige Preisberechnung (nie dem
   Client vertrauen), Kompatibilitätsprüfung (siehe unten), `draftOrderCreate`
   per Shopify Admin GraphQL, `invoiceUrl` zurückgeben.
5. **Paritätstest**: Node-Skript, das für viele zufällige gültige
   Kombinationen prüft, dass `computeUnitPrice` im Theme-JS und im Worker
   dasselbe Ergebnis liefern.
6. **Produkt in Shopify anlegen**, Trägerprodukt/-variante für die
   Draft-Order-Position festlegen (für Bild/Steuer in der Kasse).
7. Rechtliche Klärung Streichpreis/Rabattdarstellung, Versandkosten,
   Lieferzeit-Texte.

## Kompatibilitätslogik (Serie / Größe / Kopfteil / Box / Füße / Matratze / Topper)

Jede Serie definiert in den Daten, welche Kopfteile/Boxen/Füße/Matratzen/
Topper zu ihr passen (`compatibleHeadboards`, `compatibleBoxes`, …). Beim
Kopfteil gibt es zusätzlich eine zweite, feinere Ebene: eine einzelne Größe
kann per `excludedHeadboards` ein Kopfteil wieder ausschließen, das die
Serie grundsätzlich führt (Beispiel in `boxspring-data.example.json`:
"Comfort" führt "Aurora", aber nicht bei 160×200).

Regeln:

- Wechselt die Serie oder die Größe, prüft `reconcileSelection()` **alle**
  abhängigen Auswahlen neu (Größe, Kopfteil, Box, Füße, Matratze, Topper).
  Eine ungültig gewordene Auswahl springt automatisch auf die erste noch
  kompatible Option – nie auf "nichts ausgewählt", damit der Preis immer
  vollständig bleibt.
- Fehlt ein `compatible*`-Feld auf der Serie, gilt der jeweilige Schritt als
  uneingeschränkt (z. B. Stoffe/Extras sind aktuell serienunabhängig).
- Getestet mit Headless Chromium: "Basic" zeigt nur "Classic Box" und kein
  "Aurora"-Kopfteil; "Comfort" verliert "Aurora" bei 160×200 und bekommt es
  bei 200×200 zurück; Wahl von "Aurora" gefolgt von Rücksprung auf 160×200
  springt automatisch auf "Lino" statt leer zu bleiben.
- **Wichtig für später:** Sobald der Cloudflare Worker existiert, muss er
  dieselbe Kompatibilitätsprüfung serverseitig wiederholen (nie nur dem
  Client vertrauen) – die Funktionen `isHeadboardCompatible`,
  `isOptionCompatible`, `filterCompatible` sind über
  `window.BoxspringConfiguratorPricing` exportiert, damit ein Paritätstest
  Theme-JS und Worker gegeneinander prüfen kann.

## Preisformel (aktueller Stand, Platzhalter-Daten)

```
unitPrice = size.basePrice
          + headboard.priceDelta
          + fabric.priceDelta
          + box.priceDelta
          + feet.priceDelta
          + mattress.priceDelta
          + topper.priceDelta
          + sum(extra.priceDelta for extra in selectedExtras)
```

Diese Formel steht aktuell nur im Theme-JS
(`assets/boxspring-configurator.js`, Funktion `computeUnitPrice`). Sobald
der Worker existiert, muss sie dort identisch nachgebaut und per
Paritätstest abgesichert werden.
