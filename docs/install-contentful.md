# Install In Contentful

This is the shortest path to get a real test install.

## 0. Rotate The Local CMA Token

Rotate the Contentful Management token currently in `.env` before using this app against real workflows. `.env` is ignored, but that token should be treated as exposed from earlier local debugging output.

## 1. Use A Test Environment

In Contentful, create or clone a non-production environment, for example:

```text
devto-crosspost-dev
```

Install and test the app there first.

## 2. Build The Frontend Bundle

```bash
npm install
npm run build
```

This creates `dist/`, including the Contentful-hosted frontend bundle and `dist/functions/createDevtoDraft.js`. Contentful app hosting expects the uploaded bundle root to contain `index.html`.

## 3. Create A Custom App Definition

In Contentful:

1. Go to organization settings.
2. Open Apps or Custom apps.
3. Create a new custom app, for example `DEV Crosspost`.
4. Enable these locations:
   - App configuration
   - Entry sidebar
5. Enable Contentful App Hosting for the frontend.
6. Upload the contents of `dist/`.

You can also use the CLI helper after you know the organization ID and app definition ID:

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

The frontend expects the installed app action ID to match `createDevtoDraft` unless you change the app installation parameter `appActionId`. The Function uses the app installation parameters as its source of truth and fetches the Contentful entry server-side before creating a DEV draft.

Contentful Functions are available only for eligible Premium/Partner accounts. If Functions are not enabled, the frontend will load, but DEV verification/draft creation cannot work until this backend action exists or the function code is adapted to a third-party endpoint.

## 5. Install The App In The Test Environment

Install the app into your test environment and keep the default configuration unless you need to change it:

```json
{
  "contentTypeId": "blogPost",
  "siteBlogBaseUrl": "https://temporal.io/blog",
  "devtoOrgUsername": "temporalio",
  "devtoOrgId": "3146",
  "forcedFirstTag": "temporal",
  "publishDelayDays": 7,
  "appActionId": "createDevtoDraft"
}
```

The config screen validates that required fields exist on `blogPost`.

## 6. Test The Flow

1. Open a `blogPost` entry in the test environment.
2. Use a post that is published and has no unpublished changes.
3. Open the DEV Crosspost sidebar app.
4. Paste your DEV API key.
5. Click Connect DEV.
6. Click Create DEV draft.
7. The app should open the DEV draft/editor.

The app will block:

- wrong content type
- unpublished entry
- entry with unpublished changes
- invalid DEV key
- missing Temporal org membership
- duplicate canonical URL
