import { expect, it } from 'vitest';
import { parseRunnerConfigurationFile } from '../../../../supabase/functions/_shared/server-configuration-contract';
import { parseModsState } from '../../../../supabase/functions/_shared/server-mods-contract';
import { maximumBattleSize } from '../../../../supabase/functions/_shared/battle-size-policy';

import fixture from '../../../../test/fixtures/limitless-contract/v1.json';
it('consumes the same versioned CP config/catalog fixture and fails closed for either missing module', () => {
    expect(fixture.schema).toBe('limitless-battle-size-v1');
    const file = parseRunnerConfigurationFile(fixture.file);
    expect(file).toEqual(fixture.file);
    const state = parseModsState(fixture.state);
    expect(state).toEqual(fixture.state);
    expect(maximumBattleSize(state.mods)).toBe(12000);
    for (const id of ['Limitless', 'Limitless.CoopCompat']) {
        expect(maximumBattleSize(state.mods.filter(mod => mod.id !== id))).toBe(1000);
        expect(maximumBattleSize(state.mods.map(mod => mod.id === id ? { ...mod, enabled: false } : mod))).toBe(1000);
    }
    expect(() => parseRunnerConfigurationFile({ ...fixture.file, settings: { ...fixture.file.settings,
        modOptions: { ...fixture.file.settings.modOptions, battleSize: 12001 } } })).toThrow();
    expect(() => parseModsState({ ...fixture.state, revision: 'invalid' })).toThrow();
});
