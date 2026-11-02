
import sequelize from "../../database";
import PaymentTransaction from "../../models/PaymentTransaction";
import Invoices from "../../models/Invoices";
import Company from "../../models/Company";

interface ConfirmPixData {
  orderId: string;
  paymentId: string | null;
  externalReference: string;
  amount: string;
  orderStatus: string;
  paymentStatus: string;
  orderStatusDetail: string;
}

interface ConfirmPixResult {
  confirmed: boolean;
  alreadyPaid: boolean;
  companyId: number;
  dueDate: string | null;
}

const ConfirmPixPaymentService = async ({
  orderId,
  paymentId,
  externalReference,
  amount,
  orderStatus,
  paymentStatus,
  orderStatusDetail
}: ConfirmPixData): Promise<ConfirmPixResult> => {

  // Somente pagamentos efetivamente creditados
  if (
    orderStatus !== "processed" ||
    paymentStatus !== "processed" ||
    orderStatusDetail !== "accredited"
  ) {
    throw new Error(
      "Pagamento ainda não confirmado como creditado"
    );
  }

  if (!orderId || !paymentId) {
    throw new Error("Identificadores do pagamento ausentes");
  }

  return sequelize.transaction(async transaction => {

    // Localizar primeiro a transação por Order ID.
    const paymentRecord = await PaymentTransaction.findOne({
      where: {
        provider: "mercadopago",
        orderId
      },
      transaction
    });

    if (!paymentRecord) {
      throw new Error("Cobrança não registrada no banco");
    }

    // Bloquear a fatura para impedir renovações simultâneas
    const invoice = await Invoices.findOne({
      where: {
        id: paymentRecord.invoiceId,
        companyId: paymentRecord.companyId
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!invoice) {
      throw new Error("Fatura não encontrada");
    }

    // Reconsultar e bloquear o registro de pagamento
    const payment = await PaymentTransaction.findOne({
      where: {
        id: paymentRecord.id,
        provider: "mercadopago",
        orderId
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!payment) {
      throw new Error("Registro de pagamento não encontrado");
    }

    const expectedReference =
      `invoice_${invoice.id}_company_${invoice.companyId}`;

    if (externalReference !== expectedReference) {
      throw new Error("Referência da cobrança divergente");
    }

    if (
      payment.paymentId &&
      String(payment.paymentId) !== String(paymentId)
    ) {
      throw new Error("Payment ID divergente");
    }

    const invoiceCents =
      Math.round(Number(invoice.value) * 100);

    const paymentCents =
      Math.round(Number(payment.amount) * 100);

    const receivedCents =
      Math.round(Number(amount) * 100);

    if (
      !Number.isSafeInteger(invoiceCents) ||
      !Number.isSafeInteger(paymentCents) ||
      !Number.isSafeInteger(receivedCents) ||
      invoiceCents <= 0 ||
      invoiceCents !== paymentCents ||
      invoiceCents !== receivedCents
    ) {
      throw new Error("Valor da cobrança divergente");
    }

    const company = await Company.findByPk(
      invoice.companyId,
      {
        transaction,
        lock: transaction.LOCK.UPDATE
      }
    );

    if (!company) {
      throw new Error("Empresa não encontrada");
    }

    // Idempotência: não renovar novamente
    if (invoice.status === "paid") {
      if (payment.status !== "processed") {
        await payment.update({
          status: "processed",
          paymentId,
          paidAt: payment.paidAt || new Date()
        }, { transaction });
      }

      return {
        confirmed: true,
        alreadyPaid: true,
        companyId: invoice.companyId,
        dueDate: company.dueDate || null
      };
    }

    // Calcular a próxima data de vencimento.
    // Preserva vencimento futuro quando existente.
    const today = new Date();
    const currentDueDate = company.dueDate
      ? new Date(`${company.dueDate}T12:00:00Z`)
      : new Date(NaN);

    const baseDate =
      !Number.isNaN(currentDueDate.getTime()) &&
      currentDueDate > today
        ? currentDueDate
        : today;

    const expiresAt = new Date(baseDate);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 30);

    const nextDueDate =
      expiresAt.toISOString().split("T")[0];

    // As três alterações são atômicas
    await payment.update({
      status: "processed",
      paymentId,
      paidAt: new Date()
    }, { transaction });

    await invoice.update({
      status: "paid"
    }, { transaction });

    await company.update({
      dueDate: nextDueDate
    }, { transaction });

    return {
      confirmed: true,
      alreadyPaid: false,
      companyId: invoice.companyId,
      dueDate: nextDueDate
    };
  });
};

export default ConfirmPixPaymentService;
