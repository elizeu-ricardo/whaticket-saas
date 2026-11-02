
import { Request, Response } from "express";

import ValidateWebhookSignatureService from "../services/MercadoPagoService/ValidateWebhookSignatureService";
import GetPixOrderService from "../services/MercadoPagoService/GetPixOrderService";

export const receive = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const topic = req.query.type;

  // Ignorar eventos que não são de orders.
  if (topic !== "order" && topic !== "orders_v2") {
    return res.status(200).json({ ok: true });
  }

  const dataId = req.query["data.id"];

  if (typeof dataId !== "string" || !dataId) {
    return res.status(400).json({
      error: "Identificador ausente"
    });
  }

  // Conferir se os identificadores coincidem.
  if (
    req.body?.data?.id &&
    String(req.body.data.id) !== dataId
  ) {
    return res.status(400).json({
      error: "Identificadores divergentes"
    });
  }

  const signature = req.header("x-signature");
  const requestId = req.header("x-request-id");

  const valid = ValidateWebhookSignatureService({
    signature,
    requestId,
    dataId
  });

  if (!valid) {
    return res.status(401).json({
      error: "Assinatura inválida"
    });
  }

  try {
    // Não confiar no status enviado no webhook.
    // Consultar diretamente o Mercado Pago.
    const order = await GetPixOrderService(dataId);

    console.info("WEBHOOK MERCADO PAGO:", {
      orderId: order.orderId,
      status: order.orderStatus,
      paymentStatus: order.paymentStatus
    });

    // Próxima etapa:
    // localizar transação no PostgreSQL,
    // conferir valor, empresa e pagamento,
    // atualizar fatura e licença atomicamente.

    return res.status(200).json({
      ok: true
    });

  } catch (error: any) {
    console.error("ERRO WEBHOOK MERCADO PAGO:", {
      message: error?.message
    });

    return res.status(503).json({
      error: "Falha ao consultar pagamento"
    });
  }
};
