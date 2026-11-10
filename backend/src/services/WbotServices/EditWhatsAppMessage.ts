import * as Sentry from "@sentry/node";

import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import ShowUserService from "../UserServices/ShowUserService";

interface Request {
  messageId: string;
  body: string;
  companyId: number;
  userId: string;
}

const EditWhatsAppMessage = async ({
  messageId,
  body,
  companyId,
  userId
}: Request): Promise<{ ticket: Ticket; message: Message }> => {
  if (typeof body !== "string" || !body.trim()) {
    throw new AppError("O texto da mensagem e obrigatorio.", 400);
  }

  // Confirma a identidade e a empresa a partir do usuario autenticado.
  const user = await ShowUserService(userId);

  if (Number(user.companyId) !== Number(companyId)) {
    throw new AppError("Acesso nao permitido a esta empresa.", 403);
  }

  // Restringe a busca a mensagem e ticket da empresa autenticada.
  const message = await Message.findOne({
    where: { id: messageId, companyId },
    include: [
      {
        model: Ticket,
        as: "ticket",
        required: true,
        where: { companyId },
        include: ["contact"]
      }
    ]
  });

  if (!message || !message.ticket) {
    throw new AppError("Mensagem nao encontrada.", 404);
  }

  const { ticket } = message;

  // Um atendente comum so edita mensagens do ticket atribuido a ele.
  if (
    user.profile !== "admin" &&
    (ticket.userId == null || Number(ticket.userId) !== Number(user.id))
  ) {
    throw new AppError("Este atendimento pertence a outro atendente.", 403);
  }

  // A edicao no WhatsApp so pode atingir mensagens que a conexao enviou.
  if (!message.fromMe) {
    throw new AppError("Nao e permitido editar mensagens recebidas.", 403);
  }

  if (message.isDeleted) {
    throw new AppError("Nao e permitido editar uma mensagem excluida.", 409);
  }

  if (!message.dataJson) {
    throw new AppError("Dados originais da mensagem indisponiveis.", 400);
  }

  let originalMessage: any;
  try {
    originalMessage = JSON.parse(message.dataJson);
  } catch (error) {
    throw new AppError("Dados originais da mensagem invalidos.", 400);
  }

  const originalKey = originalMessage && originalMessage.key;
  const remoteJid = String(originalKey && originalKey.remoteJid || "");

  if (
    !originalKey ||
    !originalKey.id ||
    String(originalKey.id) !== String(message.id) ||
    originalKey.fromMe !== true ||
    !/^\d+@(lid|s\.whatsapp\.net|g\.us)$/.test(remoteJid)
  ) {
    throw new AppError("Identificador original da mensagem invalido.", 400);
  }

  // Evita tentar editar uma midia como se fosse texto.
  const originalContent = originalMessage.message;
  if (
    !originalContent ||
    (typeof originalContent.conversation !== "string" &&
      !originalContent.extendedTextMessage)
  ) {
    throw new AppError("Somente mensagens de texto podem ser editadas.", 400);
  }

  const newBody = body.trim();
  const wbot = await GetTicketWbot(ticket);

  try {
    // Preserva o JID da mensagem original, inclusive quando for @lid.
    const sent = await wbot.sendMessage(remoteJid, {
      text: newBody,
      edit: originalKey
    });

    if (!sent) {
      throw new Error("O WhatsApp nao confirmou a solicitacao de edicao.");
    }
  } catch (error) {
    Sentry.captureException(error);
    throw new AppError("ERR_EDITING_WAPP_MSG", 502);
  }

  // Altera o banco apenas depois que o Baileys aceitar a solicitacao.
  await message.update({ body: newBody, isEdited: true });

  return { ticket, message };
};

export default EditWhatsAppMessage;
