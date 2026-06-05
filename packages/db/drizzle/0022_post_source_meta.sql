-- Structured source metadata for posts that originate outside Counter.
--
-- Nullable; only set when a post was created via an integration (e.g. the
-- "Share to Counter" Discord command). Clients that understand it render a
-- rich card; older clients and the plain API fall back to the text body.

ALTER TABLE "posts" ADD COLUMN "source_meta" jsonb;
