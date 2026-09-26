import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const manifest = (name) => require.resolve(`${name}/package.json`);
