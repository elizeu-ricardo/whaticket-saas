
import { Request, Response, NextFunction } from "express";

import AppError from "../errors/AppError";
import Whatsapp from "../models/Whatsapp";

const tokenAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Obtém o cabeçalho Authorization
    const authorization = req.headers.authorization;

    if (!authorization) {
      throw new AppError("Acesso não permitido", 401);
    }

    // Exige o formato Bearer TOKEN
    const match = authorization.trim().match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      throw new AppError("Token de autenticação inválido", 401);
    }

    const token = match[1];

    // Localiza a conexão vinculada ao token
    const whatsapp = await Whatsapp.findOne({
      where: { token }
    });

    if (!whatsapp) {
      throw new AppError("Acesso não permitido", 401);
    }

    // Define a conexão autorizada pelo token
    req.params.whatsappId = String(whatsapp.id);

    return next();
  } catch (error) {
    return next(error);
  }
};

export default tokenAuth;
