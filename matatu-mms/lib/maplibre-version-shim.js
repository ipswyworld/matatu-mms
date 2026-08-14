// @tomtom-org/maps-sdk does `import { version } from "maplibre-gl/package.json"`,
// a named import of a JSON export that Next's webpack config doesn't resolve.
// This shim re-exports it as a real JS named export; aliased in next.config.mjs.
// Imports via a relative path (not the bare "maplibre-gl/package.json"
// specifier) so it doesn't get redirected back to itself by that alias.
import pkg from "../node_modules/maplibre-gl/package.json";

export const version = pkg.version;
export default pkg;
