-- Store the raw token so admin can always retrieve share URLs.
-- The hash is still used for lookup/verification from the public side.
ALTER TABLE links ADD COLUMN token TEXT;
