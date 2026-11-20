CREATE TABLE favorite_categories (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50 AND name = trim(name)),
  name_key TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 50),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (user_id, name_key),
  UNIQUE (user_id, id)
) STRICT;
CREATE INDEX favorite_categories_user_order ON favorite_categories(user_id, sort_order, created_at, id);

ALTER TABLE favorites ADD COLUMN category_id TEXT REFERENCES favorite_categories(id) ON DELETE SET NULL;
CREATE INDEX favorites_user_category ON favorites(user_id, category_id);

CREATE TRIGGER favorites_category_owner_insert BEFORE INSERT ON favorites
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM favorite_categories WHERE id = NEW.category_id AND user_id = NEW.user_id
)
BEGIN SELECT RAISE(ABORT, 'category_owner_mismatch'); END;

CREATE TRIGGER favorites_category_owner_update BEFORE UPDATE OF user_id, category_id ON favorites
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM favorite_categories WHERE id = NEW.category_id AND user_id = NEW.user_id
)
BEGIN SELECT RAISE(ABORT, 'category_owner_mismatch'); END;
