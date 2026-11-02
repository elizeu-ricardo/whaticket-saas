
import PaymentTransaction from "../../models/PaymentTransaction";
import GetPixOrderService from "./GetPixOrderService";

interface FindTransactionData {
  invoiceId: number;
  companyId: number;
  amount: number;
}

const FindExistingPixTransactionService = async ({
  invoiceId,
  companyId,
  amount
}: FindTransactionData) => {
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

  const transaction = await PaymentTransaction.findOne({
    where: {
      invoiceId,
      companyId,
      provider: "mercadopago"
    },
    order: [["createdAt", "DESC"]]
  });

  if (!transaction) {
    return {
      found: false,
      transaction: null,
      order: null
    };
  }

  // Uma transação sem orderId ainda não pode
  // ser reconciliada automaticamente.
  if (!transaction.orderId) {
    throw new Error(
      "Transação sem identificador de order"
    );
  }

  // Consulta o estado diretamente no provedor.
  const order = await GetPixOrderService(
    transaction.orderId
  );

  const expectedReference =
    `invoice_${invoiceId}_company_${companyId}`;

  if (order.externalReference !== expectedReference) {
    throw new Error(
      "Referência da cobrança divergente"
    );
  }

  const orderAmount = Number(order.amount);

  if (
    !Number.isFinite(orderAmount) ||
    Math.round(orderAmount * 100) !==
      Math.round(amount * 100)
  ) {
    throw new Error(
      "Valor da cobrança divergente"
    );
  }

  if (
    order.paymentId &&
    transaction.paymentId &&
    order.paymentId !== transaction.paymentId
  ) {
    throw new Error(
      "Identificador de pagamento divergente"
    );
  }

  return {
    found: true,
    transaction,
    order
  };
};

export default FindExistingPixTransactionService;
