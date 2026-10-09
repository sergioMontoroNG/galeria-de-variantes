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

    // Reformation's "Grid" media layout (main-product.liquid's inline
    // <style>) sizes each slide purely by DOM position - the first 6
    // `.product-images__slide` children get 50% width (2 per row), the 7th
    // onward get 25% (4 per row) - counting hidden slides too, since
    // `display:none` doesn't remove an element from :nth-child counting.
    // A visible slide must therefore be moved to the front of the DOM, not
    // just reordered among the other visible ones, or a product with more
    // than 6 images ends up dumping its 2-3 visible slides into the 25%
    // bucket and leaving the rest of that row empty.
    var visibleSlides = [];
    order.forEach(function (id) {
      var slide = bySlideId[id];
      if (slide) visibleSlides.push(slide);
    });
    var hiddenSlides = slides.filter(function (slide) {
      return visibleSlides.indexOf(slide) === -1;
    });

    visibleSlides.forEach(function (slide, i) {
      parent.appendChild(slide);
      // Mirrors the theme's own updateMedia(): the first visible slide is
      // the one marked active for the slider/pagination UI.
      slide.classList.toggle('is-active', i === 0);
    });
    hiddenSlides.forEach(function (slide) {
      parent.appendChild(slide);
    });
  }

  function render(payload, variantId) {
    var slides = Array.prototype.slice.call(document.querySelectorAll(SLIDE_SELECTOR));
    if (!slides.length || !variantId) return;

    var variantData = payload.variants[String(variantId)];
    var galleryIds = (variantData && variantData.gallery) || [];
    var legacyId = variantData && variantData.legacyImageId;

    var items = window.VariantGalleryCore.computeGalleryItems(
      payload.images,
      galleryIds,
      legacyId,
      (variantData && variantData.videos) || [],
    );
    var visible = items.filter(function (item) { return item.type === 'image'; });

    applyVisibleImages(slides, visible);
    applyVideos(slides, items);
  }

  // --- YouTube tiles --------------------------------------------------------
  // Videos are not theme media: each one is a thumbnail tile we create here, the
  // same size as a photo, and the player only loads when it is clicked. The
  // theme's own video slides stay hidden (they are not in the image list), so a
  // video never renders at the theme's full-width size.
  var TILE_ATTR = 'data-variant-gallery-video';
  var styleInjected = false;
  var modal = null;
  var lastFocus = null;

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    var style = document.createElement('style');
    style.textContent =
      '.vg-video{position:relative;padding:0;border:0;background:#000;cursor:pointer;display:block;overflow:hidden}' +
      '.vg-video img{display:block;width:100%;height:100%;object-fit:cover}' +
      '.vg-video__play{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center}' +
      '.vg-video__play:before{content:"";border-style:solid;border-width:11px 0 11px 18px;border-color:transparent transparent transparent #fff;margin-left:4px}' +
      '.vg-modal{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.vg-modal__frame{position:relative;width:min(960px,100%);aspect-ratio:16/9;background:#000}' +
      '.vg-modal__frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}' +
      '.vg-modal__close{position:absolute;right:0;top:-44px;background:none;border:0;color:#fff;font-size:32px;line-height:1;cursor:pointer;padding:4px 8px}';
    document.head.appendChild(style);
  }

  function closeModal() {
    if (!modal) return;
    modal.remove(); // dropping the iframe also stops the playback
    modal = null;
    document.removeEventListener('keydown', onModalKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onModalKey(event) {
    if (event.key === 'Escape') closeModal();
  }

  function openModal(youtubeId, opener) {
    closeModal();
    injectStyles();
    lastFocus = opener;
    modal = document.createElement('div');
    modal.className = 'vg-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Vídeo');
    var frame = document.createElement('div');
    frame.className = 'vg-modal__frame';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'vg-modal__close';
    close.setAttribute('aria-label', 'Cerrar');
    close.textContent = '×';
    close.addEventListener('click', closeModal);
    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + youtubeId + '?autoplay=1&rel=0';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.setAttribute('allowfullscreen', '');
    iframe.title = 'Vídeo';
    frame.appendChild(close);
    frame.appendChild(iframe);
    modal.appendChild(frame);
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeModal();
    });
    document.body.appendChild(modal);
    document.addEventListener('keydown', onModalKey);
    close.focus();
  }

  function createTile(youtubeId, reference) {
    injectStyles();
    var tile = document.createElement('div');
    tile.setAttribute(TILE_ATTR, youtubeId);
    // Same classes as a photo slide so the theme's grid/slider sizes it like
    // one, minus the state and the image-only modifiers.
    tile.className = (reference ? reference.className : '')
      .split(/\s+/)
      .filter(function (c) { return c && c !== 'is-active' && !/--image$/.test(c); })
      .join(' ');

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'vg-video';
    button.setAttribute('aria-label', 'Reproducir vídeo');
    var photo = reference && reference.querySelector('img');
    var ratio = photo && photo.naturalWidth && photo.naturalHeight
      ? photo.naturalWidth + ' / ' + photo.naturalHeight
      : '1 / 1';
    button.style.aspectRatio = ratio;
    button.style.width = '100%';

    var thumb = document.createElement('img');
    thumb.src = 'https://i.ytimg.com/vi/' + youtubeId + '/hqdefault.jpg';
    thumb.alt = '';
    thumb.loading = 'lazy';
    var play = document.createElement('span');
    play.className = 'vg-video__play';
    button.appendChild(thumb);
    button.appendChild(play);
    button.addEventListener('click', function () { openModal(youtubeId, button); });
    tile.appendChild(button);
    return tile;
  }

  function applyVideos(slides, items) {
    // Tiles from the previous render must go whether or not this variant has videos.
    Array.prototype.slice
      .call(document.querySelectorAll('[' + TILE_ATTR + ']'))
      .forEach(function (tile) { tile.remove(); });

    if (!items.some(function (item) { return item.type === 'video'; })) return;

    var bySlideId = {};
    slides.forEach(function (slide) {
      var id = mediaIdFromSlide(slide);
      if (id) bySlideId[id] = slide;
    });
    var firstImage = items.filter(function (item) { return item.type === 'image'; })[0];
    var reference = (firstImage && bySlideId[String(firstImage.id)]) || slides[0];
    var parent = slides[0].parentElement;
    if (!parent) return;

    items.forEach(function (item, i) {
      if (item.type !== 'video') return;
      // Goes right before the next visible photo; at the end it goes before
      // the hidden slides (applyVisibleImages parked those after the visible ones).
      var anchor = null;
      for (var j = i + 1; j < items.length && !anchor; j++) {
        if (items[j].type === 'image') anchor = bySlideId[String(items[j].id)] || null;
      }
      if (!anchor) {
        anchor = slides.filter(function (s) { return s.hidden; })[0] || null;
      }
      parent.insertBefore(createTile(item.youtubeId, reference), anchor);
    });
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
