import crypto from "crypto";
import axios from "axios";
import path from "path";
import _ from "lodash";
import * as dotenv from "dotenv";

const NODE_ENV = process.env.NODE_ENV || "development";

dotenv.config({
  path: path.resolve(process.cwd(), `.env.${NODE_ENV}`)
});

console.log(`${NODE_ENV} mode.`);

export const { API_BASE_URL, WEBSOCkET_STREAM_BASE_URL, API_KEY, API_SECRET } = process.env;

const CONFIGS = {
  headers: {
    "X-MBX-APIKEY": API_KEY,
  },
};

const signature = query_string => crypto.createHmac("sha256", API_SECRET).update(query_string).digest("hex");

export const ping = () => axios.get(`${API_BASE_URL}/api/v3/ping`);

const getExchangeInfo = (baseAsset, quoteAsset) => axios.get(`${API_BASE_URL}/api/v3/exchangeInfo?symbol=${baseAsset}${quoteAsset}`);

export const getExchangeInfoFilters = async (baseAsset, quoteAsset) => {
  const exchangeInfo = await getExchangeInfo(baseAsset, quoteAsset);
  const [
    PRICE_FILTER, // filterType, minPrice, maxPrice, tickSize
    LOT_SIZE, // filterType, minQty, maxQty, stepSize
    MIN_NOTIONAL, // filterType, minNotional, applyToMarket, avgPriceMins
    ICEBERG_PARTS, // filterType, limit
    MARKET_LOT_SIZE, // filterType, minQty, maxQty, stepSize
    TRAILING_DELTA, // minTrailingAboveDelta, maxTrailingAboveDelta, minTrailingBelowDelta, maxTrailingBelowDelta
    PERCENT_PRICE_BY_SIDE, // bidMultiplierUp, bidMultiplierDown, askMultiplierUp, askMultiplierDown, avgPriceMins
    MAX_NUM_ORDERS, // filterType, maxNumOrders
    MAX_NUM_ALGO_ORDERS, // filterType, maxNumAlgoOrders
    // ] = symbols.filters;
  ] = exchangeInfo.data.symbols[0].filters;

  PRICE_FILTER.precision = Math.round(-Math.log10(PRICE_FILTER.tickSize));
  LOT_SIZE.precision = Math.round(-Math.log10(LOT_SIZE.stepSize));

  return [PRICE_FILTER, LOT_SIZE, MIN_NOTIONAL, ICEBERG_PARTS, MARKET_LOT_SIZE, TRAILING_DELTA, PERCENT_PRICE_BY_SIDE, MAX_NUM_ORDERS, MAX_NUM_ALGO_ORDERS];
};

export const account = () => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ timestamp });
  const query_string = query.toString();

  return axios.get(`${API_BASE_URL}/api/v3/account?${query_string}&signature=${signature(query_string)}`, CONFIGS);
};

export const openOrders = (baseAsset, quoteAsset) => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ symbol: baseAsset + quoteAsset, timestamp });
  const query_string = query.toString();

  return axios.get(`${API_BASE_URL}/api/v3/openOrders?${query_string}&signature=${signature(query_string)}`, CONFIGS);
};

export const tickerPrice = (baseAsset, quoteAsset) => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ symbol: baseAsset + quoteAsset });
  const query_string = query.toString();

  return axios.get(`${API_BASE_URL}/api/v3/ticker/price?${query}`);
};

export const order = params => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp });
  const query_string = query.toString();

  return axios.post(`${API_BASE_URL}/api/v3/order?${query_string}&signature=${signature(query_string)}`, null, CONFIGS);
};

export const cancelOrder = params => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp });
  const query_string = query.toString();

  return axios.delete(`${API_BASE_URL}/api/v3/order?${query_string}&signature=${signature(query_string)}`, CONFIGS);
};

export const getBalances = arrayBalances => {
  let objectBalances = {};

  arrayBalances.forEach(balance => {
    if (balance.free == 0 && balance.locked == 0) return;
    objectBalances[balance.asset] = {
      free: balance.free,
      locked: balance.locked,
    };
  });

  console.table(objectBalances);

  return objectBalances;
};

export const priceToSlot = (price, grid) => Math.floor(Math.log10(price) / Math.log10(1 + grid / 100));

const slotToPrice = (slot, grid) => Math.pow(1 + grid / 100, slot);

export const getOpenOrders = (orders, grid) => {
  let openOrders = {};

  orders.forEach(order => {
    openOrders[priceToSlot(order.price, grid)] = true;
  });

  return openOrders;
};

export const calculateCommissions = data => {
  const [makerCommission, takerCommission] = [data.makerCommission / 10000, data.takerCommission / 10000];

  console.log(`makerCommission: ${makerCommission} / takerCommission: ${takerCommission}`);

  return [makerCommission, takerCommission];
};

export const getLowerPrice = (price, grid, precision) => _.ceil(slotToPrice(priceToSlot(price, grid), grid), precision);

export const getHigherPrice = (price, grid, precision) => _.floor(slotToPrice(priceToSlot(price, grid) + 1, grid), precision);
