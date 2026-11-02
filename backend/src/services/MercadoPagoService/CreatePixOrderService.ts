
import https from "https";
import { v4 as uuidv4 } from "uuid";

interface CreatePixOrderData {
  invoiceId: number;
  companyId: number;
  amount: number;
  payerEmail: string;
  idempotencyKey?: string;
}

const CreatePixOrderService = async ({
  invoiceId,
  companyId,
  amount,
  payerEmail,
  idempotencyKey
}: CreatePixOrderData): Promise<any> => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;

  if (!token) {
    throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado");
  }

  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0 ||
      !Number.isSafeInteger(companyId) || companyId <= 0 ||
      !Number.isFinite(amount) || amount <= 0 ||
      !payerEmail || !payerEmail.includes("@")) {
    throw new Error("Dados da cobrança inválidos");
  }

  const value = amount.toFixed(2);

  const body = JSON.stringify({
    type: "online",
    processing_mode: "automatic",
    external_reference: `invoice_${invoiceId}_company_${companyId}`,
    total_amount: value,
    payer: {
      email: payerEmail
    },
    transactions: {
      payments: [
        {
          amount: value,
          payment_method: {
            id: "pix",
            type: "bank_transfer"
          }
        }
      ]
    }
  });

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: "api.mercadopago.com",
        path: "/v1/orders",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey || uuidv4()
        },
        timeout: 15000
      },
      response => {
        let raw = "";

        response.on("data", chunk => {
          raw += chunk;
        });

        response.on("end", () => {
          let result: any;

          try {
            result = JSON.parse(raw);
          } catch {
            return reject(
              new Error("Resposta inválida do Mercado Pago")
            );
          }

          if (
            !response.statusCode ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            console.error("Mercado Pago HTTP:", response.statusCode);
            return reject(
              new Error("Falha ao criar cobrança Mercado Pago")
            );
          }

          const payment = result.transactions?.payments?.[0];
          const qrCode = payment?.payment_method?.qr_code;

          if (!result.id || !qrCode) {
            return reject(
              new Error("Mercado Pago não retornou o Pix esperado")
            );
          }

          resolve({
            provider: "mercadopago",
            orderId: result.id,
            paymentId: payment.id,
            status: payment.status,
            qrcode: {
              qrcode: qrCode
            },
            valor: {
              original: value
            }
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Tempo limite do Mercado Pago"));
    });

    request.on("error", reject);
    request.write(body);
    request.end();
  });
};

export default CreatePixOrderService;
