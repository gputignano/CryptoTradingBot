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
let makerCommission;
let takerCommission;
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

          makerCommission = account.data.makerCommission / 10000;
          takerCommission = account.data.takerCommission / 10000;

          console.log(`makerCommission: ${makerCommission} / takerCommission: ${takerCommission}`);

          balances = binance.getBalances(account.data.balances);
          console.table(balances);

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
                  .catch(error => console.error(error));
              });
          }

          openOrders = {};

          orders.data.forEach(order => {
            openOrders[priceToSlot(order.price, gridStep)] = order.orderId;
          });

          return binance.tickerPrice(baseAsset, quoteAsset);
        })
        .then(ticker => {
          let price = ticker.data.price;
          let lowerPrice = _.ceil(slotToPrice(priceToSlot(price, gridStep), gridStep), PRICE_FILTER.precision);
          let higherPrice = _.floor(slotToPrice(priceToSlot(price, gridStep) + 1, gridStep), PRICE_FILTER.precision);

          console.log(`lowerPrice: ${lowerPrice} - slot: ${priceToSlot(lowerPrice, gridStep)}`);
          console.log(`price: ${price} - slot: ${priceToSlot(price, gridStep)}`);
          console.log(`higherPrice: ${higherPrice} - slot: ${priceToSlot(higherPrice, gridStep)}`);

          switch (side) {
            case "long":
              buyPrice = higherPrice;
              sellPrice = _.round(buyPrice * (1 + interest), PRICE_FILTER.precision);
              console.log(`buyPrice: ${buyPrice} (${priceToSlot(buyPrice, gridStep)}) / sellPrice: ${sellPrice} (${priceToSlot(sellPrice, gridStep)})`);
              break;
            case "short":
              sellPrice = lowerPrice;
              buyPrice = _.round(sellPrice / (1 + interest), PRICE_FILTER.precision);
              console.log(`sellPrice: ${sellPrice} (${priceToSlot(sellPrice, gridStep)}) / buyPrice: ${buyPrice} (${priceToSlot(buyPrice, gridStep)})`);
              break;
          }

          let slot1 = priceToSlot(sellPrice, gridStep);
          let slot2 = priceToSlot(buyPrice, gridStep);

          if (openOrders[slot1] === undefined && openOrders[slot2] === undefined) {
            switch (side) {
              case "long":
                let numberOfPossibleOrders = _.floor(balances[quoteAsset].free / minNotional);
                if (numberOfPossibleOrders == 0) throw new Error(`Impossible to execute a new order`);
                let recalculatedMinNotional = _.floor(balances[quoteAsset].free / numberOfPossibleOrders, PRICE_FILTER.precision);
                console.log(`recalculatedMinNotional: ${recalculatedMinNotional}`);

                amountToBuy = _.floor(recalculatedMinNotional / buyPrice, LOT_SIZE.precision);

                if (Number(balances[quoteAsset].free) < amountToBuy) new Error(`quoteAsset insufficient.`);

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
                    if (buyOrder.data.status === "FILLED") {
                      console.log(`BUY ORDER EXECUTED: Price: ${buyOrder.data.price} / Qty: ${buyOrder.data.executedQty} / Total: ${buyOrder.data.cummulativeQuoteQty}`);

                      let fills = buyOrder.data.fills.reduce(
                        (prev, curr) => {
                          prev.qty += Number(curr.qty);
                          prev.commission += Number(curr.commission);
                          return prev;
                        },
                        {
                          qty: 0,
                          commission: 0,
                        }
                      );

                      console.log(fills);

                      switch (earn) {
                        // Earns BASE Asset
                        case "base":
                          amountToSell = _.floor(buyOrder.data.cummulativeQuoteQty / sellPrice - fills.commission, LOT_SIZE.precision);
                          break;
                        // Earns QUOTE Asset
                        case "quote":
                          amountToSell = _.floor(buyOrder.data.executedQty - fills.commission, LOT_SIZE.precision);
                          break;
                      }

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
                          // console.log(sellOrder.data);
                          console.log(
                            `SELL ORDER EXECUTED: Price: ${sellOrder.data.price} / Qty: ${sellOrder.data.origQty} / Total: ${sellOrder.data.price * sellOrder.data.origQty}`
                          );
                        });
                    } else {
                      console.log(buyOrder.data);
                    }
                  })
                  .catch(error => console.error(error));
                break;
              case "short":
                amountToSell = _.ceil(minNotional / sellPrice, LOT_SIZE.precision);
                console.log(`amountToSell: ${amountToSell}`);

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
                        `SELL ORDER EXECUTED: Price: ${sellOrder.data.fills[0].price} / Qty: ${buyOrder.data.fills[0].qty} / Total: ${buyOrder.data.cummulativeQuoteQty}`
                      );

                      let fills = sellOrder.data.fills.reduce(
                        (prev, curr) => {
                          prev.qty += Number(curr.qty);
                          prev.commission += Number(curr.commission);
                          return prev;
                        },
                        {
                          qty: 0,
                          commission: 0,
                        }
                      );

                      switch (earn) {
                        // EARNS BASE Asset
                        case "base":
                          amountToBuy = _.floor((sellOrder.data.executedQty - fills.commission) / buyPrice, LOT_SIZE.precision);
                          break;
                        // EARNS QUOTE Asset
                        case "quote":
                          amountToBuy = _.ceil(sellOrder.data.cummulativeQuoteQty / buyPrice - fills.commission, LOT_SIZE.precision);
                          break;
                      }

                      console.log(`amountToBuy: ${amountToBuy}`);

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
                          console.log(`BUY: Price: ${buyOrder.data.price} / Qty: ${buyOrder.data.origQty} / Total: ${buyOrder.data.price * buyOrder.data.origQty}`);
                        });
                    } else {
                      console.log(sellOrder.data);
                    }
                  })
                  .catch(error => console.error(error));
                break;
            }
          } else {
            console.log(
              `SLOT ${slot2} (${_.ceil(slotToPrice(slot2, gridStep), PRICE_FILTER.precision)} - ${_.floor(
                slotToPrice(slot2 + 1, gridStep),
                PRICE_FILTER.precision
              )}) or ${slot1} (${_.ceil(slotToPrice(slot1, gridStep), PRICE_FILTER.precision)} - ${_.floor(
                slotToPrice(slot1 + 1, gridStep),
                PRICE_FILTER.precision
              )}) already in use!`
            );
          }
        })
        .catch(error => console.error(error));
    }, interval);
  })
  .catch(error => console.error(error));

process.on("SIGINT", () => {
  kill = true;
});

priceToSlot = (price, gridStep) => Math.floor(Math.log10(price) / Math.log10(1 + gridStep / 100));
slotToPrice = (slot, gridStep) => Math.pow(1 + gridStep / 100, slot);
