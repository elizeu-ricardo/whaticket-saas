
import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("PaymentTransactions", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },

      invoiceId: {
        type: DataTypes.INTEGER,
        allowNull: false
      },

      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false
      },

      provider: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "mercadopago"
      },

      orderId: {
        type: DataTypes.STRING,
        allowNull: true
      },

      paymentId: {
        type: DataTypes.STRING,
        allowNull: true
      },

      qrCode: {
        type: DataTypes.TEXT,
        allowNull: true
      },

      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true
      },

      idempotencyKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },

      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pending"
      },

      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
      },

      paidAt: {
        type: DataTypes.DATE,
        allowNull: true
      },

      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },

      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });

    await queryInterface.addIndex(
      "PaymentTransactions",
      ["provider", "orderId"],
      {
        unique: true,
        name: "payment_transactions_provider_order_unique"
      }
    );

    await queryInterface.addIndex(
      "PaymentTransactions",
      ["provider", "paymentId"],
      {
        unique: true,
        name: "payment_transactions_provider_payment_unique"
      }
    );

    await queryInterface.addIndex(
      "PaymentTransactions",
      ["invoiceId", "companyId"],
      {
        name: "payment_transactions_invoice_company_idx"
      }
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("PaymentTransactions");
  }
};
