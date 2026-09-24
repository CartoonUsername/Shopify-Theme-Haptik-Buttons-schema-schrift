/**
 * Boxspring-Konfigurator
 *
 * Lädt die Options-/Preisdaten aus assets/boxspring-data.json (siehe
 * data/boxspring-data.example.json für die Struktur), führt den Nutzer durch
 * die Schritte Serie -> Größe -> Kopfteil -> Stoff -> Box -> Füße ->
 * Matratze -> Topper -> Extras und berechnet den Preis live.
 *
 * WICHTIG: Diese Preisformel (computeUnitPrice) muss 1:1 mit der Formel im
 * Cloudflare Worker übereinstimmen. Bei jeder Änderung hier auch den Worker
 * anpassen und den Paritätstest laufen lassen.
 *
 * Beim Klick auf "In den Warenkorb" wird zunächst der normale Shopify-
 * Warenkorb-Fluss genutzt (window.BoxspringConfiguratorOnAddToCart). Wenn
 * eine pricingWorkerUrl konfiguriert ist, überschreibt
 * boxspring-pricing-integration.js diesen Hook und leitet stattdessen zur
 * Worker-erzeugten Draft-Order-Checkout-URL weiter.
 */
(function () {
  'use strict';

  var STEP_ORDER = [
    'series',
    'size',
    'headboard',
    'fabric',
    'box',
    'feet',
    'mattress',
    'topper',
    'extras'
  ];

  var STEP_LABELS = {
    series: 'Serie',
    size: 'Größe',
    headboard: 'Kopfteil',
    fabric: 'Farbe / Stoff',
    box: 'Box',
    feet: 'Füße',
    mattress: 'Matratze',
    topper: 'Topper',
    extras: 'Extras'
  };

  // Welcher Schlüssel in data.* die Optionsliste für einen Schritt hält.
  var STEP_DATA_KEY = {
    series: 'series',
    headboard: 'headboards',
    fabric: 'fabrics',
    box: 'boxes',
    feet: 'feet',
    mattress: 'mattresses',
    topper: 'toppers',
    extras: 'extras'
  };

  // Swipebare "Fotos" pro Konfiguration. Bis echte Fotos vorliegen, sind das
  // vier unterschiedliche Ausschnitte/Zooms derselben vier Ebenen (siehe
  // renderPreview) – optisch wie mehrere Kamerawinkel, technisch dieselbe
  // Komposition mit CSS-Transform. Später ersetzt man das 1:1 durch echte
  // Fotoserien pro Kombination (gleiche Slide-Anzahl/Reihenfolge reicht,
  // der Rest der Galerie-Logik bleibt unverändert).
  var GALLERY_SLIDES = [
    { id: 'overview', label: 'Übersicht', transform: 'scale(1) translate(0, 0)' },
    { id: 'headboard', label: 'Kopfteil', transform: 'scale(1.7) translate(0, -14%)' },
    { id: 'fabric', label: 'Stoff', transform: 'scale(1.9) translate(0, 6%)' },
    { id: 'feet', label: 'Füße', transform: 'scale(2.4) translate(0, 22%)' }
  ];

  // Welches Feld auf der Serie die erlaubten IDs für einen Schritt auflistet.
  // Fehlt das Feld auf der Serie, gilt der Schritt als uneingeschränkt.
  // 'size' und 'headboard' haben eigene Sonderbehandlung (siehe unten).
  var SERIES_COMPAT_KEY = {
    box: 'compatibleBoxes',
    feet: 'compatibleFeet',
    mattress: 'compatibleMattresses',
    topper: 'compatibleToppers'
  };

  function computeUnitPrice(data, selection) {
    var series = findById(data.series, selection.series);
    if (!series) return null;

    var size = findById(series.sizes, selection.size);
    if (!size) return null;

    var price = size.basePrice;

    price += optionDelta(data.headboards, selection.headboard);
    price += optionDelta(data.fabrics, selection.fabric);
    price += optionDelta(data.boxes, selection.box);
    price += optionDelta(data.feet, selection.feet);
    price += optionDelta(data.mattresses, selection.mattress);
    price += optionDelta(data.toppers, selection.topper);

    (selection.extras || []).forEach(function (extraId) {
      price += optionDelta(data.extras, extraId);
    });

    return Math.round(price * 100) / 100;
  }

  function optionDelta(list, id) {
    if (!id) return 0;
    var opt = findById(list, id);
    return opt ? opt.priceDelta || 0 : 0;
  }

  /**
   * Erzeugt eine reine Platzhalter-Ebene als Daten-URI-SVG (transparenter
   * Hintergrund, eine einfache Form + Label) für einen Vorschau-Layer, für
   * den noch kein echtes Foto vorliegt. Kind bestimmt Form/Position, damit
   * mehrere Ebenen übereinander optisch als "Bett" lesbar bleiben.
   *
   * WICHTIG: Das ist bewusst *kein* echtes Produktfoto und darf nie als
   * eines präsentiert werden. Sobald echte, freigegebene Fotos vorliegen,
   * ersetzt man pro Option einfach previewImage (URL, transparenter
   * Hintergrund, gleiches 800×600-Raster) in den Daten – der Renderer hier
   * bleibt unverändert, siehe layerImage().
   */
  function placeholderLayerSvg(kind, label, color) {
    var w = 800, h = 600;
    var shape = '';
    var labelX = 16, labelY = 24, anchor = 'start';
    color = color || '#c9c2b2';

    if (kind === 'base') {
      shape =
        '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + color + '"/>' +
        '<rect x="120" y="260" width="560" height="260" rx="24" fill="#ffffff" fill-opacity="0.55"/>';
    } else if (kind === 'headboard') {
      shape = '<rect x="140" y="60" width="520" height="180" rx="16" fill="' + color + '"/>';
      labelY = 260;
    } else if (kind === 'fabric') {
      shape = '<rect x="120" y="260" width="560" height="260" rx="24" fill="' + color + '" fill-opacity="0.45"/>';
      labelY = 300; labelX = w / 2; anchor = 'middle';
    } else if (kind === 'feet') {
      shape =
        '<rect x="150" y="520" width="26" height="40" fill="' + color + '"/>' +
        '<rect x="624" y="520" width="26" height="40" fill="' + color + '"/>';
      labelY = 580;
    }

    var safeLabel = String(label || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      shape +
      '<text x="' + labelX + '" y="' + labelY + '" font-family="sans-serif" font-size="16" fill="#2c2a25" text-anchor="' + anchor + '">' + safeLabel + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // Liefert die Bildquelle für einen Vorschau-Layer: echtes Foto, falls in
  // den Daten hinterlegt (previewImage), sonst der generierte Platzhalter.
  function layerImage(kind, option, label, color) {
    if (option && option.previewImage) return option.previewImage;
    return placeholderLayerSvg(kind, label, color);
  }

  function optionLabel(step, option) {
    if (!option) return null;
    if (step === 'size') return option.width + ' × ' + option.length + ' cm';
    return option.name;
  }

  function findById(list, id) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  // Kopfteil-Kompatibilität hat zwei Ebenen: (1) grundsätzlich erlaubt für
  // die Serie (series.compatibleHeadboards), (2) optional pro Größe wieder
  // ausgeschlossen (size.excludedHeadboards), z. B. weil ein Kopfteil bei
  // einer sehr schmalen Breite nicht angeboten wird, obwohl die Serie es
  // grundsätzlich führt. Beide Felder sind optional; fehlen sie, gilt keine
  // Einschränkung auf dieser Ebene.
  function isHeadboardCompatible(series, headboardId, sizeId) {
    if (!series) return true;
    if (series.compatibleHeadboards && series.compatibleHeadboards.indexOf(headboardId) === -1) {
      return false;
    }
    var size = sizeId ? findById(series.sizes, sizeId) : null;
    if (size && size.excludedHeadboards && size.excludedHeadboards.indexOf(headboardId) !== -1) {
      return false;
    }
    return true;
  }

  // Generische Serie-Kompatibilität für Box/Füße/Matratze/Topper.
  function isOptionCompatible(series, step, optionId) {
    var key = SERIES_COMPAT_KEY[step];
    if (!series || !key || !series[key]) return true; // keine Einschränkung definiert
    return series[key].indexOf(optionId) !== -1;
  }

  // Liefert aus einer vollen Optionsliste nur die für die aktuelle
  // Serie/Größe kompatiblen Einträge. Für Schritte ohne Kompatibilitäts-
  // regeln (fabric, extras) kommt die volle Liste unverändert zurück.
  function filterCompatible(series, step, list, sizeId) {
    if (step === 'headboard') {
      return list.filter(function (o) {
        return isHeadboardCompatible(series, o.id, sizeId);
      });
    }
    if (SERIES_COMPAT_KEY[step]) {
      return list.filter(function (o) {
        return isOptionCompatible(series, step, o.id);
      });
    }
    return list;
  }

  function BoxspringConfigurator(root) {
    this.root = root;
    this.configEl = root.querySelector('[data-bc-config]');
    this.config = JSON.parse(this.configEl.textContent);
    this.data = null;
    this.selection = { extras: [] };
    this.step = STEP_ORDER[0];
    this.slideIndex = 0;
    this._previewFingerprint = null;
    this._touchStartX = null;

    this.previewEl = root.querySelector('[data-bc-preview]');
    this.priceEl = root.querySelector('[data-bc-price]');
    this.optionsEl = root.querySelector('[data-bc-options]');
    this.summaryEl = root.querySelector('[data-bc-summary]');
    this.stepsEl = root.querySelector('.bc-steps');
    this.addToCartBtn = root.querySelector('[data-bc-add-to-cart]');
    this.actionsEl = root.querySelector('[data-bc-actions]');

    this.addToCartBtn.addEventListener('click', this.onAddToCart.bind(this));
    this.previewEl.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: true });
    this.previewEl.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: true });
    if (this.actionsEl) this.renderActions();

    this.load();
  }

  // Swipe-Geste auf der Vorschau: nach links = nächstes Bild, nach rechts =
  // vorheriges. 40px Mindestbewegung, damit ein Tap nicht als Swipe zählt.
  BoxspringConfigurator.prototype.onTouchStart = function (e) {
    this._touchStartX = e.changedTouches[0].clientX;
  };

  BoxspringConfigurator.prototype.onTouchEnd = function (e) {
    if (this._touchStartX === null) return;
    var dx = e.changedTouches[0].clientX - this._touchStartX;
    this._touchStartX = null;
    if (Math.abs(dx) < 40) return;
    this.goToSlide(this.slideIndex + (dx < 0 ? 1 : -1));
  };

  // Wechselt das Gallerie-Bild, ohne die restliche Vorschau neu zu bauen
  // (kein voller render() nötig – nur Transform + aktiver Punkt ändern sich).
  BoxspringConfigurator.prototype.goToSlide = function (index) {
    var n = GALLERY_SLIDES.length;
    this.slideIndex = ((index % n) + n) % n;
    var viewport = this.previewEl.querySelector('[data-bc-gallery-viewport]');
    if (viewport) viewport.style.transform = GALLERY_SLIDES[this.slideIndex].transform;
    var self = this;
    this.previewEl.querySelectorAll('[data-bc-dot]').forEach(function (dot, i) {
      dot.classList.toggle('is-active', i === self.slideIndex);
    });
  };

  BoxspringConfigurator.prototype.load = function () {
    var self = this;
    fetch(this.config.dataUrl)
      .then(function (res) {
        if (!res.ok) throw new Error('boxspring-data.json konnte nicht geladen werden (' + res.status + ')');
        return res.json();
      })
      .then(function (data) {
        self.data = data;
        // MVP-Scope: nur Serien mit enabled:true (aktuell Serie 5 + 7).
        // Serie 9 bleibt in den Daten, wird aber ausgeblendet, bis sie
        // freigegeben wird.
        data.series = data.series.filter(function (s) {
          return s.enabled !== false;
        });
        // Sinnvolle Startauswahl: erste Serie, erste Größe, dann alle
        // abhängigen Optionen über reconcileSelection() auf die erste
        // jeweils kompatible Option setzen.
        self.selection.series = data.series[0] && data.series[0].id;
        var series = findById(data.series, self.selection.series);
        self.selection.size = series && series.sizes[0] && series.sizes[0].id;
        self.selection.fabric = data.fabrics[0] && data.fabrics[0].id;

        // Gespeicherten Entwurf aus der URL übernehmen (siehe saveDraft()),
        // falls vorhanden und die Serie darin noch existiert/aktiv ist.
        // Unbekannte/ungültige Felder werden von reconcileSelection()
        // direkt danach ohnehin auf eine gültige Option korrigiert.
        try {
          var params = new URLSearchParams(window.location.search);
          var raw = params.get('bc-config');
          if (raw) {
            var saved = JSON.parse(raw);
            if (saved && typeof saved === 'object') {
              Object.keys(saved).forEach(function (key) {
                self.selection[key] = saved[key];
              });
              if (!Array.isArray(self.selection.extras)) self.selection.extras = [];
              // Serie im gespeicherten Entwurf existiert nicht (mehr) oder
              // ist deaktiviert (z. B. Prestige im MVP) -> auf erste Serie
              // zurückfallen statt in einem ungültigen Zustand zu landen.
              if (!findById(data.series, self.selection.series)) {
                self.selection.series = data.series[0] && data.series[0].id;
              }
            }
          }
        } catch (e) {
          console.warn('[BoxspringConfigurator] Gespeicherter Entwurf in der URL konnte nicht gelesen werden.', e);
        }

        self.reconcileSelection();
        self.renderSteps();
        self.render();
      })
      .catch(function (err) {
        self.optionsEl.textContent = 'Konfigurator konnte nicht geladen werden: ' + err.message;
        console.error('[BoxspringConfigurator]', err);
      });
  };

  BoxspringConfigurator.prototype.renderSteps = function () {
    var self = this;
    this.stepsEl.innerHTML = '';
    STEP_ORDER.forEach(function (stepId) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bc-step-btn';
      btn.textContent = STEP_LABELS[stepId];
      btn.dataset.step = stepId;
      btn.addEventListener('click', function () {
        self.step = stepId;
        self.render();
      });
      self.stepsEl.appendChild(btn);
    });
  };

  BoxspringConfigurator.prototype.currentSeries = function () {
    return findById(this.data.series, this.selection.series);
  };

  BoxspringConfigurator.prototype.render = function () {
    this.renderActiveStepButton();
    this.renderOptionsForStep();
    this.renderPreview();
    this.renderPrice();
    this.renderSummary();
  };

  // Baut die Live-Vorschau als swipebare Galerie aus vier übereinander-
  // liegenden Bild-Ebenen (Basis-Szene je Serie/Größe, Kopfteil, Stoff-
  // Farbe, Füße) plus mehreren "Aufnahmen" (siehe GALLERY_SLIDES) davon.
  // Läuft bei *jeder* Auswahländerung, egal welcher Schritt gerade aktiv
  // ist – ein Kopfteil-Wechsel ändert also sofort das Bild, auch während
  // man z. B. gerade im Extras-Schritt ist. Das aktuelle Slide (welcher
  // "Kamerawinkel") bleibt dabei erhalten, solange sich Serie/Größe/
  // Kopfteil/Stoff/Füße nicht ändern – erst dann springt die Galerie
  // zurück auf die Übersicht.
  BoxspringConfigurator.prototype.renderPreview = function () {
    var self = this;
    var series = this.currentSeries();
    var size = series && findById(series.sizes, this.selection.size);
    var headboard = findById(this.data.headboards, this.selection.headboard);
    var fabric = findById(this.data.fabrics, this.selection.fabric);
    var feet = findById(this.data.feet, this.selection.feet);

    var fingerprint = [this.selection.series, this.selection.size, this.selection.headboard, this.selection.fabric, this.selection.feet].join('|');
    if (fingerprint !== this._previewFingerprint) {
      this.slideIndex = 0;
      this._previewFingerprint = fingerprint;
    }

    var sizeLabel = size ? size.width + ' × ' + size.length + ' cm' : '';
    var seriesLabel = (series ? series.name : this.data.brand || 'Bett') + (sizeLabel ? ' · ' + sizeLabel : '');

    var layers = [
      { kind: 'base', option: series, label: seriesLabel, color: series && series.previewSwatch },
      { kind: 'headboard', option: headboard, label: 'Kopfteil: ' + (headboard ? headboard.name : '—'), color: '#c2b9a5' },
      { kind: 'fabric', option: fabric, label: fabric ? fabric.name : '', color: (fabric && fabric.swatchColor) || '#b7ae9c' },
      { kind: 'feet', option: feet, label: '', color: '#4a463d' }
    ];

    var layersHtml = layers
      .map(function (layer, i) {
        var src = layerImage(layer.kind, layer.option, layer.label, layer.color);
        return '<img class="bc-layer" style="z-index:' + i + '" src="' + src + '" alt="' + layer.label.replace(/"/g, '&quot;') + '">';
      })
      .join('');

    var dotsHtml = GALLERY_SLIDES
      .map(function (slide, i) {
        return '<button type="button" class="bc-gallery-dot' + (i === self.slideIndex ? ' is-active' : '') + '" data-bc-dot="' + i + '" aria-label="' + slide.label + '"></button>';
      })
      .join('');

    var deliveryText = (series && series.deliveryText) || 'Lieferzeit: wird nach Freigabe ergänzt';

    this.previewEl.innerHTML =
      '<div class="bc-gallery-viewport" data-bc-gallery-viewport style="transform:' + GALLERY_SLIDES[this.slideIndex].transform + '">' + layersHtml + '</div>' +
      '<button type="button" class="bc-gallery-arrow bc-gallery-prev" data-bc-prev aria-label="Vorheriges Bild">‹</button>' +
      '<button type="button" class="bc-gallery-arrow bc-gallery-next" data-bc-next aria-label="Nächstes Bild">›</button>' +
      '<div class="bc-gallery-dots">' + dotsHtml + '</div>' +
      '<div class="bc-preview-delivery">' + deliveryText + '</div>' +
      '<div class="bc-preview-placeholder-badge">Platzhalter-Vorschau – kein echtes Produktfoto</div>';

    this.previewEl.querySelector('[data-bc-prev]').addEventListener('click', function () {
      self.goToSlide(self.slideIndex - 1);
    });
    this.previewEl.querySelector('[data-bc-next]').addEventListener('click', function () {
      self.goToSlide(self.slideIndex + 1);
    });
    this.previewEl.querySelectorAll('[data-bc-dot]').forEach(function (dot) {
      dot.addEventListener('click', function () {
        self.goToSlide(parseInt(dot.dataset.bcDot, 10));
      });
    });
  };

  // Untere Aktionsleiste (Entwurf speichern / Maße / Gratis Stoffmuster),
  // wird einmalig gerendert (unabhängig von Auswahländerungen).
  BoxspringConfigurator.prototype.renderActions = function () {
    var self = this;
    this.actionsEl.innerHTML =
      '<button type="button" class="bc-action-btn" data-bc-action="save">💾 Entwurf speichern</button>' +
      '<button type="button" class="bc-action-btn" data-bc-action="dimensions">📐 Maße</button>' +
      '<button type="button" class="bc-action-btn" data-bc-action="sample">🧵 Gratis Stoffmuster</button>';

    this.actionsEl.querySelector('[data-bc-action="save"]').addEventListener('click', function () {
      self.saveDraft();
    });
    this.actionsEl.querySelector('[data-bc-action="dimensions"]').addEventListener('click', function () {
      self.showDimensions();
    });
    this.actionsEl.querySelector('[data-bc-action="sample"]').addEventListener('click', function () {
      alert('Gratis Stoffmuster: Ablauf (eigenes Produkt/Formular?) ist mit dem Shop-Betreiber noch zu klären – hier nur Platzhalter.');
    });
  };

  // "Entwurf speichern": kodiert die aktuelle Auswahl als URL-Parameter
  // und kopiert den Link in die Zwischenablage (kein Login/Backend nötig).
  // Beim Laden mit ?bc-config=... wird die Auswahl in load() übernommen.
  BoxspringConfigurator.prototype.saveDraft = function () {
    var url = new URL(window.location.href);
    url.searchParams.set('bc-config', JSON.stringify(this.selection));
    var link = url.toString();

    var done = function (ok) {
      alert(ok ? 'Link kopiert! Damit lässt sich diese Konfiguration später wieder öffnen:\n\n' + link : link);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  };

  BoxspringConfigurator.prototype.showDimensions = function () {
    var series = this.currentSeries();
    var size = series && findById(series.sizes, this.selection.size);
    if (!size) { alert('Bitte zuerst Serie und Größe wählen.'); return; }
    alert(
      'Maße (Liegefläche): ' + size.width + ' × ' + size.length + ' cm\n' +
      'Höhe: wird ergänzt (Box + Matratze + Topper je nach Auswahl)\n' +
      '\nGenaue Gesamthöhe folgt, sobald reale Produktmaße vorliegen.'
    );
  };

  BoxspringConfigurator.prototype.renderActiveStepButton = function () {
    var self = this;
    this.stepsEl.querySelectorAll('.bc-step-btn').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.step === self.step);
    });
  };

  BoxspringConfigurator.prototype.renderOptionsForStep = function () {
    var self = this;
    var series = this.currentSeries();
    this.optionsEl.innerHTML = '';

    var list;
    if (this.step === 'series') {
      list = this.data.series;
    } else if (this.step === 'size') {
      list = series ? series.sizes : [];
    } else {
      var fullList = this.data[STEP_DATA_KEY[this.step]] || [];
      list = filterCompatible(series, this.step, fullList, this.selection.size);
    }
    var isMulti = this.step === 'extras';

    list.forEach(function (option) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'bc-option-card';

      var selected;
      if (isMulti) {
        selected = self.selection.extras.indexOf(option.id) !== -1;
      } else {
        selected = self.selection[self.step] === option.id;
      }
      card.classList.toggle('is-selected', selected);

      var priceLabel = option.priceDelta
        ? (option.priceDelta > 0 ? '+' : '') + option.priceDelta + ' €'
        : (self.step === 'series' || self.step === 'size' ? '' : 'inklusive');
      if (self.step === 'series') priceLabel = '';
      if (self.step === 'size') priceLabel = option.basePrice + ' €';

      card.innerHTML =
        '<span class="bc-option-name">' + optionLabel(self.step, option) + '</span>' +
        (priceLabel ? '<span class="bc-option-price">' + priceLabel + '</span>' : '');

      card.addEventListener('click', function () {
        self.selectOption(self.step, option.id, isMulti);
      });

      self.optionsEl.appendChild(card);
    });
  };

  BoxspringConfigurator.prototype.selectOption = function (step, id, isMulti) {
    if (isMulti) {
      var idx = this.selection.extras.indexOf(id);
      if (idx === -1) this.selection.extras.push(id);
      else this.selection.extras.splice(idx, 1);
    } else {
      this.selection[step] = id;

      // Serie oder Größe beeinflussen, was bei allen anderen Schritten
      // überhaupt wählbar ist (Kopfteil hängt von beidem ab; Box/Füße/
      // Matratze/Topper hängen von der Serie ab) – nach jeder Änderung
      // hier alle abhängigen Auswahlen neu abgleichen.
      if (step === 'series' || step === 'size') {
        this.reconcileSelection();
      }
    }
    this.render();
  };

  // Stellt sicher, dass jede aktuell gewählte Option zur Serie/Größe passt.
  // Wird eine Auswahl durch einen Serien- oder Größenwechsel ungültig,
  // springt sie auf die erste noch kompatible Option – nie auf "nichts
  // ausgewählt", damit der Preis immer vollständig und korrekt bleibt.
  BoxspringConfigurator.prototype.reconcileSelection = function () {
    var self = this;
    var series = this.currentSeries();
    if (!series) return;

    if (!findById(series.sizes, this.selection.size)) {
      this.selection.size = series.sizes[0] && series.sizes[0].id;
    }

    ['headboard', 'box', 'feet', 'mattress', 'topper'].forEach(function (step) {
      var fullList = self.data[STEP_DATA_KEY[step]] || [];
      var compatible = filterCompatible(series, step, fullList, self.selection.size);
      if (!findById(compatible, self.selection[step])) {
        self.selection[step] = compatible[0] && compatible[0].id;
      }
    });
  };

  BoxspringConfigurator.prototype.renderPrice = function () {
    var price = computeUnitPrice(this.data, this.selection);
    this.priceEl.textContent = price !== null ? formatPrice(price, this.config.currency) : '—';
  };

  BoxspringConfigurator.prototype.renderSummary = function () {
    var self = this;
    var series = this.currentSeries();
    var lines = STEP_ORDER.map(function (step) {
      if (step === 'extras') {
        var names = self.selection.extras
          .map(function (id) {
            var e = findById(self.data.extras, id);
            return e ? e.name : id;
          })
          .join(', ');
        return STEP_LABELS.extras + ': ' + (names || '—');
      }
      var list = step === 'size' ? (series ? series.sizes : []) : self.data[STEP_DATA_KEY[step]];
      var opt = findById(list, self.selection[step]);
      return STEP_LABELS[step] + ': ' + (optionLabel(step, opt) || '—');
    });
    this.summaryEl.innerHTML = lines.map(function (l) { return '<div>' + l + '</div>'; }).join('');
  };

  BoxspringConfigurator.prototype.getSelectionForCart = function () {
    return {
      variantId: this.config.variantId,
      productId: this.config.productId,
      quantity: 1,
      selection: this.selection,
      unitPrice: computeUnitPrice(this.data, this.selection)
    };
  };

  BoxspringConfigurator.prototype.onAddToCart = function () {
    var payload = this.getSelectionForCart();
    if (payload.unitPrice === null) {
      alert('Bitte alle Pflichtoptionen auswählen.');
      return;
    }
    if (typeof window.BoxspringConfiguratorOnAddToCart === 'function') {
      window.BoxspringConfiguratorOnAddToCart(payload, this);
    } else {
      console.warn('[BoxspringConfigurator] Kein Add-to-Cart-Handler registriert.');
    }
  };

  function formatPrice(amount, currency) {
    try {
      return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency || 'EUR' }).format(amount);
    } catch (e) {
      return amount.toFixed(2) + ' ' + (currency || 'EUR');
    }
  }

  function init() {
    document.querySelectorAll('.boxspring-configurator').forEach(function (root) {
      if (root.__bcInstance) return;
      root.__bcInstance = new BoxspringConfigurator(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Für Tests/Worker-Parität exportieren. Der Worker muss computeUnitPrice
  // UND die Kompatibilitätsprüfungen 1:1 nachbauen, sonst kann ein Client
  // eine eigentlich unzulässige Kombination einschicken.
  window.BoxspringConfiguratorPricing = {
    computeUnitPrice: computeUnitPrice,
    isHeadboardCompatible: isHeadboardCompatible,
    isOptionCompatible: isOptionCompatible,
    filterCompatible: filterCompatible
  };
})();
