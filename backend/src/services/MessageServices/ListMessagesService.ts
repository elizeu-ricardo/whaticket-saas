import { FindOptions } from "sequelize/types";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Queue from "../../models/Queue";
import ShowTicketService from "../TicketServices/ShowTicketService";
import ShowUserService from "../UserServices/ShowUserService";

interface Request {
  ticketId: string;
  companyId: number;
  userId: string;
  pageNumber?: string;
  // Mantido por compatibilidade com chamadas existentes.
  // As filas autorizadas sao consultadas diretamente no banco.
  queues?: number[];
}

interface Response {
  messages: Message[];
  ticket: Ticket;
  count: number;
  hasMore: boolean;
}

const ListMessagesService = async ({
  pageNumber = "1",
  ticketId,
  companyId,
  userId
}: Request): Promise<Response> => {
  // Confirma que o ticket pertence a empresa da sessao.
  const ticket = await ShowTicketService(ticketId, companyId);
  const currentUser = await ShowUserService(userId);

  // Nunca confia em perfil, filas ou empresa enviados pelo navegador.
  if (Number(currentUser.companyId) !== Number(companyId)) {
    throw new AppError("ERR_ACCESS_DENIED", 403);
  }

  if (currentUser.profile !== "admin") {
    const ownsTicket =
      ticket.userId != null && Number(ticket.userId) === Number(currentUser.id);

    const allowedQueueIds = (currentUser.queues || []).map(queue => Number(queue.id));
    const availableForPickup =
      ticket.status === "pending" &&
      ticket.userId == null &&
      (ticket.queueId == null || allowedQueueIds.includes(Number(ticket.queueId)));

    if (!ownsTicket && !availableForPickup) {
      throw new AppError("ERR_FORBIDDEN_TICKET_ACCESS", 403);
    }
  }

  // Consultar mensagens apenas depois de validar a autorizacao.
  const limit = 20;
  const offset = limit * (+pageNumber - 1);

  const options: FindOptions = {
    where: {
      ticketId,
      companyId
    }
  };

  const { count, rows: messages } = await Message.findAndCountAll({
    ...options,
    limit,
    include: [
      "contact",
      {
        model: Message,
        as: "quotedMsg",
        include: ["contact"]
      },
      {
        model: Queue,
        as: "queue"
      }
    ],
    offset,
    order: [["createdAt", "DESC"]]
  });

  const hasMore = count > offset + messages.length;

  return {
    messages: messages.reverse(),
    ticket,
    count,
    hasMore
  };
};

export default ListMessagesService;
