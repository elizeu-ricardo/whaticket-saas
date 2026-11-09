
import * as Sentry from "@sentry/node";
import { WAMessage } from "@whiskeysockets/baileys";
import { Op } from "sequelize";

import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import formatBody from "../../helpers/Mustache";
import { map_msg } from "../../utils/global";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
  isForwarded?: boolean;
}

const resolveRecipientJid = async (ticket: Ticket): Promise<string> => {
  if (ticket.isGroup) {
    return `${ticket.contact.number}@g.us`;
  }

  // Recupera o identificador original de uma mensagem recebida
  // no mesmo atendimento, preservando @lid quando utilizado.
  const incomingMessage = await Message.findOne({
    attributes: ["remoteJid"],
    where: {
      ticketId: ticket.id,
      companyId: ticket.companyId,
      fromMe: false,
      [Op.or]: [
        { remoteJid: { [Op.like]: "%@lid" } },
        { remoteJid: { [Op.like]: "%@s.whatsapp.net" } }
      ]
    },
    order: [["createdAt", "DESC"]]
  });

  const originalJid = incomingMessage?.remoteJid;

  if (
    originalJid &&
    /^\d+@(lid|s\.whatsapp\.net)$/.test(originalJid)
  ) {
    return originalJid;
  }

  // Compatibilidade com conversas iniciadas pelo atendente,
  // que ainda nao possuem mensagens recebidas.
  const number = String(ticket.contact.number || "").trim();

  if (!/^\d+$/.test(number)) {
    throw new AppError("ERR_INVALID_WAPP_NUMBER");
  }

  return `${number}@s.whatsapp.net`;
};

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg,
  isForwarded = false
}: Request): Promise<WAMessage> => {
  try {
    const wbot = await GetTicketWbot(ticket);

    const recipientJid = await resolveRecipientJid(ticket);

    let options: any = {};

    if (quotedMsg) {
      const savedMessage = await Message.findOne({
        where: { id: quotedMsg.id }
      });

      if (savedMessage?.dataJson) {
        const originalMessage = JSON.parse(savedMessage.dataJson);

        if (originalMessage?.key && originalMessage?.message) {
          options = {
            quoted: originalMessage
          };
        }
      }
    }

    const formattedBody = formatBody(body, ticket.contact);

    map_msg.set(ticket.contact.number, {
      lastSystemMsg: body
    });

    // Apenas um envio: nao adicionar novamente na fila Redis.
    const sentMessage = await wbot.sendMessage(
      recipientJid,
      {
        text: formattedBody,
        contextInfo: {
          forwardingScore: isForwarded ? 2 : 0,
          isForwarded
        }
      },
      options
    );

    if (!sentMessage) {
      throw new AppError("ERR_SENDING_WAPP_MSG");
    }

    await ticket.update({
      lastMessage: formattedBody
    });

    logger.info(
      `Mensagem enviada ao WhatsApp. Ticket: ${ticket.id}`
    );

    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);

    logger.error(
      `Erro ao enviar mensagem do ticket ${ticket.id}`
    );

    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;
