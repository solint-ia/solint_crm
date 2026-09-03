-- A classificação geral da empresa só é inequívoca quando existe um
-- único contato de sócio. Com dois ou mais telefones, cada classificação
-- continua preservada dentro de `socios[].phones[]`.
UPDATE "Contact" AS contato
SET "classificacao" = NULL
WHERE contato."origem" = 'csv'
  AND contato."classificacao" IS NOT NULL
  AND jsonb_typeof(contato."socios") = 'array'
  AND (
    SELECT COALESCE(
      SUM(
        CASE
          WHEN jsonb_typeof(socio -> 'phones') = 'array'
            THEN jsonb_array_length(socio -> 'phones')
          ELSE 0
        END
      ),
      0
    )
    FROM jsonb_array_elements(contato."socios") AS socios(socio)
  ) > 1;
