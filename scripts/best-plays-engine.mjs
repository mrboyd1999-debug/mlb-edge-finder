import { buildBestPlays } from "../api/lib/bestPlaysEngine.js";

const result = await buildBestPlays();
console.log(JSON.stringify(result, null, 2));
