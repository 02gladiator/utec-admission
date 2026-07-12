CREATE INDEX IF NOT EXISTS applications_program_score_idx
    ON applications (program_id, average_score DESC);

CREATE INDEX IF NOT EXISTS applications_program_original_score_idx
    ON applications (program_id, average_score DESC)
    WHERE original_given;
