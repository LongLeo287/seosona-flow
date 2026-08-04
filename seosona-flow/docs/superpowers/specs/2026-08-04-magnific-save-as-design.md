# Magnific Save-As Context Design

## Goal

Make the existing PNG, JPEG, and WEBP right-click save actions available on Magnific search cards and asset detail previews when Chrome classifies the clicked overlay as a page context instead of an image or link context.

## Scope

- Support `https://magnific.com/*` and `https://*.magnific.com/*`.
- Support both search pages and stock-asset detail pages.
- Save only the highest-resolution image URL already available to the browser through the existing resolver.
- Preserve the existing PNG, JPEG, and WEBP conversion choices.
- Do not bypass account, license, premium-download, token, or paywall controls.

## Design

Keep the existing global image/link Save-As submenu unchanged. Add a second Magnific-only submenu with the same visible label and formats, but register it only for Chrome's `page` context. The existing parent menu already appears for page contexts. The click handler continues to resolve a format through `formatFromMenuId()` and then uses the existing cursor-image resolver and conversion/download pipeline.

This avoids showing Save-As on empty page areas across every website while handling Magnific overlays. It adds no Chrome permission, host permission, network endpoint, dependency, or new download implementation.

## Error Handling

If the content script cannot resolve an image under the cursor, retain the existing Vietnamese notification asking the user to reload and retry. If conversion fails because the CDN blocks extension fetches, retain the existing direct-download fallback, which saves the browser-accessible source format.

## Tests

- Existing global image/link menu tests remain unchanged.
- Add a test proving Magnific page-context Save-As items exist only on Magnific URL patterns.
- Add a test proving Magnific menu IDs map to the same PNG/JPEG/WEBP format contracts.
- Run the context-menu unit test, syntax checks, product-independence test, and project doctor.

