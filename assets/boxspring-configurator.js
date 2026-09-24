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

  function isHeadboardCompatible(series, headboardId) {
    return !series.compatibleHeadboards || series.compatibleHeadboards.indexOf(headboardId) !== -1;
  }

  function BoxspringConfigurator(root) {
    this.root = root;
    this.configEl = root.querySelector('[data-bc-config]');
    this.config = JSON.parse(this.configEl.textContent);
    this.data = null;
    this.selection = { extras: [] };
    this.step = STEP_ORDER[0];

    this.previewEl = root.querySelector('[data-bc-preview]');
    this.priceEl = root.querySelector('[data-bc-price]');
    this.optionsEl = root.querySelector('[data-bc-options]');
    this.summaryEl = root.querySelector('[data-bc-summary]');
    this.stepsEl = root.querySelector('.bc-steps');
    this.addToCartBtn = root.querySelector('[data-bc-add-to-cart]');

    this.addToCartBtn.addEventListener('click', this.onAddToCart.bind(this));

    this.load();
  }

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
        // Sinnvolle Startauswahl: erste Serie, erste Größe.
        self.selection.series = data.series[0] && data.series[0].id;
        var series = findById(data.series, self.selection.series);
        self.selection.size = series && series.sizes[0] && series.sizes[0].id;
        var firstHeadboard = data.headboards.filter(function (h) {
          return !series || isHeadboardCompatible(series, h.id);
        })[0];
        self.selection.headboard = firstHeadboard && firstHeadboard.id;
        self.selection.fabric = data.fabrics[0] && data.fabrics[0].id;
        self.selection.box = data.boxes[0] && data.boxes[0].id;
        self.selection.feet = data.feet[0] && data.feet[0].id;
        self.selection.mattress = data.mattresses[0] && data.mattresses[0].id;
        self.selection.topper = data.toppers[0] && data.toppers[0].id;
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
    this.renderPrice();
    this.renderSummary();
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

    var listMap = {
      series: this.data.series,
      size: series ? series.sizes : [],
      headboard: this.data.headboards.filter(function (h) {
        return !series || isHeadboardCompatible(series, h.id);
      }),
      fabric: this.data.fabrics,
      box: this.data.boxes,
      feet: this.data.feet,
      mattress: this.data.mattresses,
      topper: this.data.toppers,
      extras: this.data.extras
    };

    var list = listMap[this.step] || [];
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

      if (step === 'series') {
        // Größe und Kopfteil an neue Serie anpassen, falls inkompatibel.
        var series = this.currentSeries();
        if (series) {
          if (!findById(series.sizes, this.selection.size)) {
            this.selection.size = series.sizes[0] && series.sizes[0].id;
          }
          if (!isHeadboardCompatible(series, this.selection.headboard)) {
            var firstCompatible = this.data.headboards.filter(function (h) {
              return isHeadboardCompatible(series, h.id);
            })[0];
            this.selection.headboard = firstCompatible && firstCompatible.id;
          }
        }
      }
    }
    this.render();
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
      var list = step === 'series' ? self.data.series
        : step === 'size' ? (series ? series.sizes : [])
        : step === 'headboard' ? self.data.headboards
        : step === 'fabric' ? self.data.fabrics
        : step === 'box' ? self.data.boxes
        : step === 'feet' ? self.data.feet
        : step === 'mattress' ? self.data.mattresses
        : self.data.toppers;
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

  // Für Tests/Worker-Parität exportieren.
  window.BoxspringConfiguratorPricing = { computeUnitPrice: computeUnitPrice };
})();
