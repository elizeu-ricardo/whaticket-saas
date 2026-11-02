
import https from "https";

interface PixOrderDetails {
  orderId: string;
  externalReference: string;
  orderStatus: string;
  paymentId: string | null;
  paymentStatus: string;
  qrCode: string | null;
  amount: string;
}

const GetPixOrderService = async (
  orderId: string
): Promise<PixOrderDetails> => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      "MERCADOPAGO_ACCESS_TOKEN não configurado"
    );
  }

  if (
    !orderId ||
    !/^[A-Za-z0-9_-]{10,100}$/.test(orderId)
  ) {
    throw new Error("Identificador da order inválido");
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: "api.mercadopago.com",
        path: `/v1/orders/${encodeURIComponent(orderId)}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        timeout: 15000
      },
      response => {
        let raw = "";

        response.on("data", chunk => {
          raw += chunk;

          if (raw.length > 1024 * 1024) {
            request.destroy(
              new Error("Resposta excessivamente grande")
            );
          }
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

          const statusCode = response.statusCode || 0;

          if (statusCode < 200 || statusCode >= 300) {
            return reject(
              new Error(
                `Falha ao consultar order. HTTP ${statusCode}`
              )
            );
          }

          if (
            !result.id ||
            String(result.id) !== orderId
          ) {
            return reject(
              new Error("Identificador da order divergente")
            );
          }

          const payment =
            result.transactions?.payments?.[0];

          resolve({
            orderId: String(result.id),
            externalReference:
              result.external_reference || "",
            orderStatus: result.status || "",
            paymentId: payment?.id
              ? String(payment.id)
              : null,
            paymentStatus: payment?.status || "",
            qrCode:
              payment?.payment_method?.qr_code || null,
            amount: String(result.total_amount || "")
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(
        new Error("Tempo limite na consulta da order")
      );
    });

    request.on("error", reject);
    request.end();
  });
};

export default GetPixOrderService;
