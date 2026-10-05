'use strict';

const express = require('express');
const { requireJwt } = require('../middleware/security');
const { createAdminRouter } = require('./admin');
const { requireAdminSession } = require('./auth');

function createV1Router(config, dependencies) {
  const router = express.Router();
  router.use('/admin', requireAdminSession({ config, sso: dependencies.sso }),
    express.json({ limit: 50 * 1024, inflate: false }), createAdminRouter(dependencies));
  router.use(requireJwt(config));
  router.use(express.json({ limit: 50 * 1024, inflate: false }));
  // Mount future CRUD routers here. req.auth contains verified JWT claims;
  // each resource router must also enforce its own authorization rules.
  return router;
}

module.exports = { createV1Router };
