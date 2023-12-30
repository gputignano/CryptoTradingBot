import crypto from "crypto";
import fs from "fs";
import axios from "axios";
import path from "path";
import _ from "lodash";
import * as dotenv from "dotenv";

const NODE_ENV = process.env.NODE_ENV || "development";

dotenv.config({
  path: path.resolve(process.cwd(), `.env.${NODE_ENV}`)
});

console.log(`${NODE_ENV} mode.`);

export const { API_ENDPOINT, WEBSOCKET_STREAM, WEBSOCKET_API, API_KEY } = process.env;

const CONFIGS = {
  headers: {
    "X-MBX-APIKEY": API_KEY,
  },
};

const PRIVATE_KEY = fs.readFileSync(`./${NODE_ENV}_private_key.pem`, { encoding: "utf8" });

export const signature = query_string => crypto.sign(null, Buffer.from(query_string), {
  key: PRIVATE_KEY,
  padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
  saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
}).toString('base64');

export const order = params => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp });
  const query_string = query.toString();

  return axios.post(`${API_ENDPOINT}/v3/order?${query_string}&signature=${signature(query_string)}`, null, CONFIGS);
};

export const cancelOrder = params => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp });
  const query_string = query.toString();

  return axios.delete(`${API_ENDPOINT}/v3/order?${query_string}&signature=${signature(query_string)}`, CONFIGS);
};

export const priceToSlot = (price, grid) => Math.floor(Math.log10(price) / Math.log10(1 + grid / 100));

const slotToPrice = (slot, grid) => Math.pow(1 + grid / 100, slot);

export const getLowerPrice = (price, grid, precision) => _.ceil(slotToPrice(priceToSlot(price, grid), grid), precision);

export const getHigherPrice = (price, grid, precision) => _.floor(slotToPrice(priceToSlot(price, grid) + 1, grid), precision);

export const printExecutedOrder = order => console.log(`${new Date(order.transactTime).toLocaleString()} ${order.status} ${order.type} ${order.timeInForce} ${order.side} ${order.origQty} ${order.symbol} at ${order.price}`);

export const getExchangeInfoMap = data => {
  const exchangeInfoMap = new Map();
  const symbolsMap = new Map();

  data.result.symbols.forEach(symbol => {
    const filtersMap = new Map();

    symbol.filters.forEach(filter => {
      switch (filter.filterType) {
        case "PRICE_FILTER":
          filter.precision = Math.round(-Math.log10(filter.tickSize));
          break;
        case "LOT_SIZE":
          filter.precision = Math.round(-Math.log10(filter.stepSize));
          break;
      }

      filtersMap.set(filter.filterType, filter);
    });

    symbolsMap.set(symbol.symbol, new Map([
      ["baseAsset", symbol.baseAsset],
      ["quoteAsset", symbol.quoteAsset],
      ['filters', filtersMap]
    ]));
  });

  return exchangeInfoMap.set("result", new Map([["symbols", symbolsMap]]));
};
