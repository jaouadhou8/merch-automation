# Merch on Demand Bulk Uploader

A dependency-free Chrome Manifest V3 extension that imports a CSV, matches design images by filename, and prepares Merch on Demand listing tabs. Version 1.1.1 opens a **regular extension tab** when you click its toolbar icon, so switching to Amazon does not close the controller or interrupt the queue.

By default it uploads the image and fills the listing text, then leaves the Amazon tab open for manual review and publishing. Optional automatic submission clicks Publish using Amazon's current defaults; **Submitted · unverified means a click was sent, not that Amazon accepted or published the listing**. Tabs remain open in both modes.

## Install in Chrome

1. Download/extract the extension archive, or download/clone this repository to your computer. Keep the folder containing `manifest.json`, `core.js`, `popup.html`, the other JS/CSS files, and `icons/` together.
2. Open `chrome://extensions` in desktop Chrome 102 or later (a current stable version is recommended).
3. Turn on **Developer mode**, click **Load unpacked**, and select the folder containing `manifest.json`.
4. Confirm **Merch on Demand Bulk Uploader 1.1.1** appears without an Errors warning. All three PNG icons are included (16, 48 and 128 pixels).
5. Use Chrome's Extensions menu to pin the icon, then click it. The uploader opens in a tab. Clicking the icon again focuses that tab instead of creating another controller.
6. After changing source files, click **Reload** on the extension card and reopen the uploader. Refresh existing Amazon tabs before another test so they do not retain the previous content script.

No npm installation, build, API key, or password configuration is needed. Sign into `https://merch.amazon.com` in the same Chrome profile. A managed Chrome installation can prohibit unpacked extensions; an administrator must allow them, or use an unmanaged development profile where your organization's rules permit it.

## CSV and images

Use the included `sample-listings.csv` as a template:

```csv
Title,Brand name,Bullet point 1,Bullet point 2,Description,Design filename
Cat Programmer Shirt,My Brand,Gift for developers,Comfortable design,"Description with a comma, and details",cat_programmer.png
```

All six columns are required. Title, brand and design filename must be nonempty; bullet points and description may be empty. Quoted commas, doubled quotes, multiline text, UTF-8 BOM, CRLF and LF are supported. Duplicate/ambiguous headers, malformed quotes and incorrect column counts produce an error rather than skipping listings. Common header aliases such as `Brand`, `Bullet1`, `Bullet2` and `Filename` also work.

Filenames must match **exactly, including case**. Missing images and duplicate basenames (even in different subfolders) block preparation; there is no fallback that could attach the wrong design. Extra images are allowed. PNG and JPEG contents are checked and decoded locally; Chrome file pickers that omit a MIME type are supported. Limits are 2 MiB per CSV and 25 MiB per image to bound import/transfer memory. These limits do not guarantee Amazon accepts an image. Follow Amazon's current artwork, transparency, size and product requirements. The small icons and test JPEG are test assets, not listing artwork.

## First Chrome test

1. Sign into Merch on Demand and confirm you can manually open a new design page.
2. Create a CSV with **one listing** and your own valid artwork. You can also use the sample after providing suitable images named `cat_programmer.png`, `retro_mountain.png` and `coffee_loading.png`.
3. Import the CSV. Check the listing count, choose the images or their folder, and confirm every filename matches. Use **Replace images** if needed.
4. Continue to review. Keep **Concurrent tabs = 1**, the default 1500 ms action delay, and **Automatically click Publish unchecked**.
5. Click **Prepare Listings** and keep the uploader tab open. Switch to the created Amazon tab, or click **View** beside the queue item. A **Review** result means the image-upload event was dispatched and the five text fields retained the expected values locally.
6. In Amazon, verify the actual artwork and every text field. Choose products, colors, sizes, prices and marketplaces yourself. The old product-type dropdown was removed because it never selected a product. Fix any validation issues and publish manually only when you intend to submit that listing.
7. Check Amazon's design dashboard to confirm the actual outcome. The extension does not verify artwork-processing completion, server acceptance, moderation or publication.
8. Test a missing image, a corrupt image, an invalid CSV, and a CSV description with quoted commas/newlines. Imports should either show a clear error or preserve the exact text. A missing filename must never select a different image.
9. Test a small multiple-listing queue and **Stop**. Stop requests cancellation of active fills and prevents scheduling more rows. It cannot undo uploads or Publish clicks already sent. A tab still loading can take up to the 30-second load timeout to settle. **Continue Pending Listings** processes only rows that were never started; completed, failed and stopped rows are not silently repeated. Review retained tabs before retrying failed/stopped listings in a fresh CSV/session.

Closing/reloading the controller loses its in-memory CSV, images and queue state. An active queue asks before unloading and requests cancellation, but delivery during page closure is not guaranteed. Do not close it until work settles. Chrome may throttle background tabs; raise the delay or reduce concurrency if the live page is slow.

Automatic submission is optional: enable the checkbox only after manually testing the current Amazon defaults and confirming you intend to submit the selected listings. The controller asks for confirmation before running this mode, and leaves tabs open to verify the results. No automatic message retry occurs after a disconnect because an upload or submission might already have happened.

## Troubleshooting

- **Extension Errors:** inspect the Errors button on `chrome://extensions`. Check that the entire extracted folder was loaded and reload after edits.
- **Uploader errors:** open DevTools on the uploader tab (Ctrl+Shift+J / Cmd+Option+J). The queue log distinguishes prepared, submitted-unverified, failed, stopped and pending rows.
- **Amazon tab errors:** inspect the retained tab and its DevTools Console. Login redirects, changed selectors, missing/read-only fields, exceeded field lengths, discarded values and disabled Publish controls cause a failure instead of reported publication success.
- **Disconnected message channel:** inspect the Amazon tab first. Do not blindly restart a listing that may have been submitted.
- **Artwork not accepted:** check Amazon's own errors and current artwork rules. Synthetic upload/input events cannot guarantee compatibility with Amazon's live editor.

## Development and automated checks

There are no third-party JavaScript dependencies. Use Node.js 22+ (validated with 24.19.0). The browser suite also requires Chromium on PATH; set `CHROMIUM_PATH` to its executable if needed.

```sh
cd merch-automation
node --check core.js
node --check popup.js
node --check content.js
node --check background.js
node --test tests/core.test.cjs tests/background.test.cjs tests/browser.test.mjs
```

The browser suite starts and cleans up its own loopback HTTP server and temporary headless Chromium profile. It uses `--no-sandbox` for the isolated cloud runner, not as a recommendation for your everyday Chrome profile. It never visits Amazon or publishes a real listing. For parser/asset/background checks without Chromium, run:

```sh
node --test tests/core.test.cjs tests/background.test.cjs
```

For a standalone UI preview, run `python3 -m http.server 8765 --bind 127.0.0.1` from this folder and navigate locally to `/popup.html`. Imports and matching work; preparation requires the installed extension's Chrome APIs.

## Verification and limits

Automated checks cover CSV edge cases, icon existence/dimensions, persistent-controller launch logic with Chrome API mocks, real browser imports/matching/queue display, bounded concurrency, stop/continue, tab readiness/timeouts, non-retry after disconnect, content-script reinjection, native input events, JPEG MIME preservation, missing/disabled/oversized/discarded fields, cancellation and manual/automatic submission behavior on a local DOM fixture.

**Not verified in the cloud:** native unpacked-extension installation and Chrome API integration (managed Chromium policy blocks extension installation); Amazon's current authenticated DOM and Angular behavior; actual image processing; product/price/marketplace configuration; account quotas; server acceptance or publication. Local fixtures do not establish those behaviors. Complete the one-listing Chrome test above before bulk use.

## Listing-field correction in 1.1.1

The listing editor can render after the brand field, and its title/bullet/description controls may use different IDs. The extension now waits up to 60 seconds for the complete editor, supports English and unlocalized Angular control names, associated labels, ARIA labels, component wrappers and open shadow roots, and excludes hidden copies and explicitly non-English field names. Ambiguous matches fail rather than filling a different editor. Input events now include their input type and cross shadow-root boundaries. On failure, the queue log includes visible field identifiers (never field values) to help diagnose further Amazon changes.

To install this correction, extract the new ZIP into your extension folder, click **Reload** in `chrome://extensions`, confirm version **1.1.1**, and close/reopen the uploader. Refresh or close any Amazon tabs from the previous attempt so they cannot retain an older injected script. Test one listing with automatic Publish unchecked. If a field remains missing, copy the queue error and the visible-field-identifiers line for diagnosis.
