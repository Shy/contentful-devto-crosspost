# Install In Contentful

This is the shortest path to get a real test install in a Contentful space.

## 0. Prepare Secrets

Do not commit `.env`. It is only for local dry runs and deploy commands.

You need:

- a Contentful Management API token that can manage custom apps in your organization
- a Contentful space ID
- a test environment ID
- a DEV API key for manual testing

Rotate any token that has been pasted into chat, logs, screenshots, or issue comments.

## 1. Use A Test Environment

Create or clone a non-production environment before installing the app:

```text
devto-crosspost-dev
```

Use an entry that is published and has no unpublished changes when testing draft creation.

## 2. Build The Bundle

```bash
npm install
npm run build
```

This creates:

- `dist/index.html` and frontend assets for Contentful App Hosting
- `dist/functions/createDevtoDraft.js` for the App Action Function

## 3. Create A Custom App Definition

In Contentful:

1. Go to organization settings.
2. Open Apps or Custom apps.
3. Create a custom app, for example `DEV Crosspost`.
4. Enable these locations:
   - App configuration
   - Entry sidebar
5. Enable Contentful App Hosting.
6. Upload the contents of `dist/`.

You can also upload with the CLI after you know the organization ID and app definition ID:

```bash
npm run contentful:upload -- --ci \
  --organization-id YOUR_ORG_ID \
  --definition-id YOUR_APP_DEFINITION_ID \
  --token YOUR_CONTENTFUL_MANAGEMENT_TOKEN
```

## 4. Add The App Action Function

If your plan has Contentful Functions enabled, create an App Action Function with:

```text
Function/App Action ID: createDevtoDraft
Built handler path: functions/createDevtoDraft.js
Source file: functions/createDevtoDraft.ts
Function type: appaction.call
```

The App Action must use the parameter schema from `contentful-app-manifest.json`:

| Parameter | Type | Required |
| --- | --- | --- |
| `mode` | `Symbol` | Yes |
| `devtoApiKey` | `Symbol` | Yes |
| `entryId` | `Symbol` | No |
| `locale` | `Symbol` | No |

If Contentful returns validation errors such as `The property "entryId" is not expected`, update the live App Action schema. Activating a new frontend bundle may not update App Action parameters.

Contentful Functions are available only for eligible Contentful plans. If Functions are unavailable, the frontend will load, but DEV verification and draft creation cannot work until this backend action exists or the function code is adapted to another endpoint.

## 5. Install The App In The Test Environment

Install the app into the test environment. In the app configuration screen, set:

- content type ID
- canonical base URL
- DEV organization username and ID, or blank values for personal drafts
- forced first tag, if desired
- publish delay days
- field mappings

See [configuration.md](configuration.md) for detailed field mapping rules.

Example generic configuration:

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

The config screen validates that required mapped fields exist on the configured content type.

## 6. Test The Flow

1. Open an entry for the configured content type.
2. Confirm the entry is published and has no unpublished changes.
3. Open the DEV Crosspost sidebar app.
4. Paste a DEV API key.
5. Click `Connect DEV`.
6. Click `Create DEV draft`.
7. The app should open the DEV draft editor.

The app blocks:

- wrong content type
- unpublished entry
- entry with unpublished changes
- invalid DEV key
- missing configured DEV org membership
- duplicate canonical URL

## 7. Make It Public Later

Before making a fork or copy public:

- rotate any tokens used during setup
- verify `.env` and `.contentful-app.json` are ignored
- replace Temporal defaults in README examples if they do not apply
- choose and commit a license
