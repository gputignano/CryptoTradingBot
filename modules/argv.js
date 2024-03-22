import yargs from "yargs";
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option("grid", {
    describe: "Grid",
    type: "number",
    default: 1.0,
  })
  .option("minNotional", {
    describe: "minNotional",
    type: "number",
    default: 0,
  }).argv;

console.log(`grid = ${argv.grid}`);

export const grid = argv.grid;
export const minNotional = argv.minNotional;
