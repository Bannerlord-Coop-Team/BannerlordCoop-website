# Limitless contract v1

SHA-256 of v1.json: `64ccfa0aa9c6ac8269b94c463d4b4b85be22b3af2dfa40a191eab63d842ab494`.

Identical fixture in ControlPlane and Website. Synthetic, sanitized CP serializer outputs, not a production capture. The real CP direct-configuration serializer and mods schema validate it in `test/hosting-limitless-contract.test.ts`; the website's real configuration and mods parsers validate it in `src/app/lib/hosting/limitless-contract.component.test.tsx`. Both reject a malformed catalog revision and battleSize 12001. Module enablement policy is checked independently of structural parsing.

Source for the ceiling: Andrew-supplied Limitless.CoopCompat v1.1.0 archive SHA-256 `57727a4ebf9532da2dbf7c69c4a8e2cb1b62b5252ec950ecb0510f34e4290c9a`; IL private literal `MaxBattleSize = int32(12000)`, `BattleSizePostfix` instructions `ldc.i4 200`, `ldc.i4 12000`, `System.Math::Min`, `System.Math::Max`. README describes Limitless 1.0.1 / game 1.4.8 / Coop 0.1.6. IDs: `Limitless`, `Limitless.CoopCompat`; no Workshop id claimed for the supplied compat build.

No new IPC response keys or notice kinds. The website must deploy its expanded configuration parser before CP starts returning values above 1000; old parsers reject such values. Runners must be updated in their authorized window before raising a saved value, as an older runner rejects the expanded range. This fixture proves parsing and policy, not gameplay or multiplayer load. Exact paired heads, PR links, commands and results belong in each PR's pre-merge evidence.

The original Limitless package Andrew supplied previously was named with Nexus id **14025** ([Nexus page](https://www.nexusmods.com/mountandblade2bannerlord/mods/14025)); the current page was unavailable to this inspection (HTTP 403). The compat build is identified by its supplied archive digest and module descriptor, with no separate public distribution id asserted. The original Limitless binary is unnecessary for the dedicated-server check: the compat README says it is listed there without running.

## Rollback and mixed runner versions

Deploy the expanded website parser before CP returns values above 1,000. Before rolling the website back below #430, either retain this expanded parser or reduce every larger stored value to 1,000 through authorized typed CP settings operations and verify old-parser reads. A runner downgrade alone does not repair stored values.

CP admission requires the target health capability limitless-battle-size-v1 as well as the enabled pair. Start and default-save requests are bounded to 1,000 for an older, native-pinned, rolled-back or relocation target without that capability, preserving owner Start while retaining the desired value.
