'use strict';

const { Router } = require('express');
const { DuplicateKeyError } = require('../storage');

module.exports = function credentialsRouter(store) {
  const router = Router();

  router.post('/', (req, res) => {
    const credential = req.body;

    if (!credential || !credential.id) {
      return res.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'Request body must include a credential with an id field.',
      });
    }

    try {
      store.add(credential);
      return res.status(201).json(store.get(credential.id));
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        return res.status(409).json({
          code: 'CREDENTIAL_ALREADY_EXISTS',
          message: err.message,
          details: [{ field: 'id', value: err.id }],
        });
      }
      return res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      });
    }
  });

  router.get('/:id', (req, res) => {
    const credential = store.get(req.params.id);
    if (!credential) {
      return res.status(404).json({
        code: 'CREDENTIAL_NOT_FOUND',
        message: `Credential "${req.params.id}" not found.`,
      });
    }
    return res.json(credential);
  });

  router.delete('/:id', (req, res) => {
    if (!store.has(req.params.id)) {
      return res.status(404).json({
        code: 'CREDENTIAL_NOT_FOUND',
        message: `Credential "${req.params.id}" not found.`,
      });
    }
    store.delete(req.params.id);
    return res.status(204).end();
  });

  return router;
};
