
import React from "react";

import {
  Typography,
  Grid,
  Paper
} from "@material-ui/core";

export default function ReviewOrder({ invoiceId }) {
  return (
    <React.Fragment>
      <Typography
        variant="h6"
        gutterBottom
      >
        Revisar pagamento
      </Typography>

      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Paper
            variant="outlined"
            style={{
              padding: 24,
              textAlign: "center"
            }}
          >
            <Typography
              variant="h6"
              color="primary"
              gutterBottom
            >
              Pagamento via Pix
            </Typography>

            <Typography
              variant="body1"
              gutterBottom
            >
              Mercado Pago
            </Typography>

            <Typography
              variant="body2"
              color="textSecondary"
              gutterBottom
            >
              Fatura Nº {invoiceId}
            </Typography>

            <Typography
              variant="body2"
              style={{ marginTop: 16 }}
            >
              Clique em GERAR PIX para receber
              o código de pagamento.
            </Typography>

            <Typography
              variant="body2"
              color="textSecondary"
              style={{ marginTop: 12 }}
            >
              Sua licença será renovada após
              a confirmação do pagamento.
            </Typography>
          </Paper>
        </Grid>
      </Grid>
    </React.Fragment>
  );
}
