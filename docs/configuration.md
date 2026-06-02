# Configuration Guide

This app can target any Contentful content type that can produce a DEV article draft. You configure that mapping in the Contentful app installation screen.

## Required Fields

These fields must exist on the configured content type.

| Installation setting | Purpose | Accepted shape |
| --- | --- | --- |
| `fieldMapping.titleField` | DEV article title | String |
| `fieldMapping.slugField` | Canonical URL path segment | String |
| `fieldMapping.bodyField` | DEV article body | Markdown string |
| `fieldMapping.publishDateField` | Scheduled DEV date source | Date or datetime string |

The body field should already contain Markdown. The app does not convert Contentful Rich Text to Markdown.

## Optional Fields

These fields can be left mapped to empty or non-existent fields, but drafts are better when they are available.

| Installation setting | Purpose | Accepted shape |
| --- | --- | --- |
| `fieldMapping.descriptionField` | DEV article description | String |
| `fieldMapping.tagsField` | DEV tag candidates | String array or comma-separated string |
| `fieldMapping.categoryField` | Additional tag candidate | String |
| `fieldMapping.coverImagePrimaryField` | Preferred DEV cover image | Asset reference or asset-like object |
| `fieldMapping.coverImageFallbackField` | Fallback DEV cover image | Asset reference or asset-like object |

DEV allows at most four tags. The app normalizes tags by lowercasing them, removing non-alphanumeric characters, deduplicating them, and keeping the first four.

## App-Level Settings

| Setting | Required | Description |
| --- | --- | --- |
| `contentTypeId` | Yes | Contentful content type ID where the sidebar app should appear. |
| `siteBlogBaseUrl` | Yes | HTTPS base URL used with the slug to create `canonical_url`. |
| `devtoOrgUsername` | No | DEV organization username. Leave blank for personal-account drafts. |
| `devtoOrgId` | No | Numeric DEV organization ID. Leave blank for personal-account drafts. |
| `forcedFirstTag` | No | Tag inserted before content tags, useful for brand or product tags. |
| `publishDelayDays` | Yes | Number of days added to the Contentful publish date for DEV's front matter date. |
| `appActionId` | Yes | Contentful App Action ID. Defaults to `createDevtoDraft`. |

## Date Behavior

The generated DEV front matter uses this shape:

```yaml
date: 2026-05-26 14:00 UTC
```

Rules:

- The app adds `publishDelayDays` to the Contentful publish date.
- Date-only Contentful values default to `10:00 America/New_York`, then convert to UTC.
- Datetime values without an explicit timezone are treated as `America/New_York` wall-clock time, then converted to UTC.
- Datetime values with `Z`, `UTC`, or a numeric offset preserve that instant and add `publishDelayDays`.

Examples with `publishDelayDays: 7`:

| Contentful value | DEV date |
| --- | --- |
| `2026-05-26` | `2026-06-02 14:00 UTC` |
| `2026-01-26` | `2026-02-02 15:00 UTC` |
| `2026-05-26T15:30:00` | `2026-06-02 19:30 UTC` |
| `2026-05-26T15:30:00Z` | `2026-06-02 15:30 UTC` |

## Canonical URL Behavior

The app builds `canonical_url` from:

```text
siteBlogBaseUrl + slug
```

For example:

```json
{
  "siteBlogBaseUrl": "https://example.com/blog",
  "slug": "my-post"
}
```

generates:

```text
https://example.com/blog/my-post
```

The app also validates that the generated canonical URL stays under the configured base URL. It uses DEV's `canonical_url` field for attribution and does not add an "originally published" line to the article body.

## DEV Organization Behavior

For personal-account drafts:

```json
{
  "devtoOrgUsername": "",
  "devtoOrgId": ""
}
```

For organization drafts:

```json
{
  "devtoOrgUsername": "your-org-slug",
  "devtoOrgId": "1234"
}
```

The app verifies that the current DEV user belongs to the configured organization before creating a draft. Lookup skips organization membership checks so it can still find drafts the current user can access.

## Example Non-Temporal Configuration

For a content type named `article` with fields `headline`, `urlSlug`, `markdown`, `publishedOn`, `summary`, `topics`, and `heroImage`:

```json
{
  "contentTypeId": "article",
  "siteBlogBaseUrl": "https://example.com/blog",
  "devtoOrgUsername": "",
  "devtoOrgId": "",
  "forcedFirstTag": "example",
  "publishDelayDays": 7,
  "appActionId": "createDevtoDraft",
  "fieldMapping": {
    "titleField": "headline",
    "slugField": "urlSlug",
    "bodyField": "markdown",
    "publishDateField": "publishedOn",
    "descriptionField": "summary",
    "tagsField": "topics",
    "categoryField": "",
    "coverImagePrimaryField": "heroImage",
    "coverImageFallbackField": ""
  }
}
```

## App Action Parameters

The Contentful App Action must allow these parameters:

| Parameter | Type | Required |
| --- | --- | --- |
| `mode` | `Symbol` | Yes |
| `devtoApiKey` | `Symbol` | Yes |
| `entryId` | `Symbol` | No |
| `locale` | `Symbol` | No |

If Contentful returns validation errors such as `The property "entryId" is not expected`, the live App Action schema is stale. Update the App Action definition so it matches `contentful-app-manifest.json`; uploading a new frontend bundle alone may not update action parameters.
