
import { WAMessage, AnyMessageContent } from "@whiskeysockets/baileys";
import * as Sentry from "@sentry/node";
import fs from "fs";
import { exec } from "child_process";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { Op } from "sequelize";

import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import mime from "mime-types";
import ffmpegPath from "ffmpeg-static";
import formatBody from "../../helpers/Mustache";

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  companyId?: number;
  body?: string;
  isForwarded?: boolean;
}

ffmpeg.setFfmpegPath(ffmpegPath);

const publicFolder = path.resolve(
  __dirname, "..", "..", "..", "public"
);

const processAudio = async (
  audio: string,
  companyId: string
): Promise<string> => {
  const outputAudio =
    `${publicFolder}/company${companyId}/${new Date().getTime()}.ogg`;

  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath} -i ${audio} -vn -c:a libopus -b:a 128k ${outputAudio} -y`,
      (error, _stdout, _stderr) => {
        if (error) {
          reject(error);
          return;
        }

        fs.unlinkSync(audio);
        resolve(outputAudio);
      }
    );
  });
};

const processAudioFile = async (
  audio: string,
  companyId: string
): Promise<string> => {
  const outputAudio =
    `${publicFolder}/company${companyId}/${new Date().getTime()}.mp3`;

  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath} -i ${audio} -vn -ar 44100 -ac 2 -b:a 192k ${outputAudio}`,
      (error, _stdout, _stderr) => {
        if (error) {
          reject(error);
          return;
        }

        fs.unlinkSync(audio);
        resolve(outputAudio);
      }
    );
  });
};

// Preserva o JID original para contatos identificados por LID.
const resolveMediaRecipientJid = async (
  ticket: Ticket
): Promise<string> => {
  if (ticket.isGroup) {
    return `${ticket.contact.number}@g.us`;
  }

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

  const number = String(ticket.contact.number || "").trim();

  if (!/^\d+$/.test(number)) {
    throw new AppError("ERR_INVALID_WAPP_NUMBER");
  }

  return `${number}@s.whatsapp.net`;
};

export const getMessageOptions = async (
  fileName: string,
  pathMedia: string,
  companyId?: string,
  body: string = " "
): Promise<any> => {
  const mimeType = mime.lookup(pathMedia);

  try {
    if (!mimeType) {
      throw new Error("Invalid mimetype");
    }

    const typeMessage = mimeType.split("/")[0];
    let options: AnyMessageContent;

    if (typeMessage === "video") {
      options = {
        video: fs.readFileSync(pathMedia),
        caption: body ? body : null,
        fileName
      };
    } else if (typeMessage === "audio") {
      const convert = await processAudio(pathMedia, companyId);

      options = {
        audio: fs.readFileSync(convert),
        mimetype: "audio/ogg; codecs=opus",
        ptt: true
      };
    } else if (
      typeMessage === "document" ||
      fileName.endsWith(".psd")
    ) {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: body ? body : null,
        fileName,
        mimetype: mimeType
      };
    } else if (typeMessage === "application") {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: body ? body : null,
        fileName,
        mimetype: mimeType
      };
    } else {
      options = {
        image: fs.readFileSync(pathMedia),
        caption: body ? body : null
      };
    }

    return options;
  } catch (e) {
    Sentry.captureException(e);
    console.log(e);
    return null;
  }
};

const SendWhatsAppMedia = async ({
  media,
  ticket,
  body,
  isForwarded = false
}: Request): Promise<WAMessage> => {
  try {
    const wbot = await GetTicketWbot(ticket);
    const companyId = ticket.companyId.toString();
    const pathMedia = media.path;
    const mimeType = media.mimetype;
    const typeMessage = mimeType.split("/")[0];
    const fileName = media.originalname.replace("/", "-");

    let options: AnyMessageContent;

    const bodyMessage = formatBody(body, ticket.contact);

    const videoMimeTypes = [
      "video/mp4",
      "video/3gpp",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-ms-wmv",
      "video/x-matroska",
      "video/webm",
      "video/ogg"
    ];

    const documentExtensions = [
      ".psd", ".ai", ".eps", ".indd", ".xd", ".sketch"
    ];

    const shouldBeDocument = documentExtensions.some(ext =>
      fileName.toLowerCase().endsWith(ext)
    );

    if (shouldBeDocument) {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: bodyMessage,
        fileName,
        mimetype: mimeType
      };
    } else if (
      typeMessage === "video" ||
      videoMimeTypes.includes(mimeType)
    ) {
      options = {
        video: fs.readFileSync(pathMedia),
        caption: bodyMessage,
        fileName,
        mimetype: mimeType
      };
    } else if (typeMessage === "audio") {
      if (mimeType === "audio/ogg") {
        options = {
          audio: fs.readFileSync(pathMedia),
          mimetype: "audio/ogg; codecs=opus",
          ptt: true
        };
      } else {
        const convert = await processAudio(pathMedia, companyId);

        options = {
          audio: fs.readFileSync(convert),
          mimetype: "audio/ogg; codecs=opus",
          ptt: true
        };
      }
    } else if (
      typeMessage === "document" ||
      mimeType === "application/pdf"
    ) {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: bodyMessage,
        fileName,
        mimetype: mimeType
      };
    } else if (typeMessage === "image") {
      options = {
        image: fs.readFileSync(pathMedia),
        caption: bodyMessage
      };
    } else {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: bodyMessage,
        fileName,
        mimetype: mimeType
      };
    }

    const recipientJid = await resolveMediaRecipientJid(ticket);

    const sentMessage = await wbot.sendMessage(
      recipientJid,
      { ...options }
    );

    if (!sentMessage) {
      throw new AppError("ERR_SENDING_WAPP_MSG");
    }

    await ticket.update({
      lastMessage: bodyMessage
    });

    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    console.error("Erro ao enviar mídia:", err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMedia;
