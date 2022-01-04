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
  })
  .option("interest", {
    describe: "Interest",
    type: "number",
  })
  .option("minNotional", {
    describe: "minNotional",
    type: "number",
  })
  .option("interval", {
    describe: "Interval",
  }).argv;

module.exports = {
  baseAsset: argv.base,
  quoteAsset: argv.quote,
  gridStep: argv.grid || 1.0,
  interest: (argv.interest || 1.0) / 100,
  minNotional: argv.minNotional || 10.2,
  interval: argv.interval || 5000,
};
