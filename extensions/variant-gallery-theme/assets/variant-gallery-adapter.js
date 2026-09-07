(function () {
  'use strict';

  // Theme-specific glue. Written against common Online Store 2.0 / Dawn-style
  // conventions (data-media-id gallery slides, a "variant:change" event, and a
  // hidden `input[name="id"]` holding the selected variant id).
  //
  // NOT YET VERIFIED against the real "Reformation" theme markup — this needs
  // to be checked (e.g. via `shopify theme pull`) and these two spots adjusted
  // if the theme differs:
  //   1. SLIDE_SELECTOR / mediaIdFromSlide(): how a gallery slide is tied to
  //      its media id.
  //   2. The variant-change signal at the bottom of ready(): what event/DOM
  //      change the theme uses to announce a new selected variant.
  var SLIDE_SELECTOR = '[data-media-id]';
  var VARIANT_ID_INPUT_SELECTOR = 'input[name="id"]';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function parsePayload() {
    var dataEl = document.querySelector('[data-variant-gallery-data]');
    if (!dataEl) return null;
    try {
      return JSON.parse(dataEl.textContent);
    } catch (_e) {
      return null;
    }
  }

  function mediaIdFromSlide(slide) {
    var raw = slide.getAttribute('data-media-id') || '';
    var match = raw.match(/(\d+)$/);
    return match ? match[1] : null;
  }

  function applyVisibleImages(slides, visibleImages) {
    var order = visibleImages.map(function (img) { return String(img.id); });

    var bySlideId = {};
    slides.forEach(function (slide) {
      var id = mediaIdFromSlide(slide);
      if (id) bySlideId[id] = slide;
    });

    slides.forEach(function (slide) {
      var id = mediaIdFromSlide(slide);
      var visible = !!id && order.indexOf(id) !== -1;
      slide.hidden = !visible;
    });

    var parent = slides[0] && slides[0].parentElement;
    if (!parent) return;
    order.forEach(function (id) {
      var slide = bySlideId[id];
      if (slide) parent.appendChild(slide);
    });
  }

  function currentVariantId() {
    var input = document.querySelector(VARIANT_ID_INPUT_SELECTOR);
    return input ? input.value : null;
  }

  function render(payload) {
    var slides = Array.prototype.slice.call(document.querySelectorAll(SLIDE_SELECTOR));
    if (!slides.length) return;

    var variantId = currentVariantId();
    var variantData = variantId && payload.variants[variantId];
    var galleryIds = (variantData && variantData.gallery) || [];
    var legacyId = variantData && variantData.legacyImageId;

    var visible = window.VariantGalleryCore.computeVisibleImages(
      payload.images,
      galleryIds,
      legacyId,
    );

    applyVisibleImages(slides, visible);
  }

  ready(function () {
    var payload = parsePayload();
    if (!payload || !window.VariantGalleryCore) return;

    render(payload);

    document.addEventListener('variant:change', function () {
      render(payload);
    });

    var input = document.querySelector(VARIANT_ID_INPUT_SELECTOR);
    if (input) {
      input.addEventListener('change', function () { render(payload); });
      new MutationObserver(function () { render(payload); }).observe(input, {
        attributes: true,
        attributeFilter: ['value'],
      });
    }
  });
})();
