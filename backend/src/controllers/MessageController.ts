import { Request, Response } from "express";
import AppError from "../errors/AppError";

import formatBody from "../helpers/Mustache";
import SetTicketMessagesAsRead from "../helpers/SetTicketMessagesAsRead";
import { getIO } from "../libs/socket";
import Ticket from "../models/Ticket";
import Message from "../models/Message";
import Queue from "../models/Queue";
import User from "../models/User";
import Whatsapp from "../models/Whatsapp";
import { lookup } from 'mime-types';
import { isNil } from "lodash";
import QuickMessage from "../models/QuickMessage";
import CreateOrUpdateContactService from "../services/ContactServices/CreateOrUpdateContactService";
import SendWhatsAppReaction from "../services/WbotServices/SendWhatsAppReaction";
import ListMessagesService from "../services/MessageServices/ListMessagesService";
import FindOrCreateTicketService from "../services/TicketServices/FindOrCreateTicketService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import UpdateTicketService from "../services/TicketServices/UpdateTicketService";
import CheckContactNumber from "../services/WbotServices/CheckNumber";
import DeleteWhatsAppMessage from "../services/WbotServices/DeleteWhatsAppMessage";
import GetProfilePicUrl from "../services/WbotServices/GetProfilePicUrl";
import ShowContactService from "../services/ContactServices/ShowContactService";
import SendWhatsAppMedia from "../services/WbotServices/SendWhatsAppMedia";
//import SendWhatsAppMediaInternal from "../services/WbotServices/SendWhatsAppMediaInternal";
import path from "path";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";
import EditWhatsAppMessage from "../services/WbotServices/EditWhatsAppMessage";
import ShowMessageService, { GetWhatsAppFromMessage } from "../services/MessageServices/ShowMessageService";
type IndexQuery = {
  pageNumber: string;
};

type MessageData = {
  body: string;
  fromMe: boolean;
  read: boolean;
  quotedMsg?: Message;
  number?: string;
  closeTicket?: true;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { pageNumber } = req.query as IndexQuery;
  const { companyId, profile } = req.user;
  const queues: number[] = [];

  if (profile !== "admin") {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Queue, as: "queues" }]
    });
    user.queues.forEach(queue => {
      queues.push(queue.id);
    });
  }

  const { count, messages, ticket, hasMore } = await ListMessagesService({
    pageNumber,
    ticketId,
    companyId,
    queues
  });

  SetTicketMessagesAsRead(ticket);

  return res.json({ count, messages, ticket, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { body, quotedMsg }: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];
  const { companyId } = req.user;

  const ticket = await ShowTicketService(ticketId, companyId);

  // O admin pode responder a tickets da propria empresa.
  // Atendentes so podem responder aos tickets atribuidos a eles.
  // Tickets sem responsavel precisam ser assumidos antes do envio.
  if (
    req.user.profile !== "admin" &&
    (ticket.userId == null || Number(ticket.userId) !== Number(req.user.id))
  ) {
    throw new AppError("Este atendimento pertence a outro atendente ou precisa ser assumido.", 403);
  }

  SetTicketMessagesAsRead(ticket);

  console.log('bodyyyyyyyyyy:', body)
  if (medias) {
    await Promise.all(
      medias.map(async (media: Express.Multer.File, index) => {
        await SendWhatsAppMedia({ media, ticket, body: Array.isArray(body) ? body[index] : body });
      })
