import type { Dictionary, Messages, Namespace, PluralMessage } from "./types";

/** Substitutes each unchanged namespace's earlier dictionary, returning the earlier messages when nothing changed. */
export function reuseDictionaries(previous: Messages, next: Messages): Messages {
    const merged = {} as Messages;
    let changed = Object.keys(previous).length !== Object.keys(next).length;
    for (const [namespace, dictionary] of Object.entries(next) as [Namespace, Dictionary][]) {
        const earlier = previous[namespace];
        const reused = earlier !== undefined && sameDictionary(earlier, dictionary);
        merged[namespace] = reused ? earlier : dictionary;
        if (merged[namespace] !== earlier) changed = true;
    }
    return changed ? merged : previous;
}

/** Compares two dictionaries by their messages rather than by object identity. */
export function sameDictionary(left: Dictionary, right: Dictionary): boolean {
    if (left === right) return true;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => Object.hasOwn(right, key) && sameMessage(left[key], right[key]));
}

/** Compares one plain or plural message by value. */
export function sameMessage(left: string | PluralMessage, right: string | PluralMessage): boolean {
    if (typeof left === "string" || typeof right === "string") return left === right;
    const forms = Object.keys(left) as (keyof PluralMessage)[];
    return forms.length === Object.keys(right).length && forms.every((form) => left[form] === right[form]);
}
