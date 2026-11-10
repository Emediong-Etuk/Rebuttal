import { pp } from "./lib.mjs";
const r = await pp("GET", process.argv[2]);
console.log(JSON.stringify(r.data, null, 1).slice(0, Number(process.argv[3] ?? 3000)));
