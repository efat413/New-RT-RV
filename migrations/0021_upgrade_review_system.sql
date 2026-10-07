-- ==============================================================
-- Cloudflare D1 Migration 0021: Upgrade Review System
-- Target Database: rongdhonu-db (ID: 3276795d-5593-42c0-8e14-947f3ab1172b)
--
-- Safe & idempotent schema update:
-- 1. Adds status, images_json, updated_at columns to reviews table
-- 2. Sets default status = 'approved' for all existing reviews
-- 3. Creates performance and moderation indexes
-- ==============================================================

-- 1. Add moderation and media columns to reviews table
ALTER TABLE reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE reviews ADD COLUMN images_json TEXT DEFAULT '[]';
ALTER TABLE reviews ADD COLUMN updated_at TEXT;

-- 2. Create indexes for public queries, moderation status, and sorting
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_product_status ON reviews(product_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);

-- 3. Sanitize and backfill existing legacy reviews
UPDATE reviews SET status = 'approved' WHERE status IS NULL OR status = '';
UPDATE reviews SET images_json = '[]' WHERE images_json IS NULL;
UPDATE reviews SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;
