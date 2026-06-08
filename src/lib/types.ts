export type FieldMapping = {
  titleField: string;
  slugField: string;
  bodyField: string;
  publishDateField: string;
  descriptionField: string;
  tagsField: string;
  categoryField: string;
  coverImagePrimaryField: string;
  coverImageFallbackField: string;
};

export type AppConfig = {
  contentTypeId: string;
  siteBlogBaseUrl: string;
  devtoOrgUsername: string;
  devtoOrgId: string;
  forcedFirstTag: string;
  publishDelayDays: number;
  sidebarPosition: number;
  appActionId: string;
  fieldMapping: FieldMapping;
};

export type ContentfulPostInput = {
  title: string;
  slug: string;
  bodyMarkdown: string;
  publishDate: string;
  description?: string;
  tags?: string[];
  category?: string;
  coverImagePrimaryUrl?: string;
  coverImageFallbackUrl?: string;
};

export type DevtoArticlePayload = {
  title: string;
  body_markdown: string;
  published: false;
  main_image?: string;
  canonical_url: string;
  description: string;
  tags: string;
  organization_id?: number;
};

export type BuildPayloadResult = {
  payload: DevtoArticlePayload;
  canonicalUrl: string;
  defaultDate: string;
  tags: string[];
  warnings: string[];
};

export type DevtoUser = {
  id?: number;
  user_id?: number;
  username: string;
  name?: string;
};

export type DevtoArticleSummary = {
  id?: number;
  title?: string;
  slug?: string;
  path?: string;
  url?: string;
  canonical_url?: string | null;
  published?: boolean;
};

export type DevtoActionRequest =
  | {
      mode: 'verify';
      devtoApiKey: string;
    }
  | {
      mode: 'lookupDraft';
      devtoApiKey: string;
      entryId: string;
      locale?: string;
    }
  | {
      mode: 'createDraft';
      devtoApiKey: string;
      entryId: string;
      locale?: string;
    };

export type DevtoActionResponse = {
  ok: boolean;
  mode: 'verify' | 'lookupDraft' | 'createDraft';
  status: 'verified' | 'created' | 'duplicate' | 'notFound' | 'error';
  user?: DevtoUser;
  org?: {
    username: string;
    verified: boolean;
  };
  article?: DevtoArticleSummary;
  editUrl?: string;
  warnings?: string[];
  message?: string;
  raw?: unknown;
};
