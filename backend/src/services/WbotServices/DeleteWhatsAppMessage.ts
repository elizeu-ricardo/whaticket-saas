import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import ShowUserService from "../UserServices/ShowUserService";

interface DeleteWhatsAppMessageRequest {
  messageId: string;
  companyId: number;
  userId: string;
}

const DeleteWhatsAppMessage = async ({
  messageId,
  companyId,
  userId
}: DeleteWhatsAppMessageRequest): Promise<Message> => {
  // A identidade e o perfil sao consultados no banco, nao no corpo da requisicao.
  const user = await ShowUserService(userId);

  if (Number(user.companyId) !== Number(companyId)) {
    throw new AppError("Acesso nao permitido a esta empresa.", 403);
  }

  // Verifica a empresa tanto na mensagem quanto no ticket associado.
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

  // Atendentes comuns so podem excluir mensagens de seus proprios tickets.
  if (
    user.profile !== "admin" &&
    (ticket.userId == null || Number(ticket.userId) !== Number(user.id))
  ) {
    throw new AppError("Este atendimento pertence a outro atendente.", 403);
  }

  // A exclusao para todos no WhatsApp so se aplica a mensagens enviadas
  // pela propria conexao. Mensagens recebidas nao podem ser apagadas assim.
  if (!message.fromMe) {
    throw new AppError("Nao e permitido apagar mensagens recebidas para todos.", 403);
  }

  if (message.isDeleted) {
    throw new AppError("Esta mensagem ja foi marcada como excluida.", 409);
  }

  // Preserva o JID que foi armazenado para a mensagem original, inclusive @lid.
  const remoteJid = message.remoteJid;
  if (!remoteJid || !/@(lid|s\.whatsapp\.net|g\.us)$/.test(remoteJid)) {
    throw new AppError("Identificador do WhatsApp invalido para exclusao.", 400);
  }

  try {
    const wbot = await GetTicketWbot(ticket);

    const messageKey = {
      id: message.id,
      remoteJid,
      fromMe: true,
      ...(message.participant ? { participant: message.participant } : {})
    };

    const result = await wbot.sendMessage(remoteJid, {
      delete: messageKey
    });

    if (!result) {
      throw new Error("O WhatsApp nao confirmou o envio da solicitacao.");
    }
  } catch (error) {
    throw new AppError("ERR_DELETE_WAPP_MSG", 502);
  }

  // Atualiza o historico local apenas depois da tentativa aceita pelo Baileys.
  await message.update({ isDeleted: true });

  return message;
};

export default DeleteWhatsAppMessage;
