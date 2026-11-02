
import * as Yup from "yup";

// O checkout Pix utiliza uma fatura existente.
// O backend valida a empresa, a fatura e o valor.
//
// Mantemos um schema para cada etapa do Stepper,
// evitando validações antigas de endereço e cartão.

const validationSchema = [
  Yup.object().shape({}), // Etapa 0 - Dados
  Yup.object().shape({}), // Etapa 1 - Pix
  Yup.object().shape({})  // Etapa 2 - Revisão
];

export default validationSchema;
