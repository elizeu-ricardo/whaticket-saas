
import { Request, Response } from "express";
import * as Yup from "yup";
import Gerencianet from "gn-api-sdk-typescript";
import AppError from "../errors/AppError";

import options from "../config/Gn";

import CreatePixOrderService from "../services/MercadoPagoService/CreatePixOrderService";
import SavePixTransactionService from "../services/MercadoPagoService/SavePixTransactionService";
import ReservePixTransactionService from "../services/MercadoPagoService/ReservePixTransactionService";
import GetPixOrderService from "../services/MercadoPagoService/GetPixOrderService";
import Company from "../models/Company";
import Invoices from "../models/Invoices";

// ==========================================
// CONSULTA LEGADA - EFI
// ==========================================

export const index = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const gerencianet = Gerencianet(options);
  return res.json(gerencianet.getSubscriptions());
};

// ==========================================
// CRIAR COBRANCA PIX - MERCADO PAGO
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

  // Buscar fatura da empresa autenticada
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

  if (invoice.status === "paid") {
    throw new AppError(
      "Esta fatura já foi paga",
      400
    );
  }

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

  // ========================================
  // RESERVAR COBRANCA NO POSTGRESQL
  // ========================================

  let reservation;

  try {
    reservation = await ReservePixTransactionService({
      invoiceId: invoice.id,
      companyId,
      amount: invoiceValue
    });
  } catch (error: any) {
    console.error("ERRO RESERVA PIX:", {
      message: error?.message
    });

    throw new AppError(
      "Não foi possível reservar a cobrança Pix",
      503
    );
  }

  const transaction = reservation.transaction;

  // Já existe uma tentativa ativa.
  // Não solicitar outra cobrança ao provedor.
  
  if (!reservation.created) {
    // Uma reserva sem orderId pode representar uma
    // cobrança criada no Mercado Pago, mas cuja
    // resposta não foi salva no PostgreSQL.
    if (!transaction.orderId) {
      throw new AppError(
        "Existe uma tentativa de Pix em verificação. " +
        "Não é seguro criar outra cobrança agora.",
        409
      );
    }
  
    const order = await GetPixOrderService(
      transaction.orderId
    );
  
    const expectedReference =
      `invoice_${invoice.id}_company_${companyId}`;
  
    // Conferir se a order pertence à fatura
    if (order.externalReference !== expectedReference) {
      throw new AppError(
        "Referência do pagamento divergente",
        409
      );
    }
  
    // Conferir o valor da cobrança
    const expectedCents = Math.round(invoiceValue * 100);
    const actualCents = Math.round(Number(order.amount) * 100);
  
    if (
      !Number.isFinite(actualCents) ||
      expectedCents !== actualCents
    ) {
      throw new AppError(
        "Valor do pagamento divergente",
        409
      );
    }
  
    // Não permitir nova cobrança se já foi processada
    if (
      order.orderStatus === "processed" ||
      order.paymentStatus === "processed"
    ) {
      throw new AppError(
        "Pagamento processado. Aguardando atualização da fatura.",
        409
      );
    }
  
    const createdAt = new Date(transaction.createdAt);
    const ageMs = Date.now() - createdAt.getTime();
  
    // Limite conservador de recuperação: 45 minutos.
    // O Pix foi solicitado com validade de 1 hora.
    const safeRecoveryWindowMs = 45 * 60 * 1000;
  
    const withinRecoveryWindow =
      Number.isFinite(ageMs) &&
      ageMs >= 0 &&
      ageMs < safeRecoveryWindowMs;
  
    const stillPending =
      order.orderStatus === "action_required" &&
      order.paymentStatus === "action_required";
  
    if (
      withinRecoveryWindow &&
      stillPending &&
      order.qrCode
    ) {
      // Recuperar o QR Code sem criar outra cobrança
      return res.status(200).json({
        provider: "mercadopago",
        orderId: order.orderId,
        paymentId: order.paymentId,
        status: order.paymentStatus,
        qrcode: {
          qrcode: order.qrCode
        },
        valor: {
          original: invoiceValue.toFixed(2)
        }
      });
    }
  
    // Não gerar outra cobrança automaticamente
    throw new AppError(
      "A cobrança anterior precisa ser conciliada " +
      "antes de uma nova tentativa de pagamento.",
      409
    );
  }

  // ========================================
  // GERAR PIX UTILIZANDO A RESERVA
  // ========================================

  try {
    const pix = await CreatePixOrderService({
      invoiceId: invoice.id,
      companyId,
      amount: invoiceValue,
      payerEmail: company.email,
      idempotencyKey: transaction.idempotencyKey
    });

    // Atualizar a reserva existente
    await SavePixTransactionService({
      invoiceId: invoice.id,
      companyId,
      amount: invoiceValue,
      idempotencyKey: transaction.idempotencyKey,
      orderId: String(pix.orderId),
      paymentId: pix.paymentId
        ? String(pix.paymentId)
        : undefined,
      qrCode: pix.qrcode.qrcode,
      status: pix.status || "pending",
      expiresAt: pix.expiresAt
    });

    // Retornar Pix para o checkout
    return res.status(200).json(pix);

  } catch (error: any) {
    console.error("ERRO MERCADO PAGO:", {
      transactionId: transaction.id,
      message: error?.message
    });

    // Não remover a reserva automaticamente.
    // A order pode ter sido criada no Mercado Pago
    // mesmo que tenha ocorrido falha na resposta.
    throw new AppError(
      "Não foi possível concluir a geração do Pix. A cobrança precisa ser verificada antes de outra tentativa.",
      503
    );
  }
};

// ==========================================
// WEBHOOK LEGADO - EFI
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

  } catch (error: any) {
    console.error("ERRO WEBHOOK EFI:", {
      message: error?.message
    });

    throw new AppError(
      "Erro ao configurar webhook",
      502
    );
  }
};

// ==========================================
// WEBHOOK ANTIGO - DESATIVADO
// ==========================================

export const webhook = async (
  req: Request,
  res: Response
): Promise<Response> => {
  return res.status(503).json({
    error: "Webhook de pagamentos em migração"
  });
};
