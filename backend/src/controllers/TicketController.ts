import { Request, Response } from "express";
import { Op } from "sequelize";
import AppError from "../errors/AppError";
import { getIO } from "../libs/socket";
import Ticket from "../models/Ticket";
import User from "../models/User";
import Queue from "../models/Queue";
import Whatsapp from "../models/Whatsapp";

import CreateTicketService from "../services/TicketServices/CreateTicketService";
import DeleteTicketService from "../services/TicketServices/DeleteTicketService";
import ListTicketsService from "../services/TicketServices/ListTicketsService";
import ShowTicketUUIDService from "../services/TicketServices/ShowTicketFromUUIDService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import ListTicketsServiceReport from "../services/TicketServices/ListTicketsServiceReport";
import UpdateTicketService from "../services/TicketServices/UpdateTicketService";
import ListTicketsServiceKanban from "../services/TicketServices/ListTicketsServiceKanban";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
  status: string;
  date: string;
  updatedAt?: string;
  showAll: string;
  withUnreadMessages: string;
  queueIds: string;
  tags: string;
  users: string;
};

interface TicketData {
  contactId: number;
  status: string;
  queueId: number | null;
  userId: number | null;
  whatsappId: string;
  useIntegration: boolean;
  promptId: number;
  integrationId: number;
}

type IndexQueryReport = {
  searchParam: string;
  contactId: string;
  whatsappId: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  queueIds: string;
  tags: string;
  users: string;
  page: string;
  pageSize: string;
};

const isAdmin = (req: Request): boolean => req.user.profile === "admin";

const requireAdmin = (req: Request): void => {
  if (!isAdmin(req)) {
    throw new AppError("Ação permitida apenas para administradores.", 403);
  }
};

// Um usuário comum pode ver seu atendimento ou um ticket desatribuído.
// O envio continua exigindo atribuição efetiva no MessageController.
const checkTicketReadPermission = (req: Request, ticket: Ticket): void => {
  if (
    !isAdmin(req) &&
    ticket.userId != null &&
    Number(ticket.userId) !== Number(req.user.id)
  ) {
    throw new AppError("Este atendimento pertence a outro atendente.", 403);
  }
};

// Evita a atribuição a usuários, filas e conexões de outra empresa.
const validateTicketReferences = async (
  data: TicketData,
  companyId: number
): Promise<void> => {
  if (data.userId !== undefined && data.userId !== null) {
    const user = await User.findOne({
      where: { id: Number(data.userId), companyId }
    });
    if (!user) {
      throw new AppError("Atendente inválido para esta empresa.", 403);
    }
  }

  if (data.queueId !== undefined && data.queueId !== null) {
    const queue = await Queue.findOne({
      where: { id: Number(data.queueId), companyId }
    });
    if (!queue) {
      throw new AppError("Fila inválida para esta empresa.", 403);
    }
  }

  if (data.whatsappId !== undefined && data.whatsappId !== null && data.whatsappId !== "") {
    const whatsapp = await Whatsapp.findOne({
      where: { id: Number(data.whatsappId), companyId }
    });
    if (!whatsapp) {
      throw new AppError("Conexão inválida para esta empresa.", 403);
    }
  }
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const {
    pageNumber,
    status,
    date,
    updatedAt,
    searchParam,
    showAll,
    queueIds: queueIdsStringified,
    tags: tagIdsStringified,
    users: userIdsStringified,
    withUnreadMessages
  } = req.query as IndexQuery;

  const userId = req.user.id;
  const { companyId } = req.user;
  const queueIds: number[] = queueIdsStringified ? JSON.parse(queueIdsStringified) : [];
  const tagsIds: number[] = tagIdsStringified ? JSON.parse(tagIdsStringified) : [];
  const usersIds: number[] = userIdsStringified ? JSON.parse(userIdsStringified) : [];

  const { tickets, count, hasMore } = await ListTicketsService({
    searchParam,
    tags: tagsIds,
    users: usersIds,
    pageNumber,
    status,
    date,
    updatedAt,
    showAll: isAdmin(req) ? showAll : "false",
    userId,
    queueIds,
    withUnreadMessages,
    companyId
  });

  return res.status(200).json({ tickets, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { contactId, status, userId, queueId, whatsappId }: TicketData = req.body;
  const { companyId } = req.user;

  const effectiveUserId = !isAdmin(req) && userId == null
    ? Number(req.user.id)
    : userId;

  if (!isAdmin(req)) {
    if (Number(effectiveUserId) !== Number(req.user.id)) {
      throw new AppError("Você só pode abrir atendimentos para si mesmo.", 403);
    }
    // CreateTicketService atualiza um ticket que já exista; não permitir
    // que essa rota seja usada para tomar um atendimento ocupado.
    const occupied = await Ticket.findOne({
      where: {
        contactId,
        companyId,
        status: { [Op.in]: ["open", "pending", "group"] },
        userId: { [Op.not]: null, [Op.ne]: Number(req.user.id) }
      }
    });
    if (occupied) {
      throw new AppError("Este contato já está em atendimento com outra pessoa.", 403);
    }
  }

  await validateTicketReferences({ ...req.body, userId: effectiveUserId } as TicketData, companyId);

  const ticket = await CreateTicketService({
    contactId,
    status,
    userId: effectiveUserId,
    companyId,
    queueId,
    whatsappId
  });

  const io = getIO();
  io.to(ticket.status).emit(`company-${companyId}-ticket`, {
    action: "update",
    ticket
  });
  return res.status(200).json(ticket);
};

export const kanban = async (req: Request, res: Response): Promise<Response> => {
  const {
    pageNumber,
    status,
    date,
    updatedAt,
    searchParam,
    showAll,
    queueIds: queueIdsStringified,
    tags: tagIdsStringified,
    users: userIdsStringified,
    withUnreadMessages
  } = req.query as IndexQuery;

  const userId = req.user.id;
  const { companyId } = req.user;
  const queueIds: number[] = queueIdsStringified ? JSON.parse(queueIdsStringified) : [];
  const tagsIds: number[] = tagIdsStringified ? JSON.parse(tagIdsStringified) : [];
  const usersIds: number[] = userIdsStringified ? JSON.parse(userIdsStringified) : [];

  const { tickets, count, hasMore } = await ListTicketsServiceKanban({
    searchParam,
    tags: tagsIds,
    users: usersIds,
    pageNumber,
    status,
    date,
    updatedAt,
    showAll: isAdmin(req) ? showAll : "false",
    userId,
    queueIds,
    withUnreadMessages,
    companyId
  });

  return res.status(200).json({ tickets, count, hasMore });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { companyId } = req.user;
  const ticket = await ShowTicketService(ticketId, companyId);
  checkTicketReadPermission(req, ticket);
  return res.status(200).json(ticket);
};

export const showFromUUID = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { uuid } = req.params;
  const { companyId } = req.user;
  const ticket = await ShowTicketUUIDService(uuid, companyId);
  checkTicketReadPermission(req, ticket);
  return res.status(200).json(ticket);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId } = req.params;
  const ticketData: TicketData = req.body;
  const { companyId } = req.user;
  const existingTicket = await ShowTicketService(ticketId, companyId);

  if (!isAdmin(req)) {
    const currentUserId = Number(req.user.id);

    // Ninguém pode tomar o ticket atribuído a outro atendente.
    if (
      existingTicket.userId != null &&
      Number(existingTicket.userId) !== currentUserId
    ) {
      throw new AppError("Este atendimento pertence a outro atendente.", 403);
    }

    // Ticket livre: só pode ser assumido pelo próprio atendente.
    if (
      existingTicket.userId == null &&
      Number(ticketData.userId) !== currentUserId
    ) {
      throw new AppError("Assuma o atendimento antes de alterá-lo.", 403);
    }
  }

  // O serviço atual atualiza esses campos mesmo quando não vieram no body.
  // Preservar os dados existentes evita desatribuições acidentais.
  const normalizedTicketData: TicketData = {
    ...ticketData,
    status: ticketData.status === undefined ? existingTicket.status : ticketData.status,
    userId: ticketData.userId === undefined ? existingTicket.userId : ticketData.userId,
    queueId: ticketData.queueId === undefined ? existingTicket.queueId : ticketData.queueId
  };

  await validateTicketReferences(normalizedTicketData, companyId);

  const { ticket } = await UpdateTicketService({
    ticketData: normalizedTicketData,
    ticketId,
    companyId
  });

  return res.status(200).json(ticket);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  requireAdmin(req);
  const { ticketId } = req.params;
  const { companyId } = req.user;

  await ShowTicketService(ticketId, companyId);
  const ticket = await DeleteTicketService(ticketId);

  const io = getIO();
  io.to(ticketId)
    .to(`company-${companyId}-${ticket.status}`)
    .to(`company-${companyId}-notification`)
    .to(`queue-${ticket.queueId}-${ticket.status}`)
    .to(`queue-${ticket.queueId}-notification`)
    .emit(`company-${companyId}-ticket`, {
      action: "delete",
      ticketId: +ticketId
    });

  return res.status(200).json({ message: "ticket deleted" });
};

export const report = async (req: Request, res: Response): Promise<Response> => {
  // A consulta SQL do relatório precisa de filtros adicionais e parâmetros
  // seguros antes que possa ser disponibilizada a atendentes comuns.
  requireAdmin(req);

  const {
    searchParam,
    contactId,
    whatsappId: whatsappIdsStringified,
    dateFrom,
    dateTo,
    status: statusStringified,
    queueIds: queueIdsStringified,
    tags: tagIdsStringified,
    users: userIdsStringified,
    page: pageNumber,
    pageSize
  } = req.query as IndexQueryReport;

  const userId = req.user.id;
  const { companyId } = req.user;
  const queueIds: number[] = queueIdsStringified ? JSON.parse(queueIdsStringified) : [];
  const whatsappIds: string[] = whatsappIdsStringified ? JSON.parse(whatsappIdsStringified) : [];
  const tagsIds: number[] = tagIdsStringified ? JSON.parse(tagIdsStringified) : [];
  const usersIds: number[] = userIdsStringified ? JSON.parse(userIdsStringified) : [];
  const statusIds: string[] = statusStringified ? JSON.parse(statusStringified) : [];

  const { tickets, totalTickets } = await ListTicketsServiceReport(
    companyId,
    {
      searchParam,
      queueIds,
      tags: tagsIds,
      users: usersIds,
      status: statusIds,
      dateFrom,
      dateTo,
      userId,
      contactId,
      whatsappId: whatsappIds
    },
    +pageNumber,
    +pageSize
  );

  return res.status(200).json({ tickets, totalTickets });
};

export const closeAll = async (req: Request, res: Response): Promise<Response> => {
  requireAdmin(req);
  const { companyId } = req.user;
  const { status }: TicketData = req.body;

  if (typeof status !== "string" || !["open", "pending", "group"].includes(status)) {
    throw new AppError("Status inválido para encerramento em massa.", 400);
  }

  const tickets = await Ticket.findAll({
    where: { companyId, status },
    order: [["updatedAt", "DESC"]]
  });

  await Promise.all(tickets.map(async ticket => {
    const oldStatus = ticket.status;
    await ticket.update({
      status: "closed",
      useIntegration: false,
      promptId: null,
      integrationId: null,
      unreadMessages: 0
    });

    const io = getIO();
    io.to(`${ticket.id}`)
      .to(`company-${companyId}-${oldStatus}`)
      .to(`company-${companyId}-notification`)
      .to(`queue-${ticket.queueId}-${oldStatus}`)
      .to(`queue-${ticket.queueId}-notification`)
      .emit(`company-${companyId}-ticket`, {
        action: "delete",
        ticketId: ticket.id
      });
  }));

  return res.status(200).json();
};
