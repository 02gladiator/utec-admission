CREATE INDEX IF NOT EXISTS applications_program_benefit_score_idx
    ON applications (program_id, benefit DESC, average_score DESC);

CREATE INDEX IF NOT EXISTS applications_program_original_benefit_score_idx
    ON applications (program_id, benefit DESC, average_score DESC)
    WHERE original_given;
