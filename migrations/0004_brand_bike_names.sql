-- Use the full brand name, Dazzling E-Bikes, in product names.
UPDATE bikes SET name = 'Dazzling E-Bikes ' || substr(name, 10)
WHERE name LIKE 'Dazzling %' AND name NOT LIKE 'Dazzling E-Bikes %';
