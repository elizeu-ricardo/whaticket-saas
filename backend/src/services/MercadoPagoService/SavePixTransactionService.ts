
import PaymentTransaction from "../../models/PaymentTransaction";

interface PixTransactionData {
  invoiceId: number;
  companyId: number;
  amount: number;
  idempotencyKey: string;
  orderId: string;
  paymentId?: string;
  qrCode: string;
  status?: string;
  expiresAt?: Date | null;
}

const SavePixTransactionService = async ({
  invoiceId,
  companyId,
  amount,
  idempotencyKey,
  orderId,
  paymentId,
  qrCode,
  status = "pending",
  expiresAt = null
}: PixTransactionData): Promise<PaymentTransaction> => {

  if (
    !Number.isSafeInteger(invoiceId) ||
    !Number.isSafeInteger(companyId) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !idempotencyKey ||
    !orderId ||
    !qrCode
  ) {
    throw new Error("Dados da transação inválidos");
  }

  const existing = await PaymentTransaction.findOne({
    where: {
      idempotencyKey
    }
  });

  if (existing) {
    if (
      existing.invoiceId !== invoiceId ||
      existing.companyId !== companyId ||
      Number(existing.amount) !== amount ||
      existing.orderId !== orderId
    ) {
      throw new Error(
        "Conflito entre registros de pagamento"
      );
    }

    return existing;
  }

  const transaction = await PaymentTransaction.create({
    invoiceId,
    companyId,
    provider: "mercadopago",
    amount,
    idempotencyKey,
    orderId,
    paymentId: paymentId || null,
    qrCode,
    status,
    expiresAt,
    paidAt: null
  } as any);

  return transaction;
};

export default SavePixTransactionService;
