const _ = require("lodash");
const { baseAsset, quoteAsset, gridStep, interest, minNotional, interval, side, earn } = require("./modules/argv");

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

// READS FILTERS
binance
  .exchangeInfo(baseAsset, quoteAsset)
  .then(exchangeInfo => {
    console.log(`Getting Exchange Info`);

    [symbol] = exchangeInfo.data.symbols;

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
        .then(account => {
          console.log(`=======================================`);

          balances = binance.getBalances(account.data.balances);

          return binance.openOrders(baseAsset, quoteAsset);
        })
        .then(orders => {
          console.log(`There are ${orders.data.length} of ${MAX_NUM_ORDERS.maxNumOrders} orders open.`);

          // Sort orders array by price
          orders.data.sort((a, b) => a.price - b.price);

          // Cancel an order if array length >= MAX_NUM_ORDERS.maxNumOrders
          if (orders.data.length >= MAX_NUM_ORDERS.maxNumOrders) {
            const pos = side === "long" ? orders.data.length - 1 : 0;

            binance
              .cancelOrder({
                symbol: baseAsset + quoteAsset,
                orderId: orders.data[pos].orderId,
              })
              .then(canceledOrder => {
                console.log(`Order CANCELED: ${canceledOrder.data.orderId}`);
                TradeModel.create(canceledOrder.data)
                  .then(trade => {
                    console.log(`Order ADDED TO DATABASE: ${trade.orderId}`);
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
        .then(ticker => {
          let price = ticker.data.price;
          console.log(`price: ${price}`);

          switch (side) {
            case "long":
              buyPrice = _.round(price, PRICE_FILTER.precision);
              sellPrice = _.round(price * (1 + interest), PRICE_FILTER.precision);
              break;
            case "short":
              sellPrice = _.round(price, PRICE_FILTER.precision);
              buyPrice = _.round(price / (1 + interest), PRICE_FILTER.precision);
              break;
          }

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
                // console.log(sellOrder.data);

                if (sellOrder.data.status === "FILLED") {
                  console.log(`SELL: Price: ${sellOrder.data.fills[0].price} / Qty: ${sellOrder.data.fills[0].qty} / Total: ${sellOrder.data.cummulativeQuoteQty}`);

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
                      // console.log(buyOrder.data);
                      console.log(`BUY: Price: ${buyOrder.data.price} / Qty: ${buyOrder.data.origQty} / Total: ${buyOrder.data.price * buyOrder.data.origQty}`);
                    });
                } else if (sellOrder.data.status === "EXPIRED") {
                  console.log(`Order #${sellOrder.data.orderId} ${sellOrder.data.status} (${_.round(sellOrder.data.price, PRICE_FILTER.precision)})`);
                }
              })
              .catch(error => console.log(error));
          } else {
            console.log(`SLOT already in use!`);
          }
        })
        .catch(error => console.log(error));
    }, interval);
  })
  .catch(error => console.log(error.message));

process.on("SIGINT", () => {
  kill = true;
});
