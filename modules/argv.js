import yargs from "yargs";
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option("side", {
    describe: "Side",
    type: "string",
    default: "buy",
  })
  .option("grid", {
    describe: "Grid",
    type: "number",
    default: 1.0,
  })
  .option("earn", {
    describe: "Asset to earn (base or quote)",
    demandOption: true,
    type: "string",
    default: "base",
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

console.log(`side = ${argv.side}`);
console.log(`grid = ${argv.grid}`);
console.log(`earn = ${argv.earn ??= "base"}`);
console.log(`interest = ${argv.interest}%`);

export const side = argv.side;
export const grid = argv.grid;
export const earn = argv.earn;
export const interest = argv.interest / 100;
export const minNotional = argv.minNotional;
