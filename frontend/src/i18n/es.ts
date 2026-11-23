/** Spanish dictionary, merged from one file per component/module in ./es/ (English → Spanish). */
const modules = import.meta.glob<{ default: Record<string, string> }>('./es/*.ts', { eager: true });

export const es: Record<string, string> = Object.assign({}, ...Object.values(modules).map((m) => m.default));
