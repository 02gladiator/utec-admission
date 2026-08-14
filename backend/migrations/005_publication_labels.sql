CREATE TABLE IF NOT EXISTS publication_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    budget_label TEXT NOT NULL DEFAULT 'В пределах бюджетных мест',
    paid_label TEXT NOT NULL DEFAULT 'Рекомендован к зачислению на платной основе',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO publication_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
