-- 202608260004 wrote the installer_pins server-file check as '...\\.7z$' inside a standard-conforming
-- string literal, so the regex demanded a literal backslash before ".7z" and rejected every real server
-- archive name: no create-build pin could ever be stored. Re-add the check with a single escape.
begin;

alter table nightly_gateway.installer_pins
    drop constraint installer_pins_server_file,
    add constraint installer_pins_server_file
        check (server_file_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$');

commit;
