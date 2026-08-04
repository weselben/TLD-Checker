export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  VOTE_AGG: DurableObjectNamespace;
  VOTE_TOKEN_SECRET: string;
}
