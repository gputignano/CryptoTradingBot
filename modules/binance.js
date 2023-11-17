import crypto from "crypto";
import fs from "fs";
import axios from "axios";
import path from "path";
import _ from "lodash";
import * as dotenv from "dotenv";
import { grid } from "./argv.js";

const NODE_ENV = process.env.NODE_ENV || "development";

dotenv.config({
  path: path.resolve(process.cwd(), `.env.${NODE_ENV}`)
});

console.log(`${NODE_ENV} mode.`);

export const { API_ENDPOINT, WEBSOCKET_STREAM, WEBSOCKET_API, API_KEY, API_SECRET } = process.env;

const CONFIGS = {
  headers: {
    "X-MBX-APIKEY": API_KEY,
  },
};

const PRIVATE_KEY = fs.readFileSync("./private_key.pem", { encoding: "utf8" });

const signature = query_string => crypto.sign(null, Buffer.from(query_string), {
  key: PRIVATE_KEY,
  padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
  saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
}).toString('base64');

export const ping = () => axios.get(`${API_ENDPOINT}/v3/ping`);

export const exchangeInfo = (baseAsset, quoteAsset) => axios.get(`${API_ENDPOINT}/v3/exchangeInfo?symbol=${baseAsset}${quoteAsset}`);

export const account = (baseAsset, quoteAsset) => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ timestamp });
  const query_string = query.toString();
  const instance = axios.create({});

  instance.interceptors.response.use(response => {
    const filtered = response.data.balances;

    // EMPTY BALANCES
    response.data.balances = {};

    // FROM ARRAY TO OBJECT
    filtered.forEach(element => {
      response.data.balances[element.asset] = element;
    });

    return response;
  });

  return instance.get(`${API_ENDPOINT}/v3/account?${query_string}&signature=${signature(query_string)}`, CONFIGS);
};

export const openOrders = (baseAsset, quoteAsset) => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ symbol: baseAsset + quoteAsset, timestamp });
  const query_string = query.toString();
  const instance = axios.create({});

  instance.interceptors.response.use(response => {
    response.data.forEach(order => order.slot = priceToSlot(order.price, grid));
    response.hasPrice = price => !!response.data.find(order => parseFloat(order.price) === price);

    return response;
  });

  return instance.get(`${API_ENDPOINT}/v3/openOrders?${query_string}&signature=${signature(query_string)}`, CONFIGS);
};

export const tickerPrice = (baseAsset, quoteAsset) => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ symbol: baseAsset + quoteAsset });
  const query_string = query.toString();

  return axios.get(`${API_ENDPOINT}/v3/ticker/price?${query}`);
};

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