-- Normalisation légère des accents pour la recherche tolérante (EF-11), sans
-- dépendre de l'extension « unaccent » dont la présence n'est pas garantie.
CREATE OR REPLACE FUNCTION unaccent_lite(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(translate($1,
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŒœÆæ',
    'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyoeoeaeae'))
$$;
