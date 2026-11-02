
import crypto from "crypto";

interface WebhookSignatureData {
  signature: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
}

const ValidateWebhookSignatureService = ({
  signature,
  requestId,
  dataId
}: WebhookSignatureData): boolean => {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

  if (!secret || !signature || !requestId || !dataId) {
    return false;
  }

  const signatureParts = signature.split(",");

  const timestamp = signatureParts
    .find(part => part.trim().startsWith("ts="))
    ?.trim()
    .substring(3);

  const receivedHash = signatureParts
    .find(part => part.trim().startsWith("v1="))
    ?.trim()
    .substring(3);

  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !receivedHash ||
    !/^[a-fA-F0-9]{64}$/.test(receivedHash)
  ) {
    return false;
  }

  const normalizedDataId = dataId.toLowerCase();

  const manifest =
    `id:${normalizedDataId};` +
    `request-id:${requestId};` +
    `ts:${timestamp};`;

  const expectedHash = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest();

  const receivedBuffer = Buffer.from(
    receivedHash,
    "hex"
  );

  if (expectedHash.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedHash,
    receivedBuffer
  );
};

export default ValidateWebhookSignatureService;
