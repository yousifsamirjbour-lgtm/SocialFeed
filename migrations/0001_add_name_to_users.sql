-- Migration: 0001_add_name_to_users.sql
-- Description: Add non-null name column to users with sanitized email local-part backfill

-- Step 1: Add column 'name' as nullable initially
ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(50);

-- Step 2: Backfill existing users:
-- Extract email prefix before '@', pad if under 2 chars, truncate if over 50 chars
UPDATE users 
SET name = CASE
    WHEN LENGTH(SPLIT_PART(email, '@', 1)) < 2 
        THEN RPAD(SPLIT_PART(email, '@', 1), 2, '_')
    WHEN LENGTH(SPLIT_PART(email, '@', 1)) > 50 
        THEN SUBSTRING(SPLIT_PART(email, '@', 1) FROM 1 FOR 50)
    ELSE SPLIT_PART(email, '@', 1)
END
WHERE name IS NULL OR name = '';

-- Step 3: Enforce NOT NULL constraint
ALTER TABLE users ALTER COLUMN name SET NOT NULL;
