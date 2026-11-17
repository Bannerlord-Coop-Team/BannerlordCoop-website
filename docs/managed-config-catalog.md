# Managed configuration catalog

The shared fixture in `supabase/functions/_shared/managed-config-catalog.json`
is copied from the mod's generated catalog. The generated TypeScript module is
updated with the same bytes for Supabase deployment.

After a mod catalog release, copy the JSON and regenerate the TypeScript module,
then run `npm run check:managed-config-catalog` with the mod catalog URL. The
command compares the source commit and content digest and reports drift before
the website is released. The parser and editor iterate the fixture, so an added
option is refused until this fixture and its pinned digest test are updated.
