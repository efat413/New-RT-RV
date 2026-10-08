-- ==============================================================
-- Cloudflare D1 Migration 0022: Authoritative D1 Media Storage
-- Target Database: rongdhonu-db (ID: 3276795d-5593-42c0-8e14-947f3ab1172b)
--
-- Ensures media_assets table exists for authoritative D1 image
-- and media storage without external Cloudflare R2 dependencies.
-- ==============================================================

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  data TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets(created_at);
