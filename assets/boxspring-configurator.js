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

  // ---------------------------------------------------------------------
  // Modulares Bett-Baukasten-SVG (eigene, generische Illustration – kein
  // Nachbau eines echten Produktfotos). Jedes Teil (Kopfteil-Form, Füße-
  // Form, Extra-Badges) kommt aus einer kleinen Registry, die per `shape`/
  // `visual`-Feld aus den Daten ausgewählt wird. Neue Kopfteile/Füße/Extras
  // in boxspring-data.json bekommen automatisch eine passende Darstellung,
  // ohne dass dieser Code angefasst werden muss – solange sie eine der
  // vorhandenen Formen referenzieren (oder den Standardfall nutzen).
  //
  // WICHTIG: Das ist bewusst *keine* Fotomontage und darf nie als echtes
  // Produktfoto präsentiert werden ("Platzhalter-Vorschau"-Badge bleibt
  // sichtbar). Sobald lizenzierte Fotos vorliegen, ersetzt man
  // buildBedIllustration() durch eine Foto-URL-Auflösung pro Slide/
  // Kombination; die Galerie-Navigation (Pfeile/Punkte/Swipe) bleibt
  // unverändert, siehe GALLERY_SLIDES weiter unten.
  // ---------------------------------------------------------------------

  function escapeXml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function darkenHex(hex, amount) {
    hex = (hex || '#c9c2b2').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var num = parseInt(hex, 16);
    var r = Math.max(0, (num >> 16) - amount);
    var g = Math.max(0, ((num >> 8) & 0xff) - amount);
    var b = Math.max(0, (num & 0xff) - amount);
    return '#' + [r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  // Kopfteil-Formen. `shape`-Feld auf einem Kopfteil in den Daten wählt
  // eine davon; unbekannt/fehlend -> 'panel' (schlichtes Panel).
  var HEADBOARD_SHAPES = {
    panel: function (x, y, w, h, fill) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="18" fill="' + fill + '"/>';
    },
    channel: function (x, y, w, h, fill) {
      var dark = darkenHex(fill, 30);
      var lines = '';
      var count = 7;
      for (var i = 1; i < count; i++) {
        var lx = x + (w / count) * i;
        lines += '<line x1="' + lx + '" y1="' + (y + 16) + '" x2="' + lx + '" y2="' + (y + h - 16) + '" stroke="' + dark + '" stroke-width="3" opacity="0.5"/>';
      }
      return HEADBOARD_SHAPES.panel(x, y, w, h, fill) + lines;
    },
    wing: function (x, y, w, h, fill) {
      return (
        '<rect x="' + (x - 22) + '" y="' + (y - 18) + '" width="46" height="' + (h + 30) + '" rx="20" fill="' + fill + '"/>' +
        '<rect x="' + (x + w - 24) + '" y="' + (y - 18) + '" width="46" height="' + (h + 30) + '" rx="20" fill="' + fill + '"/>' +
        HEADBOARD_SHAPES.panel(x, y, w, h, fill)
      );
    }
  };

  // Fuß-Formen. `shape`-Feld auf einem Fuß in den Daten wählt eine davon;
  // unbekannt/fehlend -> 'peg' (schlichter Kegel-/Holzfuß).
  var FEET_SHAPES = {
    peg: function (cx, topY, len, color) {
      var bx = len * 0.14;
      return '<polygon points="' + (cx - 11) + ',' + topY + ' ' + (cx + 11) + ',' + topY + ' ' + (cx + bx) + ',' + (topY + len) + ' ' + (cx - bx) + ',' + (topY + len) + '" fill="' + color + '"/>';
    },
    cylinder: function (cx, topY, len, color) {
      return (
        '<rect x="' + (cx - 6) + '" y="' + topY + '" width="12" height="' + len + '" rx="6" fill="' + color + '"/>' +
        '<rect x="' + (cx - 3) + '" y="' + (topY + 4) + '" width="3" height="' + (len - 8) + '" rx="1.5" fill="#ffffff" opacity="0.35"/>'
      );
    }
  };

  // Extra-Visualisierungen. `visual`-Feld auf einem Extra in den Daten
  // wählt eine davon; unbekannt/fehlend -> keine Visualisierung (Extra
  // bleibt nur in Preis/Zusammenfassung sichtbar, nicht im Bild).
  var EXTRA_VISUALS = {
    usbIcon: function (parts) {
      parts.push('<rect x="612" y="212" width="40" height="22" rx="4" fill="#2c2a25"/>');
      parts.push('<text x="632" y="227" font-family="sans-serif" font-size="10" fill="#fff" text-anchor="middle">USB</text>');
    },
    ledGlow: function (parts) {
      parts.push('<rect x="90" y="224" width="620" height="36" rx="18" fill="#ffe9a8" opacity="0.28"/>');
      parts.push('<rect x="112" y="236" width="576" height="12" rx="6" fill="#ffe9a8" opacity="0.9"/>');
    }
  };

  /**
   * Baut die komplette Bett-Illustration (ein SVG, 800×600) aus dem
   * aktuellen Auswahl-Kontext: Kopfteil-Form + Stofffarbe (Kopfteil UND Box
   * bekommen denselben Stoff, wie bei einem echten Boxspringbett), Matratze
   * mit Steppnähten, optionaler Topper-Schicht, Füße (Form + Farbe je nach
   * Auswahl), sichtbare Extras. Reine Platzhalter-Grafik, kein Produktfoto.
   */
  function buildBedIllustration(ctx) {
    var w = 800, h = 600;
    var parts = [];

    parts.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + ctx.sceneColor + '"/>');
    parts.push('<rect x="0" y="' + (h * 0.8) + '" width="' + w + '" height="' + (h * 0.2) + '" fill="' + darkenHex(ctx.sceneColor, 10) + '"/>');

    ctx.extraVisuals.forEach(function (visual) {
      if (visual === 'ledGlow') EXTRA_VISUALS.ledGlow(parts);
    });

    var headboardFn = HEADBOARD_SHAPES[ctx.headboardShape] || HEADBOARD_SHAPES.panel;
    parts.push(headboardFn(140, 60, 520, 190, ctx.fabricColor));

    // Box, gepolstert im selben Stoff wie das Kopfteil.
    parts.push('<rect x="120" y="270" width="560" height="150" rx="18" fill="' + ctx.fabricColor + '"/>');
    parts.push('<rect x="120" y="270" width="560" height="150" rx="18" fill="none" stroke="' + darkenHex(ctx.fabricColor, 30) + '" stroke-width="2" opacity="0.4"/>');

    // Matratze mit angedeuteten Steppnähten.
    parts.push('<rect x="130" y="235" width="540" height="55" rx="14" fill="#f7f5ef"/>');
    for (var i = 0; i < 8; i++) {
      var lx = 150 + i * 68;
      parts.push('<line x1="' + lx + '" y1="242" x2="' + lx + '" y2="283" stroke="#e2ddd0" stroke-width="2"/>');
    }

    if (ctx.hasTopper) {
      parts.push('<rect x="140" y="220" width="520" height="24" rx="10" fill="#fffdf8" stroke="#e2ddd0" stroke-width="1"/>');
    }

    var feetFn = FEET_SHAPES[ctx.feetShape] || FEET_SHAPES.peg;
    [170, 630].forEach(function (cx) {
      parts.push(feetFn(cx, 420, ctx.feetLength, ctx.feetColor));
    });

    ctx.extraVisuals.forEach(function (visual) {
      if (visual === 'usbIcon') EXTRA_VISUALS.usbIcon(parts);
    });

    parts.push('<text x="16" y="24" font-family="sans-serif" font-size="15" fill="#2c2a25">' + escapeXml(ctx.seriesLabel) + '</text>');

    return '<svg class="bc-bed-illustration" xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + parts.join('') + '</svg>';
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
    var topper = findById(this.data.toppers, this.selection.topper);

    // Welche gewählten Extras haben eine Bild-Visualisierung? Jedes Extra
    // trägt dafür optional ein `visual`-Feld in den Daten (siehe
    // EXTRA_VISUALS) – neue Extras mit bekanntem visual-Typ tauchen so
    // automatisch im Bild auf, ohne dass dieser Code geändert wird.
    var extraVisuals = this.selection.extras
      .map(function (id) { return findById(self.data.extras, id); })
      .filter(function (extra) { return extra && extra.visual && EXTRA_VISUALS[extra.visual]; })
      .map(function (extra) { return extra.visual; });

    var bedSvg = buildBedIllustration({
      sceneColor: (series && series.previewSwatch) || '#efece4',
      headboardShape: (headboard && headboard.shape) || 'panel',
      fabricColor: (fabric && fabric.swatchColor) || '#b7ae9c',
      feetShape: (feet && feet.shape) || 'peg',
      feetColor: (feet && feet.swatchColor) || '#4a463d',
      feetLength: (feet && feet.footLength) || 40,
      hasTopper: !!(topper && topper.id !== 'none'),
      extraVisuals: extraVisuals,
      seriesLabel: seriesLabel
    });

    var dotsHtml = GALLERY_SLIDES
      .map(function (slide, i) {
        return '<button type="button" class="bc-gallery-dot' + (i === self.slideIndex ? ' is-active' : '') + '" data-bc-dot="' + i + '" aria-label="' + slide.label + '"></button>';
      })
      .join('');

    var deliveryText = (series && series.deliveryText) || 'Lieferzeit: wird nach Freigabe ergänzt';

    this.previewEl.innerHTML =
      '<div class="bc-gallery-viewport" data-bc-gallery-viewport style="transform:' + GALLERY_SLIDES[this.slideIndex].transform + '">' + bedSvg + '</div>' +
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
