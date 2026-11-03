
import React, { useContext, useState } from "react";

import {
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  CircularProgress
} from "@material-ui/core";

import { Formik, Form } from "formik";

import AddressForm from "./Forms/AddressForm";
import PaymentForm from "./Forms/PaymentForm";
import ReviewOrder from "./ReviewOrder";
import CheckoutSuccess from "./CheckoutSuccess";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import { toast } from "react-toastify";
import { AuthContext } from "../../context/Auth/AuthContext";

import validationSchema from "./FormModel/validationSchema";
import checkoutFormModel from "./FormModel/checkoutFormModel";
import formInitialValues from "./FormModel/formInitialValues";

import useStyles from "./styles";

export default function CheckoutPage(props) {
  const steps = ["Dados", "Personalizar", "Revisar"];

  const { formId, formField } = checkoutFormModel;
  const classes = useStyles();

  const { user } = useContext(AuthContext);

  const [activeStep, setActiveStep] = useState(1);
  const [datePayment, setDatePayment] = useState(null);

  // Identificar a fatura recebida do Financeiro
  const invoiceId = Number(props.Invoice?.id);

  const validInvoice =
    Number.isSafeInteger(invoiceId) &&
    invoiceId > 0;

  const currentValidationSchema =
    validationSchema[activeStep];

  const isLastStep =
    activeStep === steps.length - 1;

  function renderStepContent(
    step,
    setFieldValue,
    setActiveStep,
    values
  ) {
    switch (step) {
      case 0:
        return (
          <AddressForm
            formField={formField}
            values={values}
            setFieldValue={setFieldValue}
          />
        );

      case 1:
        return (
          <PaymentForm
            formField={formField}
            setFieldValue={setFieldValue}
            setActiveStep={setActiveStep}
            activeStep={step}
            invoiceId={invoiceId}
            values={values}
          />
        );

      case 2:
        return <ReviewOrder invoiceId={invoiceId} />;

      default:
        return <div>Etapa não encontrada</div>;
    }
  }

  async function submitForm(values, actions) {
    try {
      if (!validInvoice) {
        toast.error(
          "Fatura inválida. Acesse o menu Financeiro."
        );
        return;
      }

      // O backend consulta o valor verdadeiro
      // da fatura no PostgreSQL.
      // Não enviar valores nem dados de cartão.
      const { data } = await api.post(
        "/subscription",
        {
          invoiceId
        }
      );

      if (
        !data?.qrcode?.qrcode ||
        !data?.valor?.original
      ) {
        throw new Error(
          "O Mercado Pago não retornou um Pix válido."
        );
      }

      setDatePayment(data);
      setActiveStep(steps.length);

      toast.success(
        "Pix gerado! Aguardando pagamento."
      );

    } catch (err) {
      console.error(
        "Erro ao gerar cobrança Pix:",
        err
      );

      if (err?.response) {
        toastError(err);
      } else {
        toast.error(
          err.message ||
          "Não foi possível gerar o Pix."
        );
      }

    } finally {
      actions.setSubmitting(false);
    }
  }

  function handleSubmit(values, actions) {
    if (isLastStep) {
      submitForm(values, actions);
    } else {
      setActiveStep(prev => prev + 1);
      actions.setTouched({});
      actions.setSubmitting(false);
    }
  }

  function handleBack() {
    setActiveStep(prev => Math.max(1, prev - 1));
  }

  // Impedir abertura do checkout sem uma fatura.
  if (!validInvoice) {
    return (
      <React.Fragment>
        <Typography
          variant="h6"
          align="center"
          color="error"
        >
          Nenhuma fatura selecionada.
        </Typography>

        <Typography
          align="center"
          style={{ marginTop: 16 }}
        >
          Acesse o menu Financeiro e clique
          em PAGAR na fatura desejada.
        </Typography>
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <Typography
        component="h1"
        variant="h4"
        align="center"
      >
        Falta pouco!
      </Typography>

      <Stepper
        activeStep={activeStep}
        className={classes.stepper}
      >
        {steps.map(label => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {activeStep === steps.length ? (
        <CheckoutSuccess pix={datePayment} />
      ) : (
        <Formik
          initialValues={{
            ...user,
            ...formInitialValues
          }}
          validationSchema={currentValidationSchema}
          onSubmit={handleSubmit}
        >
          {({
            isSubmitting,
            setFieldValue,
            values
          }) => (
            <Form id={formId}>
              {renderStepContent(
                activeStep,
                setFieldValue,
                setActiveStep,
                values
              )}

              <div className={classes.buttons}>
                {activeStep !== 1 && (
                  <Button
                    onClick={handleBack}
                    className={classes.button}
                    disabled={isSubmitting}
                  >
                    VOLTAR
                  </Button>
                )}

                <div className={classes.wrapper}>
                  {activeStep !== 1 && (
                    <Button
                      disabled={isSubmitting}
                      type="submit"
                      variant="contained"
                      color="primary"
                      className={classes.button}
                    >
                      {isLastStep
                        ? "GERAR PIX"
                        : "PRÓXIMO"}
                    </Button>
                  )}

                  {isSubmitting && (
                    <CircularProgress
                      size={24}
                      className={
                        classes.buttonProgress
                      }
                    />
                  )}
                </div>
              </div>
            </Form>
          )}
        </Formik>
      )}
    </React.Fragment>
  );
}
