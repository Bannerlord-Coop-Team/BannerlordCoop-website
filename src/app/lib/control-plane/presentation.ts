import type { ReleaseBuild } from "@/app/lib/control-plane/types";

export function installableBuilds(builds: readonly ReleaseBuild[]) {
    return builds.filter((build) => build.validationState === "validated");
}

export function overviewStatRowClass(count: number) {
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 sm:grid-cols-2";
    if (count === 3) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    if (count === 4) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
    throw new Error("Overview statistic rows must contain one through four cards.");
}

export function operationCardRows<T extends { fields: readonly unknown[] }>(cards: readonly T[]): T[][] {
    const ranked = cards
        .map((card, index) => ({ card, index }))
        .sort((left, right) => right.card.fields.length - left.card.fields.length || left.index - right.index)
        .map(({ card }) => card);
    const inputCards = ranked.filter((card) => card.fields.length >= 2);
    const compactCards = ranked.filter((card) => card.fields.length < 2);

    return [...balancedRows(inputCards, 3), ...balancedRows(compactCards, 3)];
}

export function operationCardRowClass(count: number) {
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 md:grid-cols-2";
    if (count === 3) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
    throw new Error("Operation card rows must contain one through three cards.");
}

function balancedRows<T>(items: readonly T[], maximumColumns: number): T[][] {
    if (items.length === 0) return [];
    const rowCount = Math.ceil(items.length / maximumColumns);
    const minimumRowSize = Math.floor(items.length / rowCount);
    const largerRows = items.length % rowCount;
    const rows: T[][] = [];
    let offset = 0;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const size = minimumRowSize + (rowIndex < largerRows ? 1 : 0);
        rows.push(items.slice(offset, offset + size));
        offset += size;
    }
    return rows;
}
