ALTER TABLE programs
    ADD COLUMN IF NOT EXISTS public_original_only BOOLEAN NOT NULL DEFAULT false;
