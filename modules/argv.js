const yargs = require("yargs");

const argv = yargs
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
  .option("gridBuy", {
    describe: "Grid Buy",
    type: "number",
    default: 1.0,
  })
  .option("gridSell", {
    describe: "Grid Sell",
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
    default: 10.2,
  })
  .option("interval", {
    describe: "Interval",
    type: "number",
    default: 5000,
  })
  .option("side", {
    describe: "Side",
    type: "string",
    default: "buy",
  })
  .option("earn", {
    describe: "Asset to earn (base or quote)",
    demandOption: true,
    type: "string",
    default: "base",
  }).argv;

console.log(`base = ${argv.base}`);
console.log(`quote = ${argv.quote}`);
console.log(`gridBuy = ${argv.gridBuy}`);
console.log(`gridSell = ${argv.gridSell}`);
console.log(`interest = ${argv.interest}%`);
console.log(`minNotional = ${argv.minNotional}`);
console.log(`interval = ${argv.interval}`);
console.log(`side = ${argv.side}`);
console.log(`earn = ${argv.earn}`);

module.exports = {
  baseAsset: argv.base,
  quoteAsset: argv.quote,
  gridBuy: argv.gridBuy,
  gridSell: argv.gridSell,
  interest: argv.interest / 100,
  minNotional: argv.minNotional,
  interval: argv.interval,
  side: argv.side,
  earn: argv.earn,
};
