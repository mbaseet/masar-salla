declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ASSETS?: Fetcher;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    INITIAL_ADMIN_EMAIL?: string;
    BUCKET?: R2Bucket;
  }
}
