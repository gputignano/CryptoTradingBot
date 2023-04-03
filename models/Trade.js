import mongoose from "mongoose";
const TradeSchema = new mongoose.Schema({
  symbol: String,
  origClientOrderId: String,
  orderId: Number,
  orderListId: Number,
  clientOrderId: String,
  price: Number,
  origQty: Number,
  executedQty: Number,
  cummulativeQuoteQty: Number,
  status: String,
  timeInForce: String,
  type: String,
  side: String,
});

export const TradeModel = mongoose.model("TradeModel", TradeSchema);