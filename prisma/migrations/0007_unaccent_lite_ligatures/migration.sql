-- `translate()` ne peut remplacer un caractère que par un seul autre : les
-- ligatures Œ/œ et Æ/æ, qui valent deux lettres, se retrouvaient donc
-- tronquées à une seule lettre (ex. « Œufs » -> « oufs » au lieu de
-- « oeufs »), ce qui empêchait une recherche tapée sans accent ni ligature
-- (EF-11) de retrouver ces articles. On les développe avant `translate` avec
-- `replace`, et on les retire des deux tables de correspondance.
CREATE OR REPLACE FUNCTION unaccent_lite(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(translate(
    replace(replace(replace(replace($1, 'Œ', 'OE'), 'œ', 'oe'), 'Æ', 'AE'), 'æ', 'ae'),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy'))
$$;
