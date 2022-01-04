const _ = require("lodash");
const { baseAsset, quoteAsset, gridStep, interest, minNotional, interval } = require("./modules/argv");

require("dotenv").config({
  path: `${__dirname}/.env.${(process.env.NODE_ENV = process.env.NODE_ENV || "development")}`,
});

console.log(`${process.env.NODE_ENV} mode.`);

const binance = require("./modules/binance");

require("./modules/db"); // Connect to MongoDB

const TradeModel = require("./models/Trade"); // Trade Model

let balances = {};
let openOrders;
let amountToBuy;
let amountToSell;
let buyPrice;
let sellPrice;
let kill = false;

binance
  .exchangeInfo(baseAsset, quoteAsset)
  .then(response => {
    console.log(`Getting Exchange Info`);

    [symbol] = response.data.symbols;

    [
      PRICE_FILTER, // filterType, minPrice, maxPrice, tickSize
      PERCENT_PRICE, // filterType, multiplierUp, multiplierDown, avgPriceMins
      LOT_SIZE, // filterType, minQty, maxQty, stepSize
      MIN_NOTIONAL, // filterType, minNotional, applyToMarket, avgPriceMins
      ICEBERG_PARTS, // filterType, limit
      MARKET_LOT_SIZE, // filterType, minQty, maxQty, stepSize
      MAX_NUM_ORDERS, // filterType, maxNumOrders
      MAX_NUM_ALGO_ORDERS, // filterType, maxNumAlgoOrders
    ] = symbol.filters;

    PRICE_FILTER.precision = Math.round(-Math.log10(PRICE_FILTER.tickSize));
    LOT_SIZE.precision = Math.round(-Math.log10(LOT_SIZE.stepSize));

    console.log(`PRICE_FILTER.precision: ${PRICE_FILTER.precision} / LOT_SIZE.precision: ${LOT_SIZE.precision}`);

    setInterval(() => {
      if (kill) process.exit(0);

      // READS BALANCES
      binance
        .account()
        .then(response => {
          console.log(`=======================================`);

          balances = binance.getBalances(response.data.balances);

          return binance.openOrders(baseAsset, quoteAsset);
        })
        .then(orders => {
          console.log(`There are ${orders.data.length} of ${MAX_NUM_ORDERS.maxNumOrders} orders open.`);

          orders.data.sort((a, b) => a.price - b.price);

          if (orders.data.length >= MAX_NUM_ORDERS.maxNumOrders) {
            binance
              .cancelOrder({
                symbol: baseAsset + quoteAsset,
                orderId: orders.data[0].orderId,
              })
              .then(canceledOrder => {
                TradeModel.create(canceledOrder.data)
                  .then(result => {
                    console.log(`Order DELETED: ${orders.data[0].orderId}`);
                  })
                  .catch(error => console.log(error));
              });
          }

          openOrders = {};

          orders.data.forEach(order => {
            openOrders[binance.priceToSlot(order.price, gridStep, PRICE_FILTER.precision)] = true;
          });

          return binance.tickerPrice(baseAsset, quoteAsset);
        })
        .then(response => {
          let price = response.data.price;
          console.log(`price: ${price}`);

          sellPrice = _.round(price, PRICE_FILTER.precision);
          buyPrice = _.round(price / (1 + interest), PRICE_FILTER.precision);
          console.log(`sellPrice: ${sellPrice} - buyPrice: ${buyPrice}`);

          let sellSlot = binance.priceToSlot(sellPrice, gridStep, PRICE_FILTER.precision);
          let buySlot = binance.priceToSlot(buyPrice, gridStep, PRICE_FILTER.precision);
          console.log(`sellSlot: ${sellSlot} - buySlot: ${buySlot}`);

          if (openOrders[buySlot] === undefined && openOrders[sellSlot] === undefined) {
            amountToSell = _.ceil(minNotional / sellPrice, LOT_SIZE.precision);

            if (Number(balances[baseAsset].free) < amountToSell) new Error(`baseAsset insufficient.`);

            // SELL ORDER
            binance
              .order({
                symbol: baseAsset + quoteAsset,
                side: "SELL",
                type: "LIMIT",
                timeInForce: "FOK",
                quantity: amountToSell,
                price: sellPrice,
              })
              .then(sellOrder => {
                if (sellOrder.data.status === "FILLED") {
                  console.log(
                    `SELL Order #${sellOrder.data.orderId}, ${Number(sellOrder.data.executedQty).toFixed(LOT_SIZE.precision)} tokens at ${Number(sellOrder.data.price).toFixed(
                      PRICE_FILTER.precision
                    )}, TOTAL: ${sellOrder.data.cummulativeQuoteQty}`
                  );

                  // EARNS CRYPTO
                  let commission = sellOrder.data.fills[0].commission;
                  console.log(`Commission: ${commission}`);
                  amountToBuy = _.floor((sellOrder.data.cummulativeQuoteQty - commission) / buyPrice, LOT_SIZE.precision);

                  // BUY ORDER
                  binance
                    .order({
                      symbol: baseAsset + quoteAsset,
                      side: "BUY",
                      type: "LIMIT",
                      timeInForce: "GTC",
                      quantity: amountToBuy,
                      price: buyPrice,
                    })
                    .then(buyOrder => {
                      console.log(
                        `BUY Order #${buyOrder.data.orderId}, ${Number(buyOrder.data.origQty).toFixed(LOT_SIZE.precision)} tokens at ${Number(buyOrder.data.price).toFixed(
                          PRICE_FILTER.precision
                        )}, TOTAL: ${buyOrder.data.origQty * buyOrder.data.price}`
                      );
                    });
                } else if (sellOrder.data.status === "EXPIRED") {
                  console.log(`Order #${sellOrder.data.orderId} ${sellOrder.data.status} (${_.round(sellOrder.data.price, PRICE_FILTER.precision)})`);
                }
              })
              .catch(error => console.log(error));
          } else {
            // console.log(`SLOT already in use!`);
          }
        })
        .catch(error => console.log(error));
    }, interval);
  })
  .catch(error => console.log(error.message));

process.on("SIGINT", () => {
  kill = true;
});
