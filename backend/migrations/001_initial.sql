CREATE TABLE IF NOT EXISTS programs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    budget_seats INTEGER NOT NULL DEFAULT 0 CHECK (budget_seats >= 0),
    paid_seats INTEGER NOT NULL DEFAULT 0 CHECK (paid_seats >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applicants (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    snils TEXT NOT NULL UNIQUE CHECK (snils ~ '^[0-9]{3}-[0-9]{3}-[0-9]{3} [0-9]{2}$'),
    full_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    applicant_id BIGINT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
    program_id BIGINT NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
    average_score NUMERIC(5,3) NOT NULL CHECK (average_score >= 0 AND average_score <= 5),
    original_given BOOLEAN NOT NULL DEFAULT false,
    benefit BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (applicant_id, program_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS applications_one_original_per_applicant
    ON applications (applicant_id) WHERE original_given;

CREATE OR REPLACE FUNCTION limit_applicant_applications()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM 1 FROM applicants WHERE id = NEW.applicant_id FOR UPDATE;
    IF (SELECT count(*) FROM applications WHERE applicant_id = NEW.applicant_id) >= 3 THEN
        RAISE EXCEPTION 'An applicant may have at most three applications';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS applications_limit_per_applicant ON applications;
CREATE TRIGGER applications_limit_per_applicant
    BEFORE INSERT ON applications
    FOR EACH ROW EXECUTE FUNCTION limit_applicant_applications();

CREATE TABLE IF NOT EXISTS publication_versions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    is_current BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS one_current_publication
    ON publication_versions (is_current) WHERE is_current;

CREATE TABLE IF NOT EXISTS published_applications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version_id BIGINT NOT NULL REFERENCES publication_versions(id) ON DELETE CASCADE,
    program_code TEXT NOT NULL,
    full_name TEXT NOT NULL,
    average_score NUMERIC(5,3) NOT NULL,
    original_given BOOLEAN NOT NULL,
    benefit BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS published_applications_version_program
    ON published_applications (version_id, program_code, average_score DESC);
