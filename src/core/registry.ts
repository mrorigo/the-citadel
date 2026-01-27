export function getGlobalSingleton<T>(key: string, factory: () => T): T {
    const globalSymbols = (globalThis as unknown as { [key: symbol]: unknown });
    const sym = Symbol.for(`citadel:${key}`);

    if (globalSymbols[sym] === undefined) {
        globalSymbols[sym] = factory();
    }

    return globalSymbols[sym] as T;
}

export function setGlobalSingleton<T>(key: string, value: T): void {
    const globalSymbols = (globalThis as unknown as { [key: symbol]: unknown });
    const sym = Symbol.for(`citadel:${key}`);
    globalSymbols[sym] = value;
}

export function clearGlobalSingleton(key: string): void {
    const globalSymbols = (globalThis as unknown as { [key: symbol]: unknown });
    const sym = Symbol.for(`citadel:${key}`);
    delete globalSymbols[sym];
}
