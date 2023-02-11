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
  })
  .option("interval", {
    describe: "Interval",
    type: "number",
    default: 5000,
  }).argv;

console.log(`base = ${argv.base}`);
console.log(`quote = ${argv.quote}`);
console.log(`side = ${argv.side}`);
console.log(`grid = ${argv.grid}`);
console.log(`earn = ${argv.earn == "base" ? argv.base : argv.quote}`);
console.log(`interest = ${argv.interest}%`);
console.log(`interval = ${argv.interval}`);

module.exports = {
  baseAsset: argv.base,
  quoteAsset: argv.quote,
  side: argv.side,
  grid: argv.grid,
  earn: argv.earn,
  interest: argv.interest / 100,
  minNotional: argv.minNotional,
  interval: argv.interval,
};
