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

const ListTicketsServiceKanban = async ({
  searchParam = "",
  pageNumber = "1",
  queueIds,
  tags,
  users,
  status,
  date,
  updatedAt,
  userId,
  withUnreadMessages,
  companyId
}: Request): Promise<Response> => {
  // Nunca confiar em showAll, users ou queueIds como autorizacao.
  // O usuario e suas filas devem vir do banco de dados.
  const currentUser = await ShowUserService(userId);

  if (Number(currentUser.companyId) !== Number(companyId)) {
    throw new AppError("ERR_ACCESS_DENIED", 403);
  }

  // Estes filtros sao sempre combinados com AND e nao podem ser substituidos
  // por busca, data, filtros do Kanban ou parametros do navegador.
  const conditions: any[] = [
    { companyId },
    { status: { [Op.in]: ["pending", "open", "closed"] } }
  ];

  if (currentUser.profile !== "admin") {
    const allowedQueueIds = (currentUser.queues || []).map(queue => queue.id);

    const availableQueueCondition = allowedQueueIds.length > 0
      ? { [Op.or]: [{ [Op.in]: allowedQueueIds }, { [Op.is]: null }] }
      : { [Op.is]: null };

    conditions.push({
      [Op.or]: [
        // Tickets atribuidos ao proprio atendente.
        { userId: currentUser.id },
        // Tickets pendentes sem responsavel, em filas permitidas ou sem fila.
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
      attributes: ["id", "name", "number", "email"]
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

  // showAll nao concede acesso extra a atendentes comuns.
  // Administradores veem os tickets da propria empresa.
  if (status && ["pending", "open", "closed"].includes(status)) {
    conditions.push({ status });
  }

  if (Array.isArray(queueIds) && queueIds.length > 0) {
    conditions.push({ queueId: { [Op.in]: queueIds } });
  }

  const term = searchParam.trim();
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
    if (!isValid(parsed)) {
      throw new AppError("ERR_INVALID_DATE", 400);
    }
    conditions.push({
      createdAt: { [Op.between]: [startOfDay(parsed), endOfDay(parsed)] }
    });
  }

  if (updatedAt) {
    const parsed = parseISO(updatedAt);
    if (!isValid(parsed)) {
      throw new AppError("ERR_INVALID_DATE", 400);
    }
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

  // Filtro de usuario restringe o resultado, mas nunca amplia a permissao.
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


  // Somente para exibicao no Kanban: o cadastro e o LID permanecem intactos.
  // Usa o telefone informado pelo proprio WhatsApp nas mensagens recebidas.
  const ticketsByLid = new Map<string, Ticket[]>();

  for (const ticket of tickets) {
    if (ticket.isGroup || !ticket.contact) continue;

    const identifier = String(ticket.contact.number || "");
    if (!/^\d+$/.test(identifier)) continue;

    const group = ticketsByLid.get(identifier) || [];
    group.push(ticket);
    ticketsByLid.set(identifier, group);
  }

  await Promise.all(
    Array.from(ticketsByLid.entries()).map(async ([identifier, groupedTickets]) => {
      const incomingMessages = await Message.findAll({
        attributes: ["dataJson"],
        where: {
          companyId,
          fromMe: false,
          remoteJid: `${identifier}@lid`
        },
        order: [["createdAt", "DESC"]],
        limit: 10
      });

      const phones = new Set<string>();
      for (const item of incomingMessages) {
        try {
          const raw = JSON.parse(item.dataJson || "{}");
          const alternativeJid = raw?.key?.remoteJidAlt;
          const match = typeof alternativeJid === "string"
            ? alternativeJid.match(/^(\d{8,15})@s\.whatsapp\.net$/)
            : null;
          if (match) phones.add(match[1]);
        } catch {
          // Uma mensagem legada sem JSON valido nao deve quebrar o Kanban.
        }
      }

      // Nao exibir telefone se o WhatsApp forneceu associacoes conflitantes.
      if (phones.size !== 1) return;
      const displayNumber = Array.from(phones)[0];

      for (const ticket of groupedTickets) {
        // Campo virtual apenas da resposta da API. Nao altera Contacts.number.
        ticket.contact.setDataValue("displayNumber" as any, displayNumber);
      }
    })
  );

  return {
    tickets,
    count,
    hasMore: count > offset + tickets.length
  };
};

export default ListTicketsServiceKanban;
