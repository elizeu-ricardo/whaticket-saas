
import React from "react";

import {
  Button,
  Card,
  CardHeader,
  CardContent,
  CardActions,
  Typography,
  Grid
} from "@material-ui/core";

import { makeStyles } from "@material-ui/core/styles";

const useStyles = makeStyles((theme) => ({
  cardHeader: {
    backgroundColor:
      theme.palette.type === "light"
        ? theme.palette.grey[200]
        : theme.palette.grey[700]
  },

  card: {
    marginTop: theme.spacing(2)
  },

  content: {
    textAlign: "center",
    padding: theme.spacing(3)
  },

  button: {
    marginTop: theme.spacing(2)
  }
}));

export default function PaymentForm(props) {
  const {
    setActiveStep,
    activeStep,
    invoiceId
  } = props;

  const classes = useStyles();

  const validInvoice =
    Number.isSafeInteger(Number(invoiceId)) &&
    Number(invoiceId) > 0;

  const handleContinue = () => {
    if (!validInvoice) {
      return;
    }

    setActiveStep(activeStep + 1);
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Card className={classes.card}>
          <CardHeader
            title="Pagamento via Pix"
            subheader="Mercado Pago"
            titleTypographyProps={{
              align: "center"
            }}
            subheaderTypographyProps={{
              align: "center"
            }}
            className={classes.cardHeader}
          />

          <CardContent className={classes.content}>
            <Typography
              variant="h5"
              color="primary"
              gutterBottom
            >
              Pagamento seguro
            </Typography>

            <Typography
              variant="body1"
              gutterBottom
            >
              Sua cobrança será gerada
              pelo Mercado Pago.
            </Typography>

            <Typography
              variant="body2"
              color="textSecondary"
            >
              Fatura Nº {invoiceId}
            </Typography>

            <Typography
              variant="body2"
              color="textSecondary"
              style={{ marginTop: 16 }}
            >
              Na próxima etapa, confirme a
              solicitação para gerar seu QR Code Pix.
            </Typography>

            <Typography
              variant="body2"
              color="textSecondary"
              style={{ marginTop: 16 }}
            >
              A renovação da licença será realizada
              após a confirmação do pagamento.
            </Typography>
          </CardContent>

          <CardActions>
            <Button
              fullWidth
              variant="contained"
              color="primary"
              disabled={!validInvoice}
              onClick={handleContinue}
              className={classes.button}
            >
              CONTINUAR PARA O PIX
            </Button>
          </CardActions>
        </Card>
      </Grid>
    </Grid>
  );
}
