
import https from "https";

interface CreatePixOrderData {
  invoiceId: number;
  companyId: number;
  amount: number;
  payerEmail: string;
  idempotencyKey: string;
}

interface PixOrderResult {
  provider: string;
  orderId: string;
  paymentId: string;
  status: string;
  qrcode: {
    qrcode: string;
  };
  valor: {
    original: string;
  };
  expiresAt: Date | null;
}

const CreatePixOrderService = async ({
  invoiceId,
  companyId,
  amount,
  payerEmail,
  idempotencyKey
}: CreatePixOrderData): Promise<PixOrderResult> => {

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      "MERCADOPAGO_ACCESS_TOKEN não configurado"
    );
  }

  if (
    !Number.isSafeInteger(invoiceId) ||
    invoiceId <= 0 ||
    !Number.isSafeInteger(companyId) ||
    companyId <= 0 ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !payerEmail ||
    !payerEmail.includes("@") ||
    !idempotencyKey
  ) {
    throw new Error("Dados da cobrança inválidos");
  }

  const value = amount.toFixed(2);

  // Validade solicitada ao Mercado Pago: 1 hora
  const body = JSON.stringify({
    type: "online",
    processing_mode: "automatic",
    external_reference:
      `invoice_${invoiceId}_company_${companyId}`,

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
          },
          expiration_time: "PT1H"
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
          Accept: "application/json",
          "X-Idempotency-Key": idempotencyKey
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
              new Error(
                "Resposta inválida do Mercado Pago"
              )
            );
          }

          const statusCode = response.statusCode || 0;

          if (statusCode < 200 || statusCode >= 300) {
            console.error(
              "Mercado Pago HTTP:",
              statusCode,
              "Código:",
              result?.code || result?.error || "unknown"
            );

            return reject(
              new Error(
                `Falha ao criar cobrança. HTTP ${statusCode}`
              )
            );
          }

          const payment =
            result.transactions?.payments?.[0];

          const qrCode =
            payment?.payment_method?.qr_code;

          if (
            !result.id ||
            !payment?.id ||
            !qrCode
          ) {
            return reject(
              new Error(
                "Mercado Pago não retornou o Pix completo"
              )
            );
          }

          resolve({
            provider: "mercadopago",
            orderId: String(result.id),
            paymentId: String(payment.id),
            status: payment.status || result.status,
            qrcode: {
              qrcode: qrCode
            },
            valor: {
              original: value
            },
            expiresAt: null
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(
        new Error("Tempo limite do Mercado Pago")
      );
    });

    request.on("error", reject);

    request.write(body);
    request.end();
  });
};

export default CreatePixOrderService;
