
import { Request, Response } from "express";

import ValidateWebhookSignatureService from "../services/MercadoPagoService/ValidateWebhookSignatureService";
import GetPixOrderService from "../services/MercadoPagoService/GetPixOrderService";
import ConfirmPixPaymentService from "../services/MercadoPagoService/ConfirmPixPaymentService";

import Company from "../models/Company";
import { getIO } from "../libs/socket";

export const receive = async (
  req: Request,
  res: Response
): Promise<Response> => {

  // Identificar o evento recebido
  const topic = req.query.type;

  // Processar somente notificações de orders
  if (topic !== "order" && topic !== "orders_v2") {
    return res.status(200).json({
      ok: true,
      ignored: true
    });
  }

  // Identificador enviado pelo Mercado Pago
  const dataId = req.query["data.id"];

  if (
    typeof dataId !== "string" ||
    !dataId
  ) {
    return res.status(400).json({
      error: "Identificador da order ausente"
    });
  }

  // Conferir consistência com o corpo
  if (
    req.body?.data?.id &&
    String(req.body.data.id) !== dataId
  ) {
    return res.status(400).json({
      error: "Identificadores divergentes"
    });
  }

  // Validar assinatura da notificação
  const signature = req.header("x-signature");
  const requestId = req.header("x-request-id");

  const validSignature =
    ValidateWebhookSignatureService({
      signature,
      requestId,
      dataId
    });

  if (!validSignature) {
    console.warn(
      "WEBHOOK MERCADO PAGO: assinatura inválida"
    );

    return res.status(401).json({
      error: "Assinatura inválida"
    });
  }

  try {
    // Consultar a order diretamente no Mercado Pago
    const order = await GetPixOrderService(dataId);

    console.info("MERCADO PAGO - ORDER:", {
      orderId: order.orderId,
      status: order.orderStatus,
      statusDetail: order.orderStatusDetail
    });

    // Verificar aprovação efetiva do pagamento
    const approved =
      order.orderStatus === "processed" &&
      order.orderStatusDetail === "accredited" &&
      order.paymentStatus === "processed" &&
      order.paymentStatusDetail === "accredited";

    // Não renovar enquanto estiver pendente
    if (!approved) {
      return res.status(200).json({
        ok: true,
        processed: false
      });
    }

    // Confirmar pagamento e renovar licença
    // utilizando transação PostgreSQL
    const result = await ConfirmPixPaymentService({
      orderId: order.orderId,
      paymentId: order.paymentId,
      externalReference: order.externalReference,
      amount: order.amount,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      orderStatusDetail: order.orderStatusDetail
    });

    console.info("PAGAMENTO CONFIRMADO:", {
      companyId: result.companyId,
      alreadyPaid: result.alreadyPaid,
      dueDate: result.dueDate
    });

    // Notificar somente após a confirmação
    // da transação no banco de dados
    if (result.confirmed && !result.alreadyPaid) {
      try {
        const company = await Company.findByPk(
          result.companyId
        );

        if (company) {
          const io = getIO();

          io.to(
            `company-${result.companyId}-mainchannel`
          ).emit(
            `company-${result.companyId}-payment`,
            {
              action: "CONCLUIDA",
              company: {
                id: company.id,
                dueDate: company.dueDate
              }
            }
          );
        }
      } catch (socketError: any) {
        // O pagamento já foi confirmado no banco.
        // Erros de Socket.IO não devem provocar
        // outra renovação da licença.
        console.error(
          "ERRO NOTIFICAÇÃO SOCKET:",
          socketError?.message
        );
      }
    }

    return res.status(200).json({
      ok: true,
      confirmed: result.confirmed,
      alreadyPaid: result.alreadyPaid
    });

  } catch (error: any) {
    console.error(
      "ERRO WEBHOOK MERCADO PAGO:",
      {
        message: error?.message,
        orderId: dataId
      }
    );

    // Permite nova tentativa da notificação.
    // A confirmação da fatura é idempotente.
    return res.status(503).json({
      error: "Falha ao processar pagamento"
    });
  }
};
