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

  window.VariantGalleryCore = { computeVisibleImages: computeVisibleImages };
})();
