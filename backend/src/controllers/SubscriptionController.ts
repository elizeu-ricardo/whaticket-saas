
import { Request, Response } from "express";
import * as Yup from "yup";
import Gerencianet from "gn-api-sdk-typescript";
import AppError from "../errors/AppError";

import options from "../config/Gn";
import CreatePixOrderService from "../services/MercadoPagoService/CreatePixOrderService";
import SavePixTransactionService from "../services/MercadoPagoService/SavePixTransactionService";
import FindExistingPixTransactionService from "../services/MercadoPagoService/FindExistingPixTransactionService";

import Company from "../models/Company";
import Invoices from "../models/Invoices";
import { getIO } from "../libs/socket";

// ==========================================
// CONSULTA LEGADA - EFÍ
// ==========================================

export const index = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const gerencianet = Gerencianet(options);
  return res.json(gerencianet.getSubscriptions());
};

// ==========================================
// CRIAR COBRANÇA PIX - MERCADO PAGO
// ==========================================

export const createSubscription = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const companyId = Number(req.user.companyId);

  if (
    !Number.isSafeInteger(companyId) ||
    companyId <= 0
  ) {
    throw new AppError("Empresa inválida", 400);
  }

  const schema = Yup.object().shape({
    invoiceId: Yup.number()
      .integer()
      .positive()
      .required()
  });

  if (!(await schema.isValid(req.body))) {
    throw new AppError("Fatura inválida", 400);
  }

  const invoiceId = Number(req.body.invoiceId);

  if (
    !Number.isSafeInteger(invoiceId) ||
    invoiceId <= 0
  ) {
    throw new AppError("Fatura inválida", 400);
  }

  // Buscar apenas faturas da empresa autenticada
  const invoice = await Invoices.findOne({
    where: {
      id: invoiceId,
      companyId
    }
  });

  if (!invoice) {
    throw new AppError(
      "Fatura não encontrada",
      404
    );
  }

  // Impedir pagamento de fatura já quitada
  if (invoice.status === "paid") {
    throw new AppError(
      "Esta fatura já foi paga",
      400
    );
  }

  // Valor obtido diretamente do banco
  const invoiceValue = Number(invoice.value);

  if (
    !Number.isFinite(invoiceValue) ||
    invoiceValue <= 0
  ) {
    throw new AppError(
      "Valor da fatura inválido",
      400
    );
  }

  // Buscar dados da empresa
  const company = await Company.findByPk(companyId);

  if (!company) {
    throw new AppError(
      "Empresa não encontrada",
      404
    );
  }

  if (!company.email) {
    throw new AppError(
      "Empresa sem e-mail de cobrança cadastrado",
      400
    );
  }

  // Gerar cobrança pelo Mercado Pago
  try {
    
  const idempotencyKey =
    `invoice_${invoice.id}_company_${companyId}`;
  
  const pix = await CreatePixOrderService({
    invoiceId: invoice.id,
    companyId,
    amount: invoiceValue,
    payerEmail: company.email,
    idempotencyKey
  });
  
  // Registrar a cobrança no PostgreSQL
  await SavePixTransactionService({
    invoiceId: invoice.id,
    companyId,
    amount: invoiceValue,
    idempotencyKey,
    orderId: String(pix.orderId),
    paymentId: pix.paymentId
      ? String(pix.paymentId)
      : undefined,
    qrCode: pix.qrcode.qrcode,
    status: pix.status || "pending",
    expiresAt: null
  });
  
  return res.status(200).json(pix);

  } catch (error: any) {
    console.error("ERRO MERCADO PAGO:", {
      message: error?.message
    });

    throw new AppError(
      "Não foi possível gerar a cobrança Pix",
      502
    );
  }
};

// ==========================================
// WEBHOOK LEGADO - EFÍ
// TEMPORÁRIO: NÃO UTILIZAR PARA MERCADO PAGO
// ==========================================

export const createWebhook = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const schema = Yup.object().shape({
    chave: Yup.string().required(),
    url: Yup.string().required()
  });

  if (!(await schema.isValid(req.body))) {
    throw new AppError("Validation fails", 400);
  }

  const { chave, url } = req.body;

  const body = {
    webhookUrl: url
  };

  const params = {
    chave
  };

  try {
    const gerencianet = Gerencianet(options);
    const create = await gerencianet.pixConfigWebhook(
      params,
      body
    );
    return res.json(create);

  } catch (error) {
    console.error("ERRO WEBHOOK EFÍ:", error);

    throw new AppError(
      "Erro ao configurar webhook",
      502
    );
  }
};

// ==========================================
// RECEBIMENTO WEBHOOK LEGADO - EFÍ
// SERÁ SUBSTITUÍDO PELO MERCADO PAGO
// ==========================================

export const webhook = async (
  req: Request,
  res: Response
): Promise<Response> => {
  // Desativado durante a migração.
  // Não confiar em notificações recebidas sem
  // autenticação e confirmação no provedor.
  return res.status(503).json({
    error: "Webhook de pagamentos em migração"
  });
};
