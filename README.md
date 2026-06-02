# Contentful to DEV Crosspost

A Contentful sidebar app for creating a DEV draft from a published `blogPost` entry.

The app is designed for Temporal's blog workflow, but the content type, field mapping, canonical base URL, forced tag, publish-delay date, and DEV organization target are installation parameters so it can be reused elsewhere.

## What It Does

- Shows one primary sidebar action for a configured Contentful content type.
- Requires the Contentful entry to be published and unchanged since publish.
- Optionally stores each editor's DEV API key in browser local storage, scoped by Contentful space/environment/app and expiring after 30 days.
- Creates DEV drafts only, never live posts.
- Posts under the configured DEV organization when the user has access.
- Detects duplicates by canonical URL in the current user's DEV articles and published organization articles.
- Generates DEV front matter with a default `date` of Contentful `publishDate + 7 days` in `YYYY-MM-DD HH:mm UTC` format.
- Uses DEV's `canonical_url` field for original-source attribution.
- Normalizes markdown for DEV, including protocol-relative Contentful image URLs, raw HTML `<img>` tags, and simple HTML callout tables.

## Architecture

The preferred production shape is:

1. Contentful-hosted app frontend in the entry sidebar.
2. Contentful App Action Function named `createDevtoDraft`.
3. DEV API key stays per-user and is sent to the App Action Function only for `verify`, `lookupDraft`, or `createDraft` calls.
4. For lookup/create, the sidebar sends only the Contentful entry ID and locale. The Function fetches the entry with Contentful CMA, validates content type and publish state, generates the DEV payload, verifies the DEV key and organization membership, checks duplicates, enforces `published: false`, and creates the draft.

Contentful Functions are available only on eligible Contentful plans. If Functions are unavailable, the same backend logic in `functions/` can be adapted to a small Vercel/Netlify/Cloudflare endpoint.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` for local dry runs. Do not commit `.env`.

Required for dry runs:

```env
CONTENTFUL_SPACE_ID=
CONTENTFUL_ENVIRONMENT_ID=master
CONTENTFUL_PREVIEW_TOKEN=
SITE_BLOG_BASE_URL=https://temporal.io/blog
DEVTO_ORG_USERNAME=temporalio
DEVTO_ORG_ID=3146
```

## Local Dry Run

Generate the DEV markdown for the most recent `blogPost`:

```bash
npm run dev:payload
```

Generate by slug:

```bash
npm run dev:payload -- --slug actor-workflow-player-sessions
```

Generate by Contentful entry ID:

```bash
npm run dev:payload -- --entry ENTRY_ID
```

The script writes generated markdown to `tmp/{slug}.devto.md` and prints a redacted payload summary.

## App Configuration Defaults

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

The generated `body_markdown` also includes front matter for review inside DEV's editor.
When Contentful `publishDate` is date-only, the generated DEV date defaults to 10:00 America/New_York and is converted to UTC, for example `date: 2026-05-26 14:00 UTC`.

## Scripts

```bash
npm run dev
npm run build
npm run build:functions
npm run typecheck
npm run dev:payload
```
