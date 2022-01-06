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
  .option("grid", {
    describe: "Grid",
    demandOption: true,
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
    default: "long",
  }).argv;

console.log(`base = ${argv.base}`);
console.log(`quote = ${argv.quote}`);
console.log(`grid = ${argv.grid}`);
console.log(`interest = ${argv.interest}%`);
console.log(`minNotional = ${argv.minNotional}`);
console.log(`interval = ${argv.interval}`);
console.log(`side = ${argv.side}`);

module.exports = {
  baseAsset: argv.base,
  quoteAsset: argv.quote,
  gridStep: argv.grid,
  interest: argv.interest / 100,
  minNotional: argv.minNotional,
  interval: argv.interval,
  side: argv.side,
};
