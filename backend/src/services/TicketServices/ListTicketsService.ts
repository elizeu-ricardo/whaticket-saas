import { Op, Includeable } from "sequelize";
import { startOfDay, endOfDay, parseISO, isValid } from "date-fns";

import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import User from "../../models/User";
import ShowUserService from "../UserServices/ShowUserService";
import Tag from "../../models/Tag";
import TicketTag from "../../models/TicketTag";
import { intersection } from "lodash";
import Whatsapp from "../../models/Whatsapp";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  status?: string;
  date?: string;
  updatedAt?: string;
  showAll?: string;
  userId: string;
  withUnreadMessages?: string;
  queueIds: number[];
  tags: number[];
  users: number[];
  companyId: number;
}

interface Response {
  tickets: Ticket[];
  count: number;
  hasMore: boolean;
}

const ListTicketsService = async ({
  searchParam = "",
  pageNumber = "1",
  queueIds,
  tags,
  users,
  status,
  date,
  updatedAt,
  showAll,
  userId,
  withUnreadMessages,
  companyId
}: Request): Promise<Response> => {
  const currentUser = await ShowUserService(userId);

  if (Number(currentUser.companyId) !== Number(companyId)) {
    throw new AppError("ERR_ACCESS_DENIED", 403);
  }

  const selectedQueueIds = Array.isArray(queueIds)
    ? queueIds.map(Number).filter(id => Number.isInteger(id) && id > 0)
    : [];

  // Empresa e permissoes obrigatorias permanecem no AND.
  const conditions: any[] = [{ companyId }];

  if (currentUser.profile !== "admin") {
    const allowedQueueIds = (currentUser.queues || []).map(queue => Number(queue.id));
    const pendingQueueIds = selectedQueueIds.length > 0
      ? allowedQueueIds.filter(id => selectedQueueIds.includes(id))
      : allowedQueueIds;

    // Uma conversa sem fila continua disponivel, mesmo com filtro selecionado.
    const availableQueueCondition = pendingQueueIds.length > 0
      ? { [Op.or]: [{ [Op.in]: pendingQueueIds }, { [Op.is]: null }] }
      : { [Op.is]: null };

    conditions.push({
      [Op.or]: [
        // Sempre mostrar os tickets do proprio atendente, mesmo fora da fila selecionada.
        { userId: currentUser.id },
        // Tickets disponiveis: sem responsavel, pendentes e em fila autorizada.
        {
          userId: { [Op.is]: null },
          status: "pending",
          queueId: availableQueueCondition
        }
      ]
    });
  }

  const includeCondition: Includeable[] = [
    {
      model: Contact,
      as: "contact",
      attributes: ["id", "name", "number", "email", "profilePicUrl"]
    },
    {
      model: Queue,
      as: "queue",
      attributes: ["id", "name", "color"]
    },
    {
      model: User,
      as: "user",
      attributes: ["id", "name"]
    },
    {
      model: Tag,
      as: "tags",
      attributes: ["id", "name", "color"]
    },
    {
      model: Whatsapp,
      as: "whatsapp",
      attributes: ["name"]
    }
  ];

  if (status) {
    conditions.push({ status });
  }

  // CRITICO: nao aplicar o filtro de fila globalmente a quem ja tem o ticket.
  // Admin com showAll=true deve ver todos os tickets da propria empresa.
  // Admin com showAll=false pode filtrar filas, mas nunca perde seus tickets.
  if (
    currentUser.profile === "admin" &&
    showAll !== "true" &&
    selectedQueueIds.length > 0
  ) {
    conditions.push({
      [Op.or]: [
        { queueId: { [Op.in]: selectedQueueIds } },
        { userId: currentUser.id }
      ]
    });
  }

  const term = (searchParam || "").trim();
  if (term) {
    const pattern = `%${term}%`;

    includeCondition.push({
      model: Message,
      as: "messages",
      attributes: ["id", "body"],
      where: { body: { [Op.iLike]: pattern } },
      required: false,
      duplicating: false
    });

    conditions.push({
      [Op.or]: [
        { "$contact.name$": { [Op.iLike]: pattern } },
        { "$contact.number$": { [Op.iLike]: pattern } },
        { "$messages.body$": { [Op.iLike]: pattern } }
      ]
    });
  }

  if (date) {
    const parsed = parseISO(date);
    if (!isValid(parsed)) throw new AppError("ERR_INVALID_DATE", 400);

    conditions.push({
      createdAt: { [Op.between]: [startOfDay(parsed), endOfDay(parsed)] }
    });
  }

  if (updatedAt) {
    const parsed = parseISO(updatedAt);
    if (!isValid(parsed)) throw new AppError("ERR_INVALID_DATE", 400);

    conditions.push({
      updatedAt: { [Op.between]: [startOfDay(parsed), endOfDay(parsed)] }
    });
  }

  if (withUnreadMessages === "true") {
    conditions.push({ unreadMessages: { [Op.gt]: 0 } });
  }

  if (Array.isArray(tags) && tags.length > 0) {
    const ticketIdsByTag = await Promise.all(
      tags.map(async tagId => {
        const ticketTags = await TicketTag.findAll({ where: { tagId } });
        return ticketTags.map(ticketTag => ticketTag.ticketId);
      })
    );

    conditions.push({
      id: { [Op.in]: intersection(...ticketIdsByTag) }
    });
  }

  // Filtro de usuario nunca pode aumentar os direitos do usuario logado.
  if (Array.isArray(users) && users.length > 0) {
    conditions.push({ userId: { [Op.in]: users } });
  }

  const page = Math.max(1, Math.floor(Number(pageNumber) || 1));
  const limit = 40;
  const offset = limit * (page - 1);

  const { count, rows: tickets } = await Ticket.findAndCountAll({
    where: { [Op.and]: conditions },
    include: includeCondition,
    distinct: true,
    limit,
    offset,
    order: [["updatedAt", "DESC"]],
    subQuery: false
  });

  return {
    tickets,
    count,
    hasMore: count > offset + tickets.length
  };
};

export default ListTicketsService;
