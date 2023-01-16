const _ = require("lodash");
let { baseAsset, quoteAsset, side, grid, earn, interest, minNotional, interval } = require("./modules/argv");

require("dotenv").config({
  path: `${__dirname}/.env.${(process.env.NODE_ENV = process.env.NODE_ENV || "development")}`,
});

console.log(`${process.env.NODE_ENV} mode.`);

const binance = require("./modules/binance");

require("./modules/db"); // Connect to MongoDB

const TradeModel = require("./models/Trade"); // Trade Model

let balances = {};
let exchangeOrders;
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
    [symbols] = exchangeInfo.data.symbols;

    [
      // Use DESTRUCTURING ASSIGNMENT
      PRICE_FILTER, // filterType, minPrice, maxPrice, tickSize
      LOT_SIZE, // filterType, minQty, maxQty, stepSize
      MIN_NOTIONAL, // filterType, minNotional, applyToMarket, avgPriceMins
      ICEBERG_PARTS, // filterType, limit
      MARKET_LOT_SIZE, // filterType, minQty, maxQty, stepSize
      TRAILING_DELTA, // minTrailingAboveDelta, maxTrailingAboveDelta, minTrailingBelowDelta, maxTrailingBelowDelta
      PERCENT_PRICE_BY_SIDE, // bidMultiplierUp, bidMultiplierDown, askMultiplierUp, askMultiplierDown, avgPriceMins
      MAX_NUM_ORDERS, // filterType, maxNumOrders
      MAX_NUM_ALGO_ORDERS, // filterType, maxNumAlgoOrders
    ] = symbols.filters;

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

          [makerCommission, takerCommission] = binance.calculateCommissions(account.data);

          balances = binance.getBalances(account.data.balances);

          return binance.openOrders(baseAsset, quoteAsset);
        })
        .then(orders => {
          exchangeOrders = orders;
          console.log(`There are ${orders.data.length} of ${MAX_NUM_ORDERS.maxNumOrders} orders open.`);

          // Sort orders array by price
          orders.data.sort((a, b) => a.price - b.price);

          // Cancel an order if array length >= MAX_NUM_ORDERS.maxNumOrders
          if (orders.data.length >= MAX_NUM_ORDERS.maxNumOrders) {
            const pos = side === "buy" ? orders.data.length - 1 : 0;

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
                  .catch(error => console.error(error));
              });
          }

          return binance.tickerPrice(baseAsset, quoteAsset);
        })
        .then(ticker => {
          let price = ticker.data.price;

          let lowerPrice = binance.getLowerPrice(price, grid, PRICE_FILTER.precision);
          let higherPrice = binance.getHigherPrice(price, grid, PRICE_FILTER.precision);

          console.log(`lowerPrice: ${lowerPrice} - slot: ${binance.priceToSlot(lowerPrice, grid)}`);
          console.log(`price: ${price} - slot: ${binance.priceToSlot(price, grid)}`);
          console.log(`higherPrice: ${higherPrice} - slot: ${binance.priceToSlot(higherPrice, grid)}`);

          switch (side) {
            case "buy":
              if (balances[quoteAsset] === undefined || balances[quoteAsset].free < minNotional) throw new Error("No BUY balance to trade.");

              buyPrice = higherPrice;
              sellPrice = _.floor(buyPrice * (1 + interest), PRICE_FILTER.precision);

              amountToBuy = _.ceil(minNotional / buyPrice, LOT_SIZE.precision);

              switch (earn) {
                case "base": // Earns BASE Asset (BTC)
                  amountToSell = _.ceil((buyPrice * amountToBuy) / (1 - takerCommission) / sellPrice, LOT_SIZE.precision);
                  break;
                case "quote": // Earns QUOTE Asset (USDT)
                  amountToSell = _.floor(amountToBuy * (1 - takerCommission), LOT_SIZE.precision);
                  break;
              }
              break;
            case "sell":
              if (balances[baseAsset] === undefined || balances[baseAsset].free * price < minNotional) throw new Error("No SELL balance to trade.");

              sellPrice = lowerPrice;
              buyPrice = _.ceil(sellPrice / (1 + interest), PRICE_FILTER.precision);

              switch (earn) {
                case "base": // EARNS BASE Asset
                  amountToSell = _.ceil(minNotional / sellPrice / (1 - takerCommission), LOT_SIZE.precision);
                  amountToBuy = _.ceil(minNotional / buyPrice, LOT_SIZE.precision);
                  break;
                case "quote": // EARNS QUOTE Asset
                  amountToSell = _.ceil(minNotional / sellPrice / (1 - interest), LOT_SIZE.precision);
                  amountToBuy = _.ceil(amountToSell / (1 - takerCommission), LOT_SIZE.precision);
                  break;
              }
              break;
          }

          let slot1 = binance.priceToSlot(sellPrice, grid);
          let slot2 = binance.priceToSlot(buyPrice, grid);

          openOrders = binance.getOpenOrders(exchangeOrders.data, grid);

          if ((side === "buy" && openOrders[slot1] !== undefined) || (side === "sell" && openOrders[slot2] !== undefined)) {
            console.log(`slot1: ${slot1} / slot2: ${slot2}`);
            throw new Error(`Slots are full!`);
          }

          switch (side) {
            case "buy":
              // BUY ORDER
              binance
                .order({
                  symbol: baseAsset + quoteAsset,
                  side: "BUY",
                  type: "LIMIT",
                  timeInForce: "FOK",
                  quantity: amountToBuy,
                  price: buyPrice,
                })
                .then(buyOrder => {
                  console.log(buyOrder.data);

                  if (buyOrder.data.status === "FILLED") {
                    // SELL ORDER
                    binance
                      .order({
                        symbol: baseAsset + quoteAsset,
                        side: "SELL",
                        type: "LIMIT",
                        timeInForce: "GTC",
                        quantity: amountToSell,
                        price: sellPrice,
                      })
                      .then(sellOrder => {
                        console.log(sellOrder.data);
                      });
                  }
                })
                .catch(error => console.error(error));
              break;
            case "sell":
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
                  console.log(sellOrder.data);

                  if (sellOrder.data.status === "FILLED") {
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
                        console.log(buyOrder.data);
                      });
                  }
                })
                .catch(error => console.error(error));
              break;
          }
        })
        .catch(error => console.error(error));
    }, interval);
  })
  .catch(error => console.error(error));

process.on("SIGINT", () => {
  kill = true;
});
