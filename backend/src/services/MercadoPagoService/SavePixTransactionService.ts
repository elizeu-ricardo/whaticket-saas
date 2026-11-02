
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
    invoiceId <= 0 ||
    !Number.isSafeInteger(companyId) ||
    companyId <= 0 ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !idempotencyKey ||
    !orderId ||
    !qrCode
  ) {
    throw new Error("Dados da transação inválidos");
  }

  // Localizar a reserva criada anteriormente
  const transaction = await PaymentTransaction.findOne({
    where: {
      invoiceId,
      companyId,
      provider: "mercadopago",
      idempotencyKey
    }
  });

  if (!transaction) {
    throw new Error(
      "Reserva da cobrança Pix não encontrada"
    );
  }

  // Verificar o valor reservado
  if (
    Math.round(Number(transaction.amount) * 100) !==
    Math.round(amount * 100)
  ) {
    throw new Error(
      "Valor da reserva divergente"
    );
  }

  // Não sobrescrever uma cobrança já confirmada
  if (
    transaction.status === "paid" ||
    transaction.status === "processed"
  ) {
    throw new Error(
      "Transação já processada"
    );
  }

  // Não associar uma order diferente à mesma reserva
  if (
    transaction.orderId &&
    transaction.orderId !== orderId
  ) {
    throw new Error(
      "Conflito no identificador da cobrança"
    );
  }

  // Atualização condicional da reserva
  const [updatedCount] = await PaymentTransaction.update(
    {
      orderId,
      paymentId: paymentId || null,
      qrCode,
      status: "action_required",
      expiresAt
    },
    {
      where: {
        id: transaction.id,
        invoiceId,
        companyId,
        provider: "mercadopago",
        idempotencyKey,
        status: "creating",
        orderId: null
      }
    }
  );

  if (updatedCount !== 1) {
    throw new Error(
      "A reserva foi alterada durante o processamento"
    );
  }

  const updated = await PaymentTransaction.findByPk(
    transaction.id
  );

  if (!updated) {
    throw new Error(
      "Transação não encontrada após atualização"
    );
  }

  return updated;
};

export default SavePixTransactionService;
