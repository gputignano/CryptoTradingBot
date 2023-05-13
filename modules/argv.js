import yargs from "yargs";
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option("base", {
    describe: "Base asset",
    demandOption: true,
    type: "string",
  })
  .option("quote", {
    describe: "Quote Asset",
    demandOption: true,
    type: "string",
  })
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
  }).argv;

console.log(`base = ${argv.base}`);
console.log(`quote = ${argv.quote}`);
console.log(`side = ${argv.side}`);
console.log(`grid = ${argv.grid}`);
console.log(`earn = ${argv.earn == "base" ? argv.base : argv.quote}`);
console.log(`interest = ${argv.interest}%`);

export const baseAsset = argv.base;
export const quoteAsset = argv.quote;
export const side = argv.side;
export const grid = argv.grid;
export const earn = argv.earn;
export const interest = argv.interest / 100;
export const minNotional = argv.minNotional;
