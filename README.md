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

## Live-Bildvorschau (Ebenen-Compositing)

Die Vorschau besteht aus vier übereinandergestapelten Bild-Ebenen
(`renderPreview()` in `boxspring-configurator.js`), die bei **jeder**
Auswahländerung sofort neu zusammengesetzt werden:

1. **Basis** – Serie + Größe (Hintergrundfarbe + Bett-Silhouette)
2. **Kopfteil** – je nach gewähltem Kopfteil
3. **Stoff/Farbe** – Farbton über die Box-/Matratzenfläche gelegt
4. **Füße** – je nach gewählter Fuß-Variante

Solange kein echtes Foto vorliegt, generiert `placeholderLayerSvg()` pro
Ebene ein einfaches SVG (Form + Beschriftung, transparenter Hintergrund)
als Platzhalter – deutlich als "Platzhalter-Vorschau – kein echtes
Produktfoto" gekennzeichnet, damit niemand das für ein finales Bild hält.

**So kommen später echte Fotos rein, ohne den Code anzufassen:** Jede
Option (Kopfteil, Stoff, Füße, Serie) kann optional ein `previewImage`-Feld
mit einer Bild-URL bekommen (siehe `layerImage()`) – ist das Feld gesetzt,
wird automatisch das echte Foto statt des Platzhalters gerendert. Bilder
sollten dafür transparenten Hintergrund haben und auf ein einheitliches
800×600-Raster passen, damit die Ebenen sauber übereinanderliegen (analog
zum in der Auftragsbeschreibung erwähnten Layer-Compositing-Ansatz).

Getestet mit Headless Chromium: Kopfteil-, Stoff- und Serienwechsel ändern
die Vorschau sofort, Preis und Zusammenfassung bleiben synchron.

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
