export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  APP_ENV?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  NOTION_TOKEN?: string;
  NOTION_TASKS_DATA_SOURCE_ID?: string;
  NOTION_PROJECTS_DATA_SOURCE_ID?: string;
  NOTION_EVENTS_DATA_SOURCE_ID?: string;
  NOTION_ROI_DATA_SOURCE_ID?: string;
  NOTION_STOCK_DATA_SOURCE_ID?: string;
  DEV_AUTH_BYPASS?: string;
}
