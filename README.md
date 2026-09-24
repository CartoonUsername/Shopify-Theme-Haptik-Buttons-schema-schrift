# Boxspringbett-Konfigurator (Grundgerüst)

Nachbau-Vorlage für einen Boxspringbett-Konfigurator nach dem Vorbild von
mozart-bett.de, im gleichen Architekturmuster wie der bestehende
Plissee-Konfigurator: Shopify-Theme-Section + JS-Preisrechner + optionaler
Cloudflare-Worker für den Checkout mit korrektem Preis.

## Status

**MVP-Scope: nur Serie 5 + 7.** Serie 9 ist in den Daten vorhanden
(`enabled: false`) und wird vom Konfigurator ausgeblendet, bis sie
freigegeben wird. Zum Aktivieren einfach `enabled: true` setzen.

**Gerüst, keine echten Mozart-Daten.** In dieser Session war `mozart-bett.de`
über den Netzwerk-Proxy nicht erreichbar und es gab keinen Zugriff auf das
bisherige Plissee-Projekt (anderes Repo/andere Session). Alle Serien,
Größen, Preise, Kopfteile, Stoffe etc. in `data/boxspring-data.example.json`
sind **Platzhalter** zur Strukturprüfung, keine echten Mozart-Werte.

## Struktur

- `data/boxspring-data.example.json` – Beispiel-/Zieldatenstruktur: Serien
  mit je eigenen Größen/Basispreisen und Kompatibilitätslisten, plus globale
  Options-Listen (Kopfteile, Stoffe, Box, Füße, Matratzen, Topper, Extras)
  mit `priceDelta`. Diese Struktur ist eine Matrix, keine einfache Formel
  (Preis = Basispreis der Serie+Größe plus Summe der `priceDelta`-Werte der
  gewählten Optionen) – siehe Auftragsbeschreibung Punkt 4.1.
- `sections/boxspring-configurator.liquid` – Shopify-Section. Lädt die
  Optionsdaten **nicht** aus `{% schema %}`-Blocks (wie beim Plissee),
  sondern aus einer separaten JSON-Datei (`assets/boxspring-data.json`),
  weil die Datenmenge (Serien × Größen × viele Optionen) für Theme-Editor-
  Settings zu groß/unhandlich wäre. Die Section verweist per
  `data_asset`-Setting auf den Dateinamen.
- `assets/boxspring-configurator.js` – Schritt-Navigation, Live-Vorschau
  (Platzhalter-Fläche, noch ohne echte Bilder/Layer), Live-Preis
  (`computeUnitPrice`), Zusammenfassung, `window.BoxspringConfiguratorOnAddToCart`-Hook.
- `assets/boxspring-configurator.css` – Mobile-first Grundlayout.
- `assets/boxspring-pricing-integration.js` – überschreibt den Add-to-Cart-
  Hook, sobald `pricingWorkerUrl` gesetzt ist: schickt die rohe Auswahl an
  einen Cloudflare Worker, bekommt `{ invoiceUrl }` zurück, leitet dorthin
  weiter (= echte Shopify-Kasse). Noch **kein Worker vorhanden** – siehe
  unten.
- `templates/product.boxspringbett.json` – Produkttemplate, bindet die
  Section ein.
- `preview.html` – lokale Vorschau ohne Shopify (siehe unten).

## Lokal testen

```bash
python3 -m http.server 8123 --bind 127.0.0.1
# dann im Browser: http://127.0.0.1:8123/preview.html
```

`preview.html` hat kein Shopify-Cache-Busting – `?v=` bei Assets von Hand
hochzählen, wenn sich Dateien ändern und der Browser cached.

## Was noch fehlt, bevor das produktiv nutzbar ist

1. **Echte Mozart-Daten**: Serien, Größen, alle Aufpreise, Kompatibilitäts-
   regeln, Lieferzeiten – idealerweise über einen offiziellen Export/API
   statt Scraping (siehe Auftrag Abschnitt 9/10).
2. **Bilder**: Analyse, ob Mozart die Vorschau aus Ebenen-Bildern (Layer-
   Compositing) oder vorgerenderten Kombinationsbildern aufbaut. Danach
   Bilder herunterladen, optimieren, in Shopify Files oder Cloudflare R2
   ablegen (nicht hotlinken).
3. **`assets/boxspring-data.json`**: die echte, gepflegte Datendatei (aus
   `data/boxspring-data.example.json` weiterentwickeln) ins Theme legen.
4. **Cloudflare Worker** (`boxspring-pricing-worker` oder Erweiterung des
   bestehenden Plissee-Workers): serverseitige Preisberechnung (nie dem
   Client vertrauen), Kompatibilitätsprüfung, `draftOrderCreate` per
   Shopify Admin GraphQL, `invoiceUrl` zurückgeben. Baut auf demselben
   Muster wie `plissee-pricing-worker` auf (siehe Auftrag Abschnitt 3.3).
5. **Paritätstest**: Node-Skript, das für viele zufällige gültige
   Kombinationen prüft, dass `computeUnitPrice` im Theme-JS und im Worker
   dasselbe Ergebnis liefern.
6. **Produkt in Shopify anlegen**, Trägerprodukt/-variante für die
   Draft-Order-Position festlegen (für Bild/Steuer in der Kasse).
7. Rechtliche Klärung Streichpreis/Rabattdarstellung, Versandkosten,
   Lieferzeit-Texte (siehe Auftrag Abschnitt 4.5–4.7).

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
