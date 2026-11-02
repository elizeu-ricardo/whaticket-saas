
import { UniqueConstraintError } from "sequelize";
import { v4 as uuidv4 } from "uuid";

import PaymentTransaction from "../../models/PaymentTransaction";

interface ReservePixData {
  invoiceId: number;
  companyId: number;
  amount: number;
}

interface ReservePixResult {
  transaction: PaymentTransaction;
  created: boolean;
}

const ReservePixTransactionService = async ({
  invoiceId,
  companyId,
  amount
}: ReservePixData): Promise<ReservePixResult> => {

  if (
    !Number.isSafeInteger(invoiceId) ||
    invoiceId <= 0 ||
    !Number.isSafeInteger(companyId) ||
    companyId <= 0 ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error("Dados da fatura inválidos");
  }

  const idempotencyKey = uuidv4();

  try {
    // Reserva a tentativa antes de chamar o Mercado Pago
    const transaction = await PaymentTransaction.create({
      invoiceId,
      companyId,
      provider: "mercadopago",
      amount: amount.toFixed(2),
      idempotencyKey,
      status: "creating",
      orderId: null,
      paymentId: null,
      qrCode: null,
      expiresAt: null,
      paidAt: null
    } as any);

    return {
      transaction,
      created: true
    };

  } catch (error) {

    // Outra requisição pode ter reservado a fatura
    // enquanto esta solicitação estava sendo executada.
    if (error instanceof UniqueConstraintError) {

      const existing = await PaymentTransaction.findOne({
        where: {
          invoiceId,
          companyId,
          provider: "mercadopago",
          status: [
            "creating",
            "pending",
            "action_required",
            "processing"
          ]
        },
        order: [["createdAt", "DESC"]]
      });

      if (!existing) {
        throw new Error(
          "Conflito de reserva. Tente novamente."
        );
      }

      if (
        Math.round(Number(existing.amount) * 100) !==
        Math.round(amount * 100)
      ) {
        throw new Error(
          "Conflito no valor da cobrança existente"
        );
      }

      return {
        transaction: existing,
        created: false
      };
    }

    throw error;
  }
};

export default ReservePixTransactionService;
