
import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  DataType
} from "sequelize-typescript";

@Table({ tableName: "PaymentTransactions" })
class PaymentTransaction extends Model<PaymentTransaction> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  invoiceId: number;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  companyId: number;

  @Default("mercadopago")
  @AllowNull(false)
  @Column(DataType.STRING)
  provider: string;

  @Column(DataType.STRING)
  orderId: string;

  @Column(DataType.STRING)
  paymentId: string;

  @Column(DataType.TEXT)
  qrCode: string;

  @AllowNull(false)
  @Column({
    type: DataType.STRING,
    unique: true
  })
  idempotencyKey: string;

  @Default("pending")
  @AllowNull(false)
  @Column(DataType.STRING)
  status: string;

  @AllowNull(false)
  @Column(DataType.DECIMAL(12, 2))
  amount: number;

  @Column(DataType.DATE)
  paidAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default PaymentTransaction;
