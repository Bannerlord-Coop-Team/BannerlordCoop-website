-- Retire the unused community server heartbeat and directory table.
-- RESTRICT prevents removal of any unexpected dependent objects.
DROP FUNCTION public.community_server_heartbeat(
    text, text, text, text, text, text, text, integer, text, text,
    boolean, integer, integer
) RESTRICT;
DROP TABLE public.community_servers RESTRICT;
