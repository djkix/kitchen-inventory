-- Repères nutritionnels Open Food Facts (EF-30).
ALTER TABLE "Product" ADD COLUMN "nutriscoreGrade" TEXT;
ALTER TABLE "Product" ADD COLUMN "nutrientLevels" JSONB;
