(function () {
  'use strict';

  // Pure business rule, no DOM access, so it can be reused/tested independently
  // of how a given theme structures its gallery markup.
  //
  // allImages: [{id, src}, ...] in the product's default order
  // variantGalleryIds: ordered list of media ids configured for the variant via
  //   the admin extension (variant.metafields.app.gallery); may be empty
  // variantLegacyImageId: id of the variant's native Shopify image, or null
  function computeVisibleImages(allImages, variantGalleryIds, variantLegacyImageId) {
    var galleryImages = (variantGalleryIds || [])
      .map(function (id) { return findImage(allImages, id); })
      .filter(Boolean);

    if (galleryImages.length >= 2) {
      // The variant's own "main" image is intuitive for merchants to keep
      // seeing, so it always leads, followed by the configured gallery
      // (without duplicating it if it happens to already be in there).
      var legacy = variantLegacyImageId ? findImage(allImages, variantLegacyImageId) : null;
      if (legacy && !galleryImages.some(function (img) { return img.id === legacy.id; })) {
        return [legacy].concat(galleryImages);
      }
      return galleryImages;
    }

    // 0 or 1 gallery image configured: show every product image, with the
    // single configured (or, failing that, the legacy) image moved first.
    var priorityId = galleryImages.length === 1 ? galleryImages[0].id : variantLegacyImageId;
    var priority = priorityId ? findImage(allImages, priorityId) : null;
    if (!priority) return allImages.slice();
    var rest = allImages.filter(function (img) { return img.id !== priority.id; });
    return [priority].concat(rest);
  }

  function findImage(images, id) {
    for (var i = 0; i < images.length; i++) {
      if (String(images[i].id) === String(id)) return images[i];
    }
    return null;
  }

  var YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

  // Merges the variant's YouTube videos into the visible image list.
  //
  // videos: [{youtubeId, position}] as configured in the app. `position` is the
  //   number of gallery images that go before the video (0 = first), so it
  //   keeps meaning the same thing whether or not the storefront prepends the
  //   variant's native image. Entries without a valid id are dropped; positions
  //   past the end are clamped, never lost.
  //
  // Returns [{type: 'image', id, src} | {type: 'video', youtubeId}].
  function computeGalleryItems(allImages, variantGalleryIds, variantLegacyImageId, videos) {
    var visible = computeVisibleImages(allImages, variantGalleryIds, variantLegacyImageId);
    var items = visible.map(function (img) {
      return { type: 'image', id: img.id, src: img.src };
    });

    var resolvedGallery = (variantGalleryIds || []).filter(function (id) {
      return findImage(allImages, id);
    }).length;
    // With 2+ gallery images the native image may be prepended; positions are
    // counted over the gallery only, so skip that prefix.
    var offset = resolvedGallery >= 2 ? visible.length - resolvedGallery : 0;

    var valid = (videos || [])
      .filter(function (v) {
        return v && typeof v.youtubeId === 'string' && YOUTUBE_ID.test(v.youtubeId);
      })
      .map(function (v, i) {
        var position = Number(v.position);
        return { youtubeId: v.youtubeId, position: isFinite(position) && position > 0 ? Math.floor(position) : 0, order: i };
      })
      .sort(function (a, b) { return a.position - b.position || a.order - b.order; });

    valid.forEach(function (v) {
      // Walk to the boundary after `target` images, then past any videos that
      // already sit there so same-position videos keep their configured order.
      var target = v.position + offset;
      var index = 0;
      var seen = 0;
      while (index < items.length && (seen < target || items[index].type === 'video')) {
        if (items[index].type === 'image') seen++;
        index++;
      }
      items.splice(index, 0, { type: 'video', youtubeId: v.youtubeId });
    });
    return items;
  }

  window.VariantGalleryCore = {
    computeVisibleImages: computeVisibleImages,
    computeGalleryItems: computeGalleryItems,
  };
})();
