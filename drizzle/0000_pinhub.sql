CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX sessions_expiration ON sessions(expires_at);
--> statement-breakpoint
CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX orders_created_at ON orders(created_at DESC);
