(function () {
  'use strict';

  // Verified against the real "Reformation" theme (assets/product.js and
  // sections/main-product.liquid), not generic Dawn/OS2.0 conventions:
  //   - Each gallery slide is a `[data-media-id="<section id>-<media id>"]`
  //     element inside the #MediaGallery-<section id> wrapper.
  //   - <variant-selects> dispatches `product:variant-change` on `document`
  //     (event.detail.variant is the newly selected variant, with its
  //     numeric `id`) whenever the customer picks a different variant, but
  //     NOT on initial page load - the server-rendered HTML is already
  //     correct for the initially selected variant, so the starting variant
  //     id is read from the product form's hidden `input[name="id"]`.
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
      // Belt-and-suspenders: the theme's CSS has its own display rules for
      // slides (carousel/grid layout, is-active states), which can outrank
      // the [hidden] attribute's default UA style. An inline style always
      // wins short of an author !important rule.
      slide.style.display = visible ? '' : 'none';
      // The theme's own updateMedia() may have already marked a slide
      // active (e.g. the variant's native featured image) before our
      // listener ran. Clear it here so a hidden slide can never keep
      // rendering just because it's still flagged active.
      if (!visible) slide.classList.remove('is-active');
    });

    var parent = slides[0] && slides[0].parentElement;
    if (!parent) return;

    order.forEach(function (id, i) {
      var slide = bySlideId[id];
      if (!slide) return;
      parent.appendChild(slide);
      // Mirrors the theme's own updateMedia(): the first visible slide is
      // the one marked active for the slider/pagination UI.
      slide.classList.toggle('is-active', i === 0);
    });
  }

  function render(payload, variantId) {
    var slides = Array.prototype.slice.call(document.querySelectorAll(SLIDE_SELECTOR));
    if (!slides.length || !variantId) return;

    var variantData = payload.variants[String(variantId)];
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

    var input = document.querySelector(VARIANT_ID_INPUT_SELECTOR);
    if (input && input.value) {
      render(payload, input.value);
    }

    document.addEventListener('product:variant-change', function (event) {
      var variant = event.detail && event.detail.variant;
      if (!variant) return;
      render(payload, variant.id);
    });
  });
})();
