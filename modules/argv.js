import yargs from "yargs";
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option("grid", {
    describe: "Grid",
    type: "number",
    default: 1.0,
  })
  .option("interest", {
    describe: "Interest",
    type: "number",
    default: 1,
  })
  .option("minNotional", {
    describe: "minNotional",
    type: "number",
    default: 0,
  }).argv;

console.log(`grid = ${argv.grid}`);
console.log(`interest = ${argv.interest}%`);

export const grid = argv.grid;
export const interest = argv.interest / 100;
export const minNotional = argv.minNotional;
