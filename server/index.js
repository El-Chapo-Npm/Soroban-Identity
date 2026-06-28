'use strict';

const express = require('express');
const { CredentialStore } = require('./storage');
const credentialsRouter = require('./routes/credentials');

const app = express();
app.use(express.json());

const credentialStore = new CredentialStore();
app.use('/credentials', credentialsRouter(credentialStore));

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`Soroban Identity server running on port ${PORT}`);
});

module.exports = app;
