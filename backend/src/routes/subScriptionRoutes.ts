
import express from "express";
import isAuth from "../middleware/isAuth";

import * as SubscriptionController from "../controllers/SubscriptionController";
import * as MercadoPagoWebhookController from "../controllers/MercadoPagoWebhookController";

const subscriptionRoutes = express.Router();

// Checkout autenticado
subscriptionRoutes.post(
  "/subscription",
  isAuth,
  SubscriptionController.createSubscription
);

// Webhook Mercado Pago
// A autenticação ocorre pela assinatura da notificação.
subscriptionRoutes.post(
  "/subscription/mercadopago/webhook",
  MercadoPagoWebhookController.receive
);

// Rotas legadas Efí
subscriptionRoutes.post(
  "/subscription/create/webhook",
  SubscriptionController.createWebhook
);

subscriptionRoutes.post(
  "/subscription/webhook/:type?",
  SubscriptionController.webhook
);

export default subscriptionRoutes;
