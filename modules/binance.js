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

const url = process.env.SPOT_API_URL;

let headers = {
  headers: {
    "X-MBX-APIKEY": process.env.API_KEY,
  },
};

const signature = query_string => crypto.createHmac("sha256", process.env.API_SECRET).update(query_string).digest("hex");

export const ping = () => axios.get(`${url}api/v3/ping`);

export const exchangeInfo = (baseAsset, quoteAsset) => axios.get(`${url}api/v3/exchangeInfo?symbol=${baseAsset}${quoteAsset}`);

export const account = () => {
  const query = `timestamp=${Date.now()}`;

  return axios.get(`${url}api/v3/account?${query}&signature=${signature(query)}`, headers);
};

export const openOrders = (baseAsset, quoteAsset) => {
  const query = `symbol=${baseAsset}${quoteAsset}&timestamp=${Date.now()}`;

  return axios.get(`${url}api/v3/openOrders?${query}&signature=${signature(query)}`, headers);
};

export const tickerPrice = (baseAsset, quoteAsset) => {
  const query = `symbol=${baseAsset}${quoteAsset}`;

  return axios.get(`${url}api/v3/ticker/price?${query}`);
};

export const order = params => {
  const query = `${new URLSearchParams(params).toString()}&timestamp=${Date.now()}`;

  return axios.post(`${url}api/v3/order?${query}&signature=${signature(query)}`, "", headers);
};

export const cancelOrder = params => {
  const query = `${new URLSearchParams(params).toString()}&timestamp=${Date.now()}`;

  return axios.delete(`${url}api/v3/order?${query}&signature=${signature(query)}`, headers);
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
