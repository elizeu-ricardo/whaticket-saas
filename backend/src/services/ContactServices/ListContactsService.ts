
import { Sequelize, Op, QueryTypes } from "sequelize";

import sequelize from "../../database";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  companyId: number;
}

interface ContactWithDisplayNumber {
  [key: string]: unknown;
  displayNumber: string;
}

interface Response {
  contacts: ContactWithDisplayNumber[];
  count: number;
  hasMore: boolean;
}

interface NumeroEncontrado {
  contactId: number;
  displayNumber: string;
}

const ListContactsService = async ({
  searchParam = "",
  pageNumber = "1",
  companyId
}: Request): Promise<Response> => {

  const termo = searchParam.toLowerCase().trim();

  const whereCondition = {
    [Op.or]: [
      {
        name: Sequelize.where(
          Sequelize.fn("LOWER", Sequelize.col("name")),
          "LIKE",
          `%${termo}%`
        )
      },
      {
        number: {
          [Op.like]: `%${termo}%`
        }
      }
    ],
    companyId: {
      [Op.eq]: companyId
    }
  };

  const limit = 30;
  const offset = limit * (+pageNumber - 1);

  const { count, rows: contacts } =
    await Contact.findAndCountAll({
      where: whereCondition,
      limit,
      include: [
        {
          model: Ticket,
          as: "tickets",
          attributes: [
            "id",
            "status",
            "createdAt",
            "updatedAt"
          ]
        }
      ],
      offset,
      order: [["name", "ASC"]]
    });

  const numerosPorContato = new Map<number, string>();

  if (contacts.length > 0) {
    const ids = contacts.map(contact => contact.id);

    const numeros = await sequelize.query<NumeroEncontrado>(
      `
      SELECT
        c.id AS "contactId",
        REPLACE(
          msg."jidTelefone",
          '@s.whatsapp.net',
          ''
        ) AS "displayNumber"
      FROM "Contacts" c
      JOIN LATERAL (
        SELECT
          m."dataJson"::jsonb
            #>> '{key,remoteJidAlt}' AS "jidTelefone"
        FROM "Messages" m
        WHERE m."contactId" = c.id
          AND m."companyId" = :companyId
          AND m."dataJson" LIKE '%remoteJidAlt%'
          AND (
            m."dataJson"::jsonb
              #>> '{key,remoteJidAlt}'
          ) ~ '^[0-9]{8,15}@s[.]whatsapp[.]net$'
        ORDER BY m."createdAt" DESC
        LIMIT 1
      ) msg ON TRUE
      WHERE c.id IN (:ids)
        AND c."companyId" = :companyId
      `,
      {
        replacements: {
          ids,
          companyId
        },
        type: QueryTypes.SELECT
      }
    );

    numeros.forEach(item => {
      numerosPorContato.set(
        item.contactId,
        item.displayNumber
      );
    });
  }

  const contactsWithDisplayNumber = contacts.map(contact => ({
    ...(contact.toJSON() as Record<string, unknown>),

    // Apenas para exibição.
    // Não altera o LID salvo no contato.
    displayNumber:
      numerosPorContato.get(contact.id) ||
      contact.number
  }));

  const hasMore = count > offset + contacts.length;

  return {
    contacts: contactsWithDisplayNumber,
    count,
    hasMore
  };
};

export default ListContactsService;
