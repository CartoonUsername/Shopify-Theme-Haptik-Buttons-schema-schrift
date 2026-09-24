/**
 * Überschreibt window.BoxspringConfiguratorOnAddToCart, sobald eine
 * pricingWorkerUrl in der Section-Config gesetzt ist. Schickt die rohe
 * Auswahl an den Cloudflare Worker (boxspring-pricing-worker), der den
 * Preis serverseitig neu berechnet und eine Shopify-Draft-Order mit
 * korrektem Preis + Custom Attributes anlegt. Der Worker antwortet mit
 * { invoiceUrl }, zu der wir weiterleiten (= echte Shopify-Kasse).
 *
 * Analog zu plissee-pricing-integration.js aus dem Plissee-Projekt.
 */
(function () {
  'use strict';

  function getConfig(instance) {
    return instance.config;
  }

  window.BoxspringConfiguratorOnAddToCart = function (payload, instance) {
    var config = getConfig(instance);

    if (!config.pricingWorkerUrl) {
      console.warn('[BoxspringPricingIntegration] Keine pricingWorkerUrl gesetzt – kein Checkout-Override aktiv.');
      return;
    }

    var button = instance.addToCartBtn;
    button.disabled = true;
    var originalLabel = button.textContent;
    button.textContent = 'Wird vorbereitet …';

    fetch(config.pricingWorkerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          {
            productId: payload.productId,
            variantId: payload.variantId,
            quantity: payload.quantity,
            selection: payload.selection
          }
        ]
      })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.error || 'Worker-Fehler (' + res.status + ')');
          });
        }
        return res.json();
      })
      .then(function (data) {
        if (!data.invoiceUrl) throw new Error('Worker-Antwort enthält keine invoiceUrl.');
        window.location.href = data.invoiceUrl;
      })
      .catch(function (err) {
        console.error('[BoxspringPricingIntegration]', err);
        alert('Der Warenkorb konnte nicht vorbereitet werden: ' + err.message);
        button.disabled = false;
        button.textContent = originalLabel;
      });
  };
})();
