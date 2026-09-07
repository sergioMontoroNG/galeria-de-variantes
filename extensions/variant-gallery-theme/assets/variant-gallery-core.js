(function () {
  'use strict';

  // Pure business rule, no DOM access, so it can be reused/tested independently
  // of how a given theme structures its gallery markup.
  //
  // allImages: [{id, src}, ...] in the product's default order
  // variantGalleryIds: ordered list of media ids configured for the variant via
  //   the admin extension (product_variant.metafields.app.gallery); may be empty
  // variantLegacyImageId: id of the variant's native Shopify image, or null
  function computeVisibleImages(allImages, variantGalleryIds, variantLegacyImageId) {
    var ids =
      variantGalleryIds && variantGalleryIds.length
        ? variantGalleryIds.slice()
        : variantLegacyImageId
        ? [variantLegacyImageId]
        : [];

    if (ids.length >= 2) {
      return ids.map(function (id) { return findImage(allImages, id); }).filter(Boolean);
    }

    if (ids.length === 1) {
      var priority = findImage(allImages, ids[0]);
      if (!priority) return allImages.slice();
      var rest = allImages.filter(function (img) { return img.id !== priority.id; });
      return [priority].concat(rest);
    }

    return allImages.slice();
  }

  function findImage(images, id) {
    for (var i = 0; i < images.length; i++) {
      if (String(images[i].id) === String(id)) return images[i];
    }
    return null;
  }

  window.VariantGalleryCore = { computeVisibleImages: computeVisibleImages };
})();
