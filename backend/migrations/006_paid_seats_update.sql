UPDATE programs
SET paid_seats = CASE code
    WHEN '43.02.15' THEN 5
    WHEN '38.02.02' THEN 3
    WHEN '38.02.01' THEN 5
    WHEN '38.02.08' THEN 10
    ELSE paid_seats
END,
updated_at = now()
WHERE code IN ('43.02.15', '38.02.02', '38.02.01', '38.02.08');
