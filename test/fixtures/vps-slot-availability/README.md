# VPS slot availability fixture v1

`v1.json` is a synthetic, identifier-free reconstruction of the 2026-11-11
03:24–03:34 UTC storage-sampling incident, created on 2026-11-11. It is not a
production response capture. No customer names, accounts or addresses are retained.

SHA256: `0198b889dd0bbb61d03d04aa75ed17b4286d6cff8ce9e382144ffdb62070d695`.

Producer base: ControlPlane `55a68e8d2a7ef270fe68673ff2cf9d643a3fa5eb`.
Consumer base: Website `0f073a4c`.
Both PR descriptions record the exact tested heads and paired PR links, avoiding
a self-referential commit hash in this fixture. Keep this file and JSON identical
in both repositories and retain v1 for older consumers.

Producer validator: `npm test -- test/hosting-vps-slot-availability.test.ts`.
API validator: `npm run test:hosting:api -- test/hosting-api/vps-inventory.test.ts`.
Consumer validator (Website): `npm run test:components -- src/app/components/admin/VpsHostInventory.component.test.tsx src/app/components/admin/RelocateView.component.test.tsx`.
Both validators execute their real projection/parser paths and reject unknown
reasons, impossible proof counts, excess counts and unknown fields.

Manual producer replay: `node --import tsx scripts/prove-vps-slot-availability.mjs`.
It executes the real HTTP/IPC/SQL paths with isolated PGlite and synthetic runners,
retaining sanitized output at `coverage/vps-slot-availability/replay.json`.
The Website validator decodes the shared response shape with its actual decoder
and renders its inventory. These are offline/API synthetic checks; not proven:
production sampling recovery, dedicated-server runtime, public UDP or gameplay.
