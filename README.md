# Contentful To DEV Crosspost

A Contentful sidebar app for creating DEV drafts from published Contentful entries.

The app was built for Temporal's blog workflow, but the content type, field mapping, canonical URL base, first tag, publish delay, and DEV organization target are installation parameters. A different Contentful space can use it without changing code as long as its content model can provide the required fields.

## What It Does

- Shows one primary sidebar action on a configured Contentful content type.
- Requires the entry to be published and unchanged since publish.
- Stores each editor's DEV API key in browser local storage when they opt in.
- Creates DEV drafts only, never live posts.
- Posts under a configured DEV organization when the user's DEV account has access.
- Detects duplicates by canonical URL in the current user's DEV articles and published organization articles.
- Generates DEV front matter, including `canonical_url`, tags, cover image, and a scheduled `date`.
- Defaults date-only Contentful publish dates to 10:00 America/New_York, then converts to `YYYY-MM-DD HH:mm UTC`.
- Normalizes Markdown for DEV, including protocol-relative Contentful image URLs, raw HTML `<img>` tags, and simple HTML callout tables.

## Required Content Model Shape

The configured Contentful content type must provide these values:

| App field | Expected value | Example Contentful field |
| --- | --- | --- |
| Title | Article title string | `title` |
| Slug | URL path segment used with the canonical base URL | `slug` |
| Body | Markdown body content | `content` |
| Publish date | Date or datetime used for DEV scheduled date | `publishDate` |

Optional mappings improve the DEV draft:

| App field | Expected value | Example Contentful field |
| --- | --- | --- |
| Description | Short string for DEV description | `metaDescription` |
| Tags | Array or comma-separated string | `tags` |
| Category | String used as an additional tag candidate | `category` |
| Primary cover image | Contentful asset reference or asset-like object | `socialCard` |
| Fallback cover image | Contentful asset reference or asset-like object | `featureImage` |

See [docs/configuration.md](docs/configuration.md) for the full mapping guide.

## Architecture

The production shape is:

1. Contentful-hosted app frontend in the entry sidebar.
2. Contentful App Action Function named `createDevtoDraft`.
3. Per-user DEV API key sent only to the App Action Function for `verify`, `lookupDraft`, or `createDraft`.
4. For lookup/create, the sidebar sends only the Contentful entry ID and locale. The Function fetches the entry with Contentful CMA, validates content type and publish state, builds the DEV payload, verifies the DEV key and organization membership, checks duplicates, enforces `published: false`, and creates the draft.

Contentful Functions are available only on eligible Contentful plans. If Functions are unavailable, the backend logic in `functions/` can be adapted to a small hosted endpoint.

## Setup

```bash
npm install
npm run typecheck
npm run build
```

Copy `.env.example` to `.env` only for local dry runs. Do not commit `.env`.

## Install In Contentful

Follow [docs/install-contentful.md](docs/install-contentful.md).

The short version:

1. Build with `npm run build`.
2. Create a custom Contentful app with App Configuration and Entry Sidebar locations.
3. Upload `dist/` with Contentful App Hosting.
4. Create or update the `createDevtoDraft` App Action Function from `contentful-app-manifest.json`.
5. Install the app into a test environment.
6. Configure content type ID, field mappings, canonical base URL, and optional DEV organization.

## Local Dry Run

The included dry-run helper is useful for this repo's default `blogPost` GraphQL model. If your content model uses different GraphQL field names, either adapt `scripts/dev-payload.ts` or test through the installed Contentful app, which uses the configurable field mapping.

Generate the DEV markdown for the most recent default-model `blogPost`:

```bash
npm run dev:payload
```

Generate by slug:

```bash
npm run dev:payload -- --slug my-post-slug
```

Generate by Contentful entry ID:

```bash
npm run dev:payload -- --entry ENTRY_ID
```

The script writes generated markdown to `tmp/{slug}.devto.md` and prints a payload summary.

## Default App Configuration

These defaults match Temporal's blog content model. Change them during Contentful app installation for other spaces.

```json
{
  "contentTypeId": "blogPost",
  "siteBlogBaseUrl": "https://temporal.io/blog",
  "devtoOrgUsername": "temporalio",
  "devtoOrgId": "3146",
  "forcedFirstTag": "temporal",
  "publishDelayDays": 7,
  "appActionId": "createDevtoDraft",
  "fieldMapping": {
    "titleField": "title",
    "slugField": "slug",
    "bodyField": "content",
    "publishDateField": "publishDate",
    "descriptionField": "metaDescription",
    "tagsField": "tags",
    "categoryField": "category",
    "coverImagePrimaryField": "socialCard",
    "coverImageFallbackField": "featureImage"
  }
}
```

## DEV API Notes

DEV/Forem article creation uses `POST /api/articles` with an `api-key` header. The Function sends:

- `published: false`
- `title`
- `body_markdown`
- `canonical_url`
- `main_image`
- `description`
- comma-separated `tags`
- `organization_id` when configured

The generated `body_markdown` includes DEV front matter for review in DEV's editor. The app relies on `canonical_url` for original-source attribution and does not add an "originally published" paragraph to the body.

## Scripts

```bash
npm run dev
npm run build
npm run build:functions
npm run typecheck
npm run dev:payload
```

## License

MIT. See [LICENSE](LICENSE).
